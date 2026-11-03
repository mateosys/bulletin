import { supabase } from "./supabase.js";
import { profileUsername } from "./route.js";

const profileSection = document.querySelector("#profile-section");
const loginLink = document.querySelector("#login-link");

const authSection = document.querySelector("#auth-section");
const board = document.querySelector("#board");
const logoutButton = document.querySelector("#logout-button");

// Authorizing QS
const authForm = document.querySelector("#auth-form");
const authHeading = document.querySelector("#auth-heading");
const signupFields = document.querySelector("#signup-fields");
const usernameInput = document.querySelector("#username");
const emailInput = document.querySelector("#email"); // NEW
const passwordInput = document.querySelector("#password");
const authSubmit = document.querySelector("#auth-submit");
const authToggle = document.querySelector("#auth-toggle");
const authTogglePrompt = document.querySelector("#auth-toggle-prompt");
const authMessage = document.querySelector("#auth-message");

// NEW: password reset elements
const passwordField = document.querySelector("#password-field");
const forgotPasswordButton = document.querySelector("#forgot-password");
const newPasswordSection = document.querySelector("#new-password-section");
const newPasswordForm = document.querySelector("#new-password-form");
const newPasswordInput = document.querySelector("#new-password");
const confirmPasswordInput = document.querySelector("#confirm-password");
const newPasswordMessage = document.querySelector("#new-password-message");
const newPasswordSubmit = document.querySelector("#new-password-submit");

let mode = "login"; // "login", "signup" or "reset"
let recovering = false; // NEW: true while someone is setting a new password

// NEW: one place to show a message, in red for errors or green for good news
function showAuthMessage(text, tone = "error") {
  authMessage.textContent = text;
  authMessage.className = tone === "error" ? "text-red-700 text-sm" : "text-green-800 text-sm";
}

// Switch the form between "log in", "sign up" and "reset password"
function setMode(newMode) {
  mode = newMode;
  const isSignup = mode === "signup";
  const isReset = mode === "reset"; // NEW

  signupFields.hidden = !isSignup;
  signupFields.disabled = !isSignup;

  // NEW: resetting only needs an email, so hide and disable the password field
  passwordField.hidden = isReset;
  passwordInput.disabled = isReset;
  forgotPasswordButton.hidden = mode !== "login";

  // CHANGED: each piece of text now has a "reset" version too
  authHeading.textContent = isSignup
    ? "Create your account"
    : isReset
      ? "Reset your password"
      : "Log in";
  authSubmit.textContent = isSignup ? "Sign up" : isReset ? "Send reset link" : "Log in";
  authTogglePrompt.textContent = isSignup
    ? "Already have an account?"
    : isReset
      ? "Remembered it?"
      : "New to Bulletin?";
  authToggle.textContent = mode === "login" ? "Create an account" : "Log in";
  passwordInput.autocomplete = isSignup ? "new-password" : "current-password";

  showAuthMessage("");
}

// CHANGED: from sign up or reset, this always goes back to log in
authToggle.addEventListener("click", () => {
  setMode(mode === "login" ? "signup" : "login");
});

// NEW
forgotPasswordButton.addEventListener("click", () => {
  setMode("reset");
  emailInput.focus();
});

// Lowercase usernames as they're typed
usernameInput.addEventListener("input", () => {
  usernameInput.value = usernameInput.value.toLowerCase();
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showAuthMessage("");
  authSubmit.disabled = true;

  const formData = new FormData(authForm);
  const email = formData.get("email").trim();
  const password = formData.get("password");

  try {
    if (mode === "signup") {
      const username = formData.get("username").trim();
      const displayName = formData.get("display_name").trim();
      await signUp(email, password, username, displayName);
    } else if (mode === "reset") {
      // NEW: email a reset link that brings them back to this site
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/`,
      });
      if (error) throw error;

      // Same message whether or not the account exists,
      // so this form can't be used to check who has an account
      showAuthMessage(
        "If an account uses that email, a reset link is on its way. Check your inbox.",
        "success"
      );
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
    authForm.reset();
  } catch (error) {
    showAuthMessage(error.message);
  } finally {
    authSubmit.disabled = false;
  }
});

async function signUp(email, password, username, displayName) {
  // Check the username first so people get a clear message
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();

  if (existing) {
    throw new Error(`The username "${username}" is already taken.`);
  }

  // The trigger reads this "data" to create the profile
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username, display_name: displayName },
    },
  });

  if (error) throw error;
}

// NEW: save the new password from the reset link
newPasswordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  newPasswordMessage.textContent = "";

  if (newPasswordInput.value !== confirmPasswordInput.value) {
    newPasswordMessage.textContent = "The passwords don't match.";
    confirmPasswordInput.focus();
    return;
  }

  newPasswordSubmit.disabled = true;

  const { error } = await supabase.auth.updateUser({
    password: newPasswordInput.value,
  });

  newPasswordSubmit.disabled = false;

  if (error) {
    newPasswordMessage.textContent = error.message;
    return;
  }

  // Done: leave the reset form and go to the board
  recovering = false;
  newPasswordForm.reset();

  const {
    data: { session },
  } = await supabase.auth.getSession();
  showView(session);
  document.querySelector("#bulletin-content").focus();
});

// Show the right view for whoever is (or isn't) logged in
function showView(session) {
  const isLoggedIn = Boolean(session);
  const onProfile = Boolean(profileUsername);

  authSection.hidden = onProfile || isLoggedIn;
  board.hidden = onProfile || !isLoggedIn;
  profileSection.hidden = !onProfile;

  logoutButton.hidden = !isLoggedIn;
  loginLink.hidden = isLoggedIn || !onProfile;

  // NEW: while setting a new password, show only that form
  newPasswordSection.hidden = !recovering;
  if (recovering) {
    authSection.hidden = true;
    board.hidden = true;
    profileSection.hidden = true;
  }
}

supabase.auth.onAuthStateChange((event, session) => {
  // NEW: Supabase sends this when someone arrives from a reset link
  if (event === "PASSWORD_RECOVERY") {
    recovering = true;
    setTimeout(() => newPasswordInput.focus(), 0);
  }

  // NEW: logging out cancels a reset in progress
  if (event === "SIGNED_OUT") recovering = false;

  showView(session);
});

logoutButton.addEventListener("click", async () => {
  await supabase.auth.signOut();
});