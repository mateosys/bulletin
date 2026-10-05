import "./style.css";

const bulletinForm = document.querySelector("#bulletin-form");
const bulletinInput = document.querySelector("#bulletin-content");
const characterCount = document.querySelector("#character-count");
const bulletinFeed = document.querySelector("#bulletin-feed");

const maximumCharacters = bulletinInput.maxLength;

bulletinInput.addEventListener("input", () => {
  const charactersUsed = bulletinInput.value.length;
  const charactersRemaining = maximumCharacters - charactersUsed;

  characterCount.textContent = `${charactersRemaining} characters remaining`;
});

bulletinForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const bulletinContent = bulletinInput.value.trim();

  if (!bulletinContent) {
    bulletinInput.focus();
    return;
  }

  const newBulletin = createBulletin(bulletinContent);

  bulletinFeed.prepend(newBulletin);

  bulletinForm.reset();
  characterCount.textContent = `${maximumCharacters} characters remaining`;
  bulletinInput.focus();
});

function createBulletin(content) {
  const article = document.createElement("article");
  const currentDate = new Date();

  article.className =
    "rounded-2xl border border-stone-300 bg-white p-5";

  article.innerHTML = `
    <header class="flex items-start justify-between gap-4">
      <div>
        <h3 class="font-semibold">Mateo</h3>

        <p class="text-sm text-stone-500">
          <time></time>
        </p>
      </div>

      <button
        type="button"
        class="text-sm font-medium text-stone-500 hover:text-stone-950"
      >
        Edit
      </button>
    </header>

    <p class="bulletin-content mt-4 leading-7"></p>
  `;

  const timeElement = article.querySelector("time");
  const contentElement = article.querySelector(".bulletin-content");

  timeElement.dateTime = currentDate.toISOString();

  timeElement.textContent = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(currentDate);

  contentElement.textContent = content;

  return article;
}