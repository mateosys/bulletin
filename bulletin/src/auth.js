import { supabase } from "./supabase.js";

const authSection = document.querySelector("#auth-section");
const board = document.querySelector("#board");
const logoutButton = document.querySelector("#logout-button");

const authForm = document.querySelector("#auth-form");
const authHeading = document.querySelector("#auth-heading");
const signupFields = document.querySelector("#signup-fields");
const usernameInput = document.querySelector("#username");
const passwordInput = document.querySelector("#password");
const authSubmit = document.querySelector("#auth-submit");
const authToggle = document.querySelector("#auth-toggle");
const authTogglePrompt = document.querySelector("#auth-toggle-prompt");
const authMessage = document.querySelector("#auth-message");

let mode = "login";

// Switch the form between "log in" and "sign up"
function setMode(newMode) {
  mode = newMode;
  const isSignup = mode === "signup";

  signupFields.hidden = !isSignup;
  signupFields.disabled = !isSignup;

  authHeading.textContent = isSignup ? "Create your account" : "Log in";
  authSubmit.textContent = isSignup ? "Sign up" : "Log in";
  authTogglePrompt.textContent = isSignup ? "Already have an account?" : "New to Bulletin?";
  authToggle.textContent = isSignup ? "Log in" : "Create an account";
  passwordInput.autocomplete = isSignup ? "new-password" : "current-password";

  authMessage.textContent = "";
}

authToggle.addEventListener("click", () => {
  setMode(mode === "login" ? "signup" : "login");
});

// Lowercase usernames as they're typed
usernameInput.addEventListener("input", () => {
  usernameInput.value = usernameInput.value.toLowerCase();
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authMessage.textContent = "";
  authSubmit.disabled = true;

  const formData = new FormData(authForm);
  const email = formData.get("email").trim();
  const password = formData.get("password");

  try {
    if (mode === "signup") {
      const username = formData.get("username").trim();
      const displayName = formData.get("display_name").trim();
      await signUp(email, password, username, displayName);
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
    authForm.reset();
  } catch (error) {
    authMessage.textContent = error.message;
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

// Show the right view for whoever is (or isn't) logged in
function showView(session) {
  const isLoggedIn = Boolean(session);
  authSection.hidden = isLoggedIn;
  board.hidden = !isLoggedIn;
  logoutButton.hidden = !isLoggedIn;
}

supabase.auth.onAuthStateChange((event, session) => {
  showView(session);
});

logoutButton.addEventListener("click", async () => {
  await supabase.auth.signOut();
});