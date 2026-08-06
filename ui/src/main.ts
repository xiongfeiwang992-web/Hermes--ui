import { createThemeManager } from "./app/theme-manager.ts";
import { TEXT_SCALE_STOPS } from "./app/theme-command.ts";
import { THEME_MODE_OPTIONS, THEME_OPTIONS } from "./app/theme.ts";
import "./styles/base.css";
import "./styles/layout.css";

const themeManager = createThemeManager();

const resolvedThemeEl = document.getElementById("resolved-theme");
const themeRow = document.getElementById("theme-chips");
const modeRow = document.getElementById("mode-chips");
const scaleRow = document.getElementById("scale-chips");
const composerInput = document.getElementById("composer-input") as HTMLTextAreaElement | null;
const composerForm = document.getElementById("composer-form") as HTMLFormElement | null;
const chatLog = document.getElementById("chat-log");

function appendSystemMessage(text: string) {
  if (!chatLog) {
    return;
  }
  const article = document.createElement("article");
  article.className = "hermes-msg";
  article.innerHTML = `
    <div class="hermes-msg-label">System</div>
    <div class="hermes-msg-body"></div>
  `;
  article.querySelector(".hermes-msg-body")!.textContent = text;
  chatLog.appendChild(article);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function renderMeta() {
  if (!resolvedThemeEl) {
    return;
  }
  const { theme, themeMode, textScale } = themeManager.settings;
  resolvedThemeEl.textContent =
    `${themeManager.resolved} · theme=${theme} · mode=${themeMode} · scale=${textScale}%`;
}

function renderChips() {
  document.querySelectorAll("[data-theme-chip]").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.themeChip === themeManager.settings.theme);
  });
  document.querySelectorAll("[data-mode-chip]").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.modeChip === themeManager.settings.themeMode);
  });
  document.querySelectorAll("[data-scale-chip]").forEach((chip) => {
    chip.classList.toggle(
      "active",
      Number(chip.dataset.scaleChip) === themeManager.settings.textScale,
    );
  });
}

function render() {
  renderMeta();
  renderChips();
}

if (themeRow) {
  for (const option of THEME_OPTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hermes-chip";
    button.dataset.themeChip = option.id;
    button.textContent = option.label;
    button.title = option.description;
    button.addEventListener("click", () => {
      themeManager.setTheme(option.id, button);
      render();
    });
    themeRow.appendChild(button);
  }
}

if (modeRow) {
  for (const option of THEME_MODE_OPTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hermes-chip";
    button.dataset.modeChip = option.id;
    button.textContent = option.label;
    button.addEventListener("click", () => {
      themeManager.setThemeMode(option.id, button);
      render();
    });
    modeRow.appendChild(button);
  }
}

if (scaleRow) {
  for (const stop of TEXT_SCALE_STOPS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hermes-chip";
    button.dataset.scaleChip = String(stop);
    button.textContent = `${stop}%`;
    button.addEventListener("click", () => {
      themeManager.setTextScale(stop, button);
      render();
    });
    scaleRow.appendChild(button);
  }
}

composerForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = composerInput?.value.trim() ?? "";
  if (!value) {
    return;
  }

  if (value.startsWith("/theme")) {
    const result = themeManager.applyCommand(value);
    appendSystemMessage(result.message);
    render();
    if (composerInput) {
      composerInput.value = "";
    }
    return;
  }

  appendSystemMessage(`Demo mode: message not sent. Try "/theme hermes" or "/theme dark".`);
  if (composerInput) {
    composerInput.value = "";
  }
});

themeManager.subscribe(render);
render();
