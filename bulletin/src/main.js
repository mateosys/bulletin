import "./style.css";
import "./auth.js";
import { supabase } from "./supabase.js";
import { profileUsername } from "./route.js";

// bulletin form content
const bulletinForm = document.querySelector("#bulletin-form");
const bulletinInput = document.querySelector("#bulletin-content");
const characterCount = document.querySelector("#character-count");
const bulletinFeed = document.querySelector("#bulletin-feed");
const publishButton = bulletinForm.querySelector('button[type="submit"]');
const postError = document.querySelector("#post-error");
const feedStatus = document.querySelector("#feed-status");

// image content
const imageInput = document.querySelector("#bulletin-images");
const imagePreviews = document.querySelector("#image-previews");
// FIX 1: removed `const gallery = article.querySelector(".bulletin-images");` from here.
// `article` doesn't exist at the top of the file, so that line crashed the whole script.
// `gallery` belongs inside createBulletin, where it already is.

const MAX_IMAGES = 4;
const MAX_IMAGE_SIZE = 1600; // longest side, in pixels
let selectedImages = []; // { file, url, item } for each photo in the composer

// profile content
const profileDetails = document.querySelector("#profile-details");
const profileUsernameElement = document.querySelector("#profile-username");
const profileName = document.querySelector("#profile-name");
const profileBio = document.querySelector("#profile-bio");
const profileJoined = document.querySelector("#profile-joined");
const profileStatus = document.querySelector("#profile-status");
const profileFeed = document.querySelector("#profile-feed");

const profileEditButton = document.querySelector("#profile-edit-button");
const profileForm = document.querySelector("#profile-form");
const profileDisplayNameInput = document.querySelector("#profile-display-name");
const profileBioInput = document.querySelector("#profile-bio-input");
const profileFormError = document.querySelector("#profile-form-error");
const profileCancelButton = document.querySelector("#profile-cancel");
const profileSaveButton = document.querySelector("#profile-save");
const myProfileLink = document.querySelector("#my-profile-link");

// Friend elements
const friendControls = document.querySelector("#friend-controls");
const friendError = document.querySelector("#friend-error");
const friendsSection = document.querySelector("#friends-section");
const friendsCount = document.querySelector("#friends-count");
const friendsList = document.querySelector("#friends-list");
const friendsStatus = document.querySelector("#friends-status");

// Friend Requests and user search
const requestsSection = document.querySelector("#requests-section");
const requestsList = document.querySelector("#requests-list");
const searchForm = document.querySelector("#search-form");
const searchInput = document.querySelector("#search-input");
const searchStatus = document.querySelector("#search-status");
const searchResults = document.querySelector("#search-results");
const requestsLink = document.querySelector("#requests-link");
const requestsCountBadge = document.querySelector("#requests-count");

let viewedProfile = null; // the profile currently on screen
let viewedFriendship = null; // your friendship row with the profile on screen, if any

const friendshipColumns = "id, requester_id, recipient_id, status";

const maximumCharacters = bulletinInput.maxLength;

// Archive elements
const archive = document.querySelector("#archive");
const archiveStatus = document.querySelector("#archive-status");
const archiveFeed = document.querySelector("#archive-feed");

const ARCHIVE_AFTER_DAYS = 15;
let archiveLoaded = false;

// The moment 15 days ago, as the timestamp format Supabase expects
function archiveCutoff() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - ARCHIVE_AFTER_DAYS);
  return cutoff.toISOString();
}

// The columns we want for every post, plus the author's profile
const postColumns =
  "id, user_id, content, created_at, updated_at, profiles (display_name, username), comments (count), post_images (path, alt, position)";

const commentColumns =
  "id, post_id, user_id, content, deleted_by, created_at, profiles (display_name, username)";

let currentUserId = null;

function updateCharacterCount() {
  const charactersRemaining = maximumCharacters - bulletinInput.value.length;
  characterCount.textContent = `${charactersRemaining} characters remaining`;
}

imageInput.addEventListener("change", () => {
  postError.textContent = "";

  const files = [...imageInput.files];
  const room = MAX_IMAGES - selectedImages.length;

  if (files.length > room) {
    postError.textContent = `You can add up to ${MAX_IMAGES} photos per bulletin.`;
  }

  files.slice(0, room).forEach((file) => addImagePreview(file));

  // Clear it so picking the same photo again still fires "change"
  imageInput.value = "";
  imageInput.disabled = selectedImages.length >= MAX_IMAGES;
});

function addImagePreview(file) {
  const url = URL.createObjectURL(file);
  const item = document.createElement("li");
  item.className = "space-y-2";

  item.innerHTML = `
    <img class="bg-stone-100 rounded-xl w-full aspect-square object-cover" />
    <label class="block">
      <span class="font-medium text-sm">Describe this photo</span>
      <input
        type="text"
        required
        maxlength="300"
        class="block bg-stone-50 mt-1 p-2.5 border border-stone-300 focus:border-stone-950 rounded-xl focus:outline-none w-full text-sm"
      />
    </label>
    <button type="button" class="font-medium text-stone-500 hover:text-red-700 text-sm">
      Remove
    </button>
  `;

  const preview = item.querySelector("img");
  preview.src = url;
  preview.alt = `Preview of ${file.name}`;

  const image = { file, url, item };

  item.querySelector("button").addEventListener("click", () => {
    removeImage(image);
    imageInput.focus();
  });

  selectedImages.push(image);
  imagePreviews.append(item);
}

function removeImage(image) {
  URL.revokeObjectURL(image.url);
  image.item.remove();
  selectedImages = selectedImages.filter((selected) => selected !== image);
  imageInput.disabled = selectedImages.length >= MAX_IMAGES;
}

function clearSelectedImages() {
  [...selectedImages].forEach((image) => removeImage(image));
}

// Shrink a photo to MAX_IMAGE_SIZE and convert it to JPEG
async function resizeImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(
    1,
    MAX_IMAGE_SIZE / Math.max(bitmap.width, bitmap.height)
  );

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const context = canvas.getContext("2d");
  context.fillStyle = "#fff"; // JPEG has no transparency, so use white behind PNGs
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Image couldn't be processed")),
      "image/jpeg",
      0.82
    );
  });
}

async function uploadImages(postId, images) {
  const bucket = supabase.storage.from("post-images");
  const uploadedPaths = [];

  try {
    const rows = [];

    for (const [position, image] of images.entries()) {
      const blob = await resizeImage(image.file);
      const path = `${currentUserId}/${postId}/${crypto.randomUUID()}.jpg`;

      const { error } = await bucket.upload(path, blob, {
        contentType: "image/jpeg",
      });
      if (error) throw error;

      uploadedPaths.push(path);
      rows.push({ post_id: postId, path, alt: image.alt, position });
    }

    const { data, error } = await supabase
      .from("post_images")
      .insert(rows)
      .select("path, alt, position");

    if (error) throw error;
    return data;
  } catch (error) {
    // Clean up any files that did make it before the failure
    if (uploadedPaths.length > 0) await bucket.remove(uploadedPaths);
    throw error;
  }
}

// Give every not-yet-loaded image in a container a signed link, in one request
async function loadImages(container) {
  const images = [...container.querySelectorAll("img[data-path]:not([src])")];
  if (images.length === 0) return;

  const paths = [...new Set(images.map((img) => img.dataset.path))];

  const { data, error } = await supabase.storage
    .from("post-images")
    .createSignedUrls(paths, 60 * 60);

  if (error) {
    console.error(error);
    return;
  }

  const urls = new Map(
    data
      .filter((result) => result.signedUrl)
      .map((result) => [result.path, result.signedUrl])
  );

  images.forEach((img) => {
    const url = urls.get(img.dataset.path);
    if (url) img.src = url;
  });
}

bulletinInput.addEventListener("input", updateCharacterCount);

bulletinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  postError.textContent = "";

  const content = bulletinInput.value.trim();

  if (!content) {
    bulletinInput.focus();
    return;
  }

  const images = selectedImages.map(({ file, item }) => ({
    file,
    alt: item.querySelector("input").value.trim(),
  }));

  // "required" lets a description of only spaces through, so check it here
  const missingAlt = images.findIndex((image) => !image.alt);
  if (missingAlt !== -1) {
    selectedImages[missingAlt].item.querySelector("input").focus();
    postError.textContent = "Add a description for each photo.";
    return;
  }

  publishButton.disabled = true;

  const { data: post, error } = await supabase
    .from("posts")
    .insert({ content })
    .select(postColumns)
    .single();

  if (error) {
    console.error(error);
    publishButton.disabled = false;
    postError.textContent =
      "Your bulletin couldn't be published. Please try again.";
    return;
  }

  if (images.length > 0) {
    try {
      post.post_images = await uploadImages(post.id, images);
    } catch (uploadError) {
      console.error(uploadError);
      // Don't leave a bulletin behind without its photos
      await supabase.from("posts").delete().eq("id", post.id);
      publishButton.disabled = false;
      postError.textContent =
        "Your photos couldn't be uploaded, so nothing was published. Please try again.";
      return;
    }
  }

  publishButton.disabled = false;

  const article = createBulletin(post);
  bulletinFeed.prepend(article);
  loadImages(article);
  feedStatus.hidden = true;

  bulletinForm.reset();
  clearSelectedImages();
  updateCharacterCount();
  bulletinInput.focus();
});

async function loadFeed() {
  feedStatus.hidden = false;
  feedStatus.textContent = "Loading bulletins…";

  const { data: posts, error } = await supabase
    .from("posts")
    .select(postColumns)
    .gt("created_at", archiveCutoff())
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    feedStatus.textContent =
      "Bulletins couldn't be loaded. Refresh to try again.";
    return;
  }

  bulletinFeed.replaceChildren(...posts.map((post) => createBulletin(post)));
  loadImages(bulletinFeed); // FIX 2: added — fills in the feed's photos

  if (posts.length === 0) {
    feedStatus.textContent =
      "No bulletins in the last 15 days. Post something!";
  } else {
    feedStatus.hidden = true;
  }
}

// render profile details

function renderProfileDetails(profile) {
  document.title = `${profile.display_name} (@${profile.username}) · Bulletin`;

  profileUsernameElement.textContent = profile.username;
  profileName.textContent = profile.display_name;
  profileBio.textContent = profile.bio ?? "";
  profileBio.hidden = !profile.bio;

  const joined = new Date(profile.created_at);
  profileJoined.dateTime = joined.toISOString();
  profileJoined.textContent = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(joined);
}

// load profile
async function loadProfile(username) {
  profileStatus.textContent = "Loading profile…";

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, bio, created_at")
    .eq("username", username)
    .maybeSingle();

  if (error) {
    console.error(error);
    profileStatus.textContent =
      "This profile couldn't be loaded. Refresh to try again.";
    return;
  }

  if (!profile) {
    document.title = "Not found · Bulletin";
    profileStatus.textContent = `No one goes by @${username} here.`;
    return;
  }

  viewedProfile = profile;
  renderProfileDetails(profile);
  profileEditButton.hidden = profile.id !== currentUserId;

  viewedFriendship = null;

  if (currentUserId && profile.id !== currentUserId) {
    // RLS only returns friendships you're part of, so any row
    // involving this person must be the one between the two of you
    const { data: friendship, error: friendshipError } = await supabase
      .from("friendships")
      .select(friendshipColumns)
      .or(`requester_id.eq.${profile.id},recipient_id.eq.${profile.id}`)
      .maybeSingle();

    if (friendshipError) console.error(friendshipError);
    viewedFriendship = friendship ?? null;
  }

  renderFriendControls();
  profileDetails.hidden = false;
  await Promise.all([loadProfilePosts(), loadProfileFriends()]);
}

function updateRequestBadge(count) {
  requestsCountBadge.textContent = count;
  requestsLink.setAttribute(
    "aria-label",
    `${count} friend ${count === 1 ? "request" : "requests"}`
  );
  requestsLink.hidden = count === 0;
}

// For pages other than the board, where the full list isn't loaded
async function loadRequestCount() {
  const { count, error } = await supabase
    .from("friendships")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", currentUserId)
    .eq("status", "pending");

  if (error) {
    console.error(error);
    return;
  }

  updateRequestBadge(count);
}

async function loadRequests() {
  const { data: requests, error } = await supabase
    .from("friendships")
    .select(
      "id, requester:profiles!friendships_requester_id_fkey (username, display_name)"
    )
    .eq("recipient_id", currentUserId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  requestsList.replaceChildren(
    ...requests.map((request) => createRequestItem(request))
  );
  requestsSection.hidden = requests.length === 0;
  updateRequestBadge(requests.length);

  // Arriving from the header link on another page
  if (location.hash === "#requests-section" && requests.length > 0) {
    requestsSection.scrollIntoView();
    requestsList.querySelector("button").focus({ preventScroll: true });
  }
}

function createRequestItem(request) {
  const item = document.createElement("li");
  item.className =
    "flex flex-wrap justify-between items-center gap-3 bg-white p-4 border border-stone-300 rounded-2xl";
  item.dataset.friendshipId = request.id;

  item.innerHTML = `
    <a class="request-name font-semibold hover:underline"></a>
    <div class="flex gap-2">
      ${friendButton("accept", "Accept", primaryButton)}
      ${friendButton("decline", "Decline", secondaryButton)}
    </div>
  `;

  const name = request.requester.display_name;
  const link = item.querySelector(".request-name");
  link.textContent = name;
  link.href = `/u/${request.requester.username}`;

  // Screen readers hear "Accept Dummy Jones", not just "Accept"
  item.querySelectorAll("button").forEach((button) => {
    button.setAttribute("aria-label", `${button.textContent.trim()} ${name}`);
  });

  return item;
}

requestsList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const item = button.closest("li");
  const buttons = item.querySelectorAll("button");
  const accepting = button.dataset.action === "accept";

  buttons.forEach((b) => (b.disabled = true));

  const friendships = supabase.from("friendships");
  const { error } = accepting
    ? await friendships
        .update({ status: "accepted" })
        .eq("id", item.dataset.friendshipId)
    : await friendships.delete().eq("id", item.dataset.friendshipId);

  if (error) {
    console.error(error);
    buttons.forEach((b) => (b.disabled = false));
    alert("That didn't go through. Please try again.");
    return;
  }

  item.remove();

  if (requestsList.children.length === 0) {
    requestsSection.hidden = true;
  }

  // Move focus to the next request, or to the post box if none are left
  (requestsList.querySelector("button") ?? bulletinInput).focus();

  // A new friend means new posts in your feed
  if (accepting) loadFeed();
});

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  // Keep only letters, numbers, spaces and underscores,
  // so typed text can't break the filter below
  const term = searchInput.value.replace(/[^\p{L}\p{N}_ ]/gu, "").trim();

  if (term.length < 2) {
    searchResults.replaceChildren();
    searchStatus.textContent = "Type at least 2 letters or numbers.";
    return;
  }

  searchStatus.textContent = "Searching…";

  const { data: people, error } = await supabase
    .from("profiles")
    .select("id, username, display_name")
    .or(`username.ilike.%${term}%,display_name.ilike.%${term}%`)
    .neq("id", currentUserId)
    .order("display_name")
    .limit(10);

  if (error) {
    console.error(error);
    searchStatus.textContent =
      "Search isn't working right now. Please try again.";
    return;
  }

  searchResults.replaceChildren(
    ...people.map((person) => createSearchResult(person))
  );

  searchStatus.textContent =
    people.length === 0
      ? `No one matches "${term}".`
      : `${people.length} ${people.length === 1 ? "person" : "people"} found.`;
});

function createSearchResult(person) {
  const item = document.createElement("li");

  const link = document.createElement("a");
  link.href = `/u/${person.username}`;
  link.className =
    "block bg-white hover:bg-stone-50 p-4 border border-stone-300 rounded-2xl";

  const name = document.createElement("span");
  name.className = "block font-semibold";
  name.textContent = person.display_name;

  const handle = document.createElement("span");
  handle.className = "block text-stone-500 text-sm";
  handle.textContent = `@${person.username}`;

  link.append(name, handle);
  item.append(link);

  return item;
}

async function loadProfilePosts() {
  const isSelf = viewedProfile.id === currentUserId;
  const isFriend = viewedFriendship?.status === "accepted";

  // FIX 3: moved this archive block above the "not friends" check,
  // so it also runs when that check returns early (e.g. after logging out)
  archive.hidden = !isSelf;
  if (!isSelf) {
    archive.open = false;
    archiveFeed.replaceChildren();
    archiveLoaded = false;
  }

  if (!isSelf && !isFriend) {
    profileFeed.replaceChildren();
    // FIX 4: removed loadImages(profileFeed) from here — there are no posts to load
    profileStatus.textContent = `Only ${viewedProfile.display_name}'s friends can see their bulletins.`;
    return;
  }

  profileStatus.textContent = "Loading bulletins…";

  const { data: posts, error } = await supabase
    .from("posts")
    .select(postColumns)
    .eq("user_id", viewedProfile.id)
    .gt("created_at", archiveCutoff())
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    profileStatus.textContent =
      "Bulletins couldn't be loaded. Refresh to try again.";
    return;
  }

  profileFeed.replaceChildren(
    ...posts.map((post) => createBulletin(post, { showActions: false }))
  );
  loadImages(profileFeed); // FIX 4: moved here, right after the posts are drawn

  profileStatus.textContent =
    posts.length === 0
      ? `${viewedProfile.display_name} hasn't posted in the last 15 days.`
      : "";

  // FIX 5: removed loadProfileFriends() from here — loadProfile already
  // calls it with Promise.all, so this was a duplicate request
}

async function loadProfileFriends() {
  const isSelf = viewedProfile.id === currentUserId;
  const isFriend = viewedFriendship?.status === "accepted";

  if (!isSelf && !isFriend) {
    friendsSection.hidden = true;
    friendsList.replaceChildren();
    return;
  }

  const { data: friends, error } = await supabase.rpc("get_friends", {
    target_id: viewedProfile.id,
  });

  friendsSection.hidden = false;

  if (error) {
    console.error(error);
    friendsCount.textContent = "";
    friendsList.replaceChildren();
    friendsStatus.textContent =
      "Friends couldn't be loaded. Refresh to try again.";
    return;
  }

  friendsCount.textContent = `(${friends.length})`;
  friendsList.replaceChildren(
    ...friends.map((friend) => createFriendChip(friend))
  );

  if (friends.length > 0) {
    friendsStatus.textContent = "";
  } else if (isSelf) {
    friendsStatus.textContent =
      "No friends yet. Use Find people on your board to add some.";
  } else {
    friendsStatus.textContent = `${viewedProfile.display_name} hasn't added any friends yet.`;
  }
}

function createFriendChip(friend) {
  const item = document.createElement("li");

  const link = document.createElement("a");
  link.href = `/u/${friend.username}`;
  link.className =
    "inline-block bg-white hover:bg-stone-50 px-4 py-2 border border-stone-300 rounded-full font-medium text-sm";
  link.textContent = friend.id === currentUserId ? "You" : friend.display_name;

  item.append(link);
  return item;
}

archive.addEventListener("toggle", () => {
  if (archive.open && !archiveLoaded) loadArchive();
});

async function loadArchive() {
  archiveLoaded = true;
  archiveStatus.textContent = "Loading archive…";

  const { data: posts, error } = await supabase
    .from("posts")
    .select(postColumns)
    .eq("user_id", currentUserId)
    .lte("created_at", archiveCutoff())
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    archiveLoaded = false; // let them retry by closing and reopening
    archiveStatus.textContent =
      "Your archive couldn't be loaded. Please try again.";
    return;
  }

  archiveFeed.replaceChildren(
    ...posts.map((post) => createBulletin(post, { showActions: false }))
  );
  loadImages(archiveFeed);

  archiveStatus.textContent = posts.length === 0 ? "Nothing archived yet." : "";
}

const primaryButton =
  "bg-stone-950 hover:bg-stone-700 disabled:opacity-50 px-4 py-2 rounded-full font-semibold text-white text-sm";
const secondaryButton =
  "hover:bg-stone-100 disabled:opacity-50 px-4 py-2 border border-stone-300 rounded-full font-medium text-sm";

function friendButton(action, label, style) {
  return `<button type="button" data-action="${action}" class="${style}">${label}</button>`;
}

function renderFriendControls() {
  friendError.textContent = "";

  const isSelf = viewedProfile.id === currentUserId;

  if (!currentUserId || isSelf) {
    friendControls.hidden = true;
    return;
  }

  const friendship = viewedFriendship;

  if (!friendship) {
    friendControls.innerHTML = friendButton("add", "Add friend", primaryButton);
  } else if (friendship.status === "accepted") {
    friendControls.innerHTML = `
      <p class="font-medium text-sm">✓ Friends</p>
      ${friendButton("unfriend", "Unfriend", secondaryButton)}
    `;
  } else if (friendship.requester_id === currentUserId) {
    friendControls.innerHTML = `
      <p class="text-stone-500 text-sm">Request sent</p>
      ${friendButton("cancel", "Cancel request", secondaryButton)}
    `;
  } else {
    friendControls.innerHTML = `
      <p class="text-stone-500 text-sm">Wants to be friends</p>
      ${friendButton("accept", "Accept", primaryButton)}
      ${friendButton("decline", "Decline", secondaryButton)}
    `;
  }

  friendControls.hidden = false;
}

friendControls.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const action = button.dataset.action;

  if (action === "unfriend") {
    const confirmed = confirm(
      `Remove ${viewedProfile.display_name} as a friend?`
    );
    if (!confirmed) return;
  }

  const buttons = friendControls.querySelectorAll("button");
  buttons.forEach((b) => (b.disabled = true));
  friendError.textContent = "";

  let result;

  if (action === "add") {
    result = await supabase
      .from("friendships")
      .insert({ recipient_id: viewedProfile.id })
      .select(friendshipColumns)
      .single();
  } else if (action === "accept") {
    result = await supabase
      .from("friendships")
      .update({ status: "accepted" })
      .eq("id", viewedFriendship.id)
      .select(friendshipColumns)
      .single();
  } else {
    // cancel, decline and unfriend all remove the row
    result = await supabase
      .from("friendships")
      .delete()
      .eq("id", viewedFriendship.id);
  }

  if (result.error) {
    console.error(result.error);
    buttons.forEach((b) => (b.disabled = false));
    friendError.textContent =
      "That didn't go through. Refresh the page and try again.";
    return;
  }

  viewedFriendship =
    action === "add" || action === "accept" ? result.data : null;

  renderFriendControls();
  friendControls.querySelector("button")?.focus();

  // Which posts you're allowed to see may have just changed
  loadProfilePosts();
  loadProfileFriends(); // FIX 5: added — the friends list can change here too

  if (action === "accept" || action === "decline") loadRequestCount();
});

profileEditButton.addEventListener("click", () => {
  profileDisplayNameInput.value = viewedProfile.display_name;
  profileBioInput.value = viewedProfile.bio ?? "";
  profileFormError.textContent = "";

  profileForm.hidden = false;
  profileEditButton.hidden = true;
  profileDisplayNameInput.focus();
});

function closeProfileForm() {
  profileForm.hidden = true;
  profileEditButton.hidden = false;
  profileEditButton.focus();
}

profileCancelButton.addEventListener("click", closeProfileForm);

profileForm.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeProfileForm();
});

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  profileFormError.textContent = "";

  const displayName = profileDisplayNameInput.value.trim();
  const bio = profileBioInput.value.trim();

  if (!displayName) {
    profileDisplayNameInput.focus();
    return;
  }

  profileSaveButton.disabled = true;

  const { data: profile, error } = await supabase
    .from("profiles")
    .update({ display_name: displayName, bio: bio || null })
    .eq("id", currentUserId)
    .select("id, username, display_name, bio, created_at")
    .single();

  profileSaveButton.disabled = false;

  if (error) {
    console.error(error);
    profileFormError.textContent =
      "Your profile couldn't be saved. Please try again.";
    return;
  }

  viewedProfile = profile;
  renderProfileDetails(profile);

  // Posts on this page still show the old name, so update them too
  profileFeed.querySelectorAll(".bulletin-author").forEach((link) => {
    link.textContent = profile.display_name;
  });

  closeProfileForm();
});

async function loadMyProfileLink() {
  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", currentUserId)
    .maybeSingle();

  if (profile) {
    myProfileLink.href = `/u/${profile.username}`;
    myProfileLink.hidden = false;
  }
}

function createBulletin(
  post,
  { showActions = true, showComments = true } = {}
) {
  const article = document.createElement("article");
  article.className = "rounded-2xl border border-stone-300 bg-white p-5";
  article.dataset.postId = post.id;

  article.innerHTML = `
    <header class="flex items-start justify-between gap-4">
      <div>
          <h3 class="font-semibold"><a class="bulletin-author hover:underline"></a></h3>        
          <p class="text-sm text-stone-500">
          <time></time><span class="bulletin-edited"> · Edited</span>
        </p>
      </div>

      <div class="bulletin-actions flex gap-3">
        <button type="button" class="bulletin-edit text-sm font-medium text-stone-500 hover:text-stone-950">
          Edit
        </button>
        <button type="button" class="bulletin-delete text-sm font-medium text-stone-500 hover:text-red-700">
          Delete
        </button>
      </div>
    </header>

    <p class="bulletin-content mt-4 leading-7"></p>
         <div class="bulletin-images"></div>
        <details class="bulletin-comments mt-4 pt-4 border-t border-stone-200">
      <summary class="font-medium text-stone-500 hover:text-stone-950 text-sm cursor-pointer"></summary>
      <ul class="comment-list space-y-3 mt-4"></ul>
      <p class="comment-status mt-3 text-stone-500 text-sm" role="status"></p>
      <form class="comment-form flex gap-2 mt-4">
        <label class="w-full">
          <span class="sr-only">Write a comment</span>
          <input
            name="content"
            type="text"
            required
            maxlength="300"
            autocomplete="off"
            placeholder="Write a comment…"
            class="bg-stone-50 p-2.5 border border-stone-300 focus:border-stone-950 rounded-xl focus:outline-none w-full text-sm"
          />
        </label>
        <button type="submit" class="bg-stone-950 hover:bg-stone-700 disabled:opacity-50 px-4 py-2 rounded-full font-semibold text-white text-sm">
          Post
        </button>
      </form>
    </details>
  `;

  const createdAt = new Date(post.created_at);
  const timeElement = article.querySelector("time");

  // timestamp creation
  timeElement.dateTime = createdAt.toISOString();
  timeElement.textContent = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(createdAt);

  article.querySelector(".bulletin-edited").hidden =
    post.updated_at === post.created_at;

  const authorLink = article.querySelector(".bulletin-author");

  authorLink.textContent = post.profiles?.display_name ?? "Unknown";
  if (post.profiles) {
    authorLink.href = `/u/${post.profiles.username}`;
  }
  article.querySelector(".bulletin-content").textContent = post.content;

  // image gallery
  const postImages = [...(post.post_images ?? [])].sort(
    (a, b) => a.position - b.position
  );
  const gallery = article.querySelector(".bulletin-images");

  if (postImages.length === 0) {
    gallery.remove();
  } else {
    const single = postImages.length === 1;
    gallery.className = single ? "mt-4" : "gap-2 grid grid-cols-2 mt-4";

    postImages.forEach((image) => {
      const img = document.createElement("img");
      img.dataset.path = image.path;
      img.alt = image.alt;
      img.loading = "lazy";
      img.className = single
        ? "bg-stone-100 rounded-xl w-full"
        : "bg-stone-100 rounded-xl w-full aspect-square object-cover";
      gallery.append(img);
    });
  }

  // Only show Edit and Delete on your own posts
  article.querySelector(".bulletin-actions").hidden =
    !showActions || post.user_id !== currentUserId;

  if (showComments) {
    setUpComments(article, post);
  } else {
    article.querySelector(".bulletin-comments").remove();
  }

  return article;
}

// the comment code
function setUpComments(article, post) {
  const details = article.querySelector(".bulletin-comments");
  const summary = details.querySelector("summary");
  const list = details.querySelector(".comment-list");
  const status = details.querySelector(".comment-status");
  const form = details.querySelector(".comment-form");
  const input = form.querySelector("input");
  const submitButton = form.querySelector("button");

  let count = post.comments?.[0]?.count ?? 0;
  let loaded = false;

  function updateSummary() {
    summary.textContent =
      count === 0
        ? "Comment"
        : `${count} ${count === 1 ? "comment" : "comments"}`;
  }

  updateSummary();

  // Load this post's comments the first time it's opened
  details.addEventListener("toggle", async () => {
    if (!details.open || loaded) return;
    loaded = true;
    status.textContent = "Loading comments…";

    const { data: comments, error } = await supabase
      .from("comments")
      .select(commentColumns)
      .eq("post_id", post.id)
      .order("created_at");

    if (error) {
      console.error(error);
      loaded = false;
      status.textContent =
        "Comments couldn't be loaded. Close and reopen to try again.";
      return;
    }

    list.replaceChildren(
      ...comments.map((comment) => createComment(comment, post))
    );
    status.textContent = "";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const content = input.value.trim();
    if (!content) {
      input.focus();
      return;
    }

    submitButton.disabled = true;
    status.textContent = "";

    const { data: comment, error } = await supabase
      .from("comments")
      .insert({ post_id: post.id, content })
      .select(commentColumns)
      .single();

    submitButton.disabled = false;

    if (error) {
      console.error(error);
      status.textContent = "Your comment couldn't be posted. Please try again.";
      return;
    }

    list.append(createComment(comment, post));
    count += 1;
    updateSummary();
    form.reset();
    input.focus();
  });

  list.addEventListener("click", async (event) => {
    const button = event.target.closest(".comment-delete");
    if (!button) return;

    const item = button.closest("li");
    const isMine = item.dataset.userId === currentUserId;

    const confirmed = confirm(
      isMine
        ? "Delete your comment?"
        : "Remove this comment from your bulletin?"
    );
    if (!confirmed) return;

    button.disabled = true;

    const { data: comment, error } = await supabase
      .from("comments")
      .update({ content: null, deleted_by: isMine ? "commenter" : "author" })
      .eq("id", item.dataset.commentId)
      .select(commentColumns)
      .single();

    if (error) {
      console.error(error);
      button.disabled = false;
      alert("That comment couldn't be deleted. Please try again.");
      return;
    }

    item.replaceWith(createComment(comment, post));
    input.focus();
  });
}

function createComment(comment, post) {
  const item = document.createElement("li");
  item.dataset.commentId = comment.id;
  item.dataset.userId = comment.user_id;

  const commenterName = comment.profiles?.display_name ?? "Unknown";

  if (comment.deleted_by) {
    item.className = "text-stone-500 text-sm italic";
    item.textContent =
      comment.deleted_by === "author"
        ? `Comment removed by ${post.profiles?.display_name ?? "the author"}`
        : `Comment deleted by ${commenterName}`;
    return item;
  }

  item.className = "text-sm";
  item.innerHTML = `
    <div class="flex justify-between items-baseline gap-3">
      <p>
        <a class="comment-author font-semibold hover:underline"></a>
        <time class="ml-1 text-stone-500"></time>
      </p>
      <button type="button" class="comment-delete font-medium text-stone-500 hover:text-red-700">
        Delete
      </button>
    </div>
    <p class="comment-content mt-1 leading-6"></p>
  `;

  const authorLink = item.querySelector(".comment-author");
  authorLink.textContent = commenterName;
  if (comment.profiles) authorLink.href = `/u/${comment.profiles.username}`;

  const createdAt = new Date(comment.created_at);
  const timeElement = item.querySelector("time");
  timeElement.dateTime = createdAt.toISOString();
  timeElement.textContent = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(createdAt);

  item.querySelector(".comment-content").textContent = comment.content;

  // You can delete your own comments, and any comment on your own bulletin
  const deleteButton = item.querySelector(".comment-delete");
  deleteButton.hidden =
    currentUserId !== comment.user_id && currentUserId !== post.user_id;
  deleteButton.setAttribute(
    "aria-label",
    `Delete comment from ${commenterName}`
  );

  return item;
}

// One listener for every card, including cards added later
bulletinFeed.addEventListener("click", (event) => {
  const article = event.target.closest("article");
  if (!article) return;

  if (event.target.closest(".bulletin-edit")) {
    startEditing(article);
  } else if (event.target.closest(".bulletin-delete")) {
    deleteBulletin(article);
  }
});

function startEditing(article) {
  const contentElement = article.querySelector(".bulletin-content");
  const actions = article.querySelector(".bulletin-actions");

  const editForm = document.createElement("form");
  editForm.className = "mt-4";
  editForm.innerHTML = `
    <textarea
      name="content"
      rows="4"
      maxlength="500"
      required
      aria-label="Edit bulletin"
      class="block bg-stone-50 p-4 border border-stone-300 focus:border-stone-950 rounded-xl focus:outline-none w-full resize-y"
    ></textarea>

    <p class="edit-error mt-2 text-red-700 text-sm" role="alert"></p>

    <div class="flex justify-end gap-2 mt-3">
      <button type="button" class="edit-cancel px-4 py-2 border border-stone-300 hover:bg-stone-100 rounded-full font-medium text-sm">
        Cancel
      </button>
      <button type="submit" class="bg-stone-950 hover:bg-stone-700 disabled:opacity-50 px-4 py-2 rounded-full font-semibold text-white text-sm">
        Save
      </button>
    </div>
  `;

  const textarea = editForm.querySelector("textarea");
  const cancelButton = editForm.querySelector(".edit-cancel");
  const saveButton = editForm.querySelector('button[type="submit"]');
  const errorElement = editForm.querySelector(".edit-error");

  textarea.value = contentElement.textContent;

  contentElement.hidden = true;
  actions.hidden = true;
  article.append(editForm);
  textarea.focus();

  function cancelEditing() {
    editForm.remove();
    contentElement.hidden = false;
    actions.hidden = false;
    article.querySelector(".bulletin-edit").focus();
  }

  cancelButton.addEventListener("click", cancelEditing);

  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Escape") cancelEditing();
  });

  editForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorElement.textContent = "";

    const newContent = textarea.value.trim();

    if (!newContent) {
      textarea.focus();
      return;
    }

    saveButton.disabled = true;

    const { data: post, error } = await supabase
      .from("posts")
      .update({ content: newContent })
      .eq("id", article.dataset.postId)
      .select(postColumns)
      .single();

    saveButton.disabled = false;

    if (error) {
      console.error(error);
      errorElement.textContent =
        "Your changes couldn't be saved. Please try again.";
      return;
    }

    const updatedArticle = createBulletin(post);
    article.replaceWith(updatedArticle);
    loadImages(updatedArticle);
    updatedArticle.querySelector(".bulletin-edit").focus();
  });
}

async function deleteBulletin(article) {
  const confirmed = confirm("Delete this bulletin? This can't be undone.");
  const imagePaths = [...article.querySelectorAll("img[data-path]")].map(
    (img) => img.dataset.path
  );
  if (!confirmed) return;

  const { error } = await supabase
    .from("posts")
    .delete()
    .eq("id", article.dataset.postId);

  if (error) {
    console.error(error);
    alert("This bulletin couldn't be deleted. Please try again.");
    return;
  }

  article.remove();
  if (imagePaths.length > 0) {
    supabase.storage.from("post-images").remove(imagePaths);
  }
  bulletinInput.focus();

  if (bulletinFeed.children.length === 0) {
    feedStatus.hidden = false;
    // FIX 6: matches the message in loadFeed
    feedStatus.textContent = "No bulletins in the last 15 days. Post something!";
  }
}

supabase.auth.onAuthStateChange((event, session) => {
  currentUserId = session?.user.id ?? null;

  // Header links, on every page
  if (!session) {
    myProfileLink.hidden = true;
    requestsLink.hidden = true;
  } else if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
    setTimeout(() => {
      loadMyProfileLink();
      if (profileUsername) loadRequestCount();
    }, 0);
  }
  if (profileUsername) {
    if (!session) profileForm.hidden = true;

    if (event === "INITIAL_SESSION" || event === "SIGNED_OUT") {
      setTimeout(() => loadProfile(profileUsername), 0);
    }
    return;
  }
  if (!session) {
    bulletinFeed.replaceChildren();
    // FIX 2: removed loadImages(bulletinFeed) from here — the feed is empty after logout
    requestsSection.hidden = true;
    searchForm.reset();
    searchResults.replaceChildren();
    searchStatus.textContent = "";
    return;
  }

  if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
    // Run after the auth callback finishes (Supabase recommends this)
    setTimeout(() => {
      loadFeed();
      loadRequests();
    }, 0);
  }
});