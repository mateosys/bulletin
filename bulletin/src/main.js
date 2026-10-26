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

// profile content
const profileDetails = document.querySelector("#profile-details");
const profileUsernameElement = document.querySelector("#profile-username");
const profileName = document.querySelector("#profile-name");
const profileBio = document.querySelector("#profile-bio");
const profileJoined = document.querySelector("#profile-joined");
const profileStatus = document.querySelector("#profile-status");
const profileFeed = document.querySelector("#profile-feed");

const maximumCharacters = bulletinInput.maxLength;

// The columns we want for every post, plus the author's profile
const postColumns =
  "id, user_id, content, created_at, updated_at, profiles (display_name, username)";

let currentUserId = null;

function updateCharacterCount() {
  const charactersRemaining = maximumCharacters - bulletinInput.value.length;
  characterCount.textContent = `${charactersRemaining} characters remaining`;
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

  publishButton.disabled = true;

  const { data: post, error } = await supabase
    .from("posts")
    .insert({ content })
    .select(postColumns)
    .single();

  publishButton.disabled = false;

  if (error) {
    console.error(error);
    postError.textContent =
      "Your bulletin couldn't be published. Please try again.";
    return;
  }

  bulletinFeed.prepend(createBulletin(post));

  feedStatus.hidden = true;

  bulletinForm.reset();
  updateCharacterCount();
  bulletinInput.focus();
});

async function loadFeed() {
  feedStatus.hidden = false;
  feedStatus.textContent = "Loading bulletins…";

  const { data: posts, error } = await supabase
    .from("posts")
    .select(postColumns)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    feedStatus.textContent =
      "Bulletins couldn't be loaded. Refresh to try again.";
    return;
  }

  bulletinFeed.replaceChildren(...posts.map((post) => createBulletin(post)));

  if (posts.length === 0) {
    feedStatus.textContent = "No bulletins yet. Post the first one!";
  } else {
    feedStatus.hidden = true;
  }
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
    profileStatus.textContent = "This profile couldn't be loaded. Refresh to try again.";
    return;
  }

  if (!profile) {
    document.title = "Not found · Bulletin";
    profileStatus.textContent = `No one goes by @${username} here.`;
    return;
  }

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

  profileDetails.hidden = false;
  profileStatus.textContent = "Loading bulletins…";

  const { data: posts, error: postsError } = await supabase
    .from("posts")
    .select(postColumns)
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false });

  if (postsError) {
    console.error(postsError);
    profileStatus.textContent = "Bulletins couldn't be loaded. Refresh to try again.";
    return;
  }

  profileFeed.replaceChildren(
    ...posts.map((post) => createBulletin(post, { showActions: false }))
  );

  profileStatus.textContent =
    posts.length === 0 ? `${profile.display_name} hasn't posted yet.` : "";
}

function createBulletin(post, { showActions = true } = {}) {
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
  `;

  const createdAt = new Date(post.created_at);
  const timeElement = article.querySelector("time");

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

  // Only show Edit and Delete on your own posts
  article.querySelector(".bulletin-actions").hidden =
  !showActions || post.user_id !== currentUserId;

  return article;
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
    updatedArticle.querySelector(".bulletin-edit").focus();
  });
}

async function deleteBulletin(article) {
  const confirmed = confirm("Delete this bulletin? This can't be undone.");
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
  bulletinInput.focus();

  if (bulletinFeed.children.length === 0) {
    feedStatus.hidden = false;
    feedStatus.textContent = "No bulletins yet. Post the first one!";
  }
}

supabase.auth.onAuthStateChange((event, session) => {
  currentUserId = session?.user.id ?? null;

  if (profileUsername) {
    if (event === "INITIAL_SESSION") {
      setTimeout(() => loadProfile(profileUsername), 0);
    }
    return;
  }
  
  if (!session) {
    bulletinFeed.replaceChildren();
    return;
  }

  if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
    // Run after the auth callback finishes (Supabase recommends this)
    setTimeout(loadFeed, 0);
  }
});
