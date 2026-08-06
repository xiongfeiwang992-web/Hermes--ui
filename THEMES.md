# Hermes UI — Themes

Hermes UI inherits the OpenClaw two-axis appearance model and adds a **Hermes** gold theme as the default.

## Axes

- **Theme** — accent palette and surface mood: `hermes` (default), `claw`, `knot`, `dash`, or `custom`
- **Mode** — brightness: `system`, `light`, or `dark`

Themes combine independently. For example, Hermes + Light yields the warm parchment light palette with gold accents.

## Built-in Themes

| Theme | Description |
|-------|-------------|
| **Hermes** (default) | Deep navy with warm gold accents. Matches the classic Hermes agent look. |
| **Claw** | Punchy red accent on layered dark surfaces (OpenClaw default). |
| **Knot** | Crimson accent on true-black canvas. |
| **Dash** | Chocolate brown accent on deep cocoa tones. |

## Usage

```ts
import { applyThemeToDocument, parseThemeSelection, resolveTheme } from "./app/theme.ts";

const { theme, mode } = parseThemeSelection("hermes", "system");
const resolved = resolveTheme(theme, mode);
applyThemeToDocument(resolved, mode);
```

Resolved theme names map to CSS selectors:

| Resolved | CSS |
|----------|-----|
| `hermes` | `:root[data-theme="hermes"]` |
| `hermes-light` | `:root[data-theme="hermes-light"]` |
| `dark` / `light` | Claw family (base `:root` tokens) |
| `openknot` / `openknot-light` | Knot family |
| `dash` / `dash-light` | Dash family |

## Preview

```bash
cd ui
npm install
npm run dev
```

Settings persist in `localStorage` under `hermes.ui.settings.v1`. The inline boot script in
`public/index.html` applies the saved theme before CSS loads to prevent a flash of the wrong palette.

## Runtime API

```ts
import { createThemeManager, parseThemeCommand } from "./index.ts";

const themeManager = createThemeManager();
themeManager.setTheme("hermes");
themeManager.setThemeMode("system");
themeManager.setTextScale(110);
themeManager.applyCommand("/theme dark");
themeManager.dispose();
```

## Slash commands

| Command | Effect |
|---------|--------|
| `/theme hermes` | Switch to Hermes gold theme |
| `/theme claw` | Switch to Claw theme |
| `/theme knot` | Switch to Knot theme |
| `/theme dash` | Switch to Dash theme |
| `/theme light` | Force light mode |
| `/theme dark` | Force dark mode |
| `/theme system` | Follow OS appearance |

## Custom Skins

Add a new block to `ui/src/styles/base.css`:

```css
:root[data-theme="my-theme"] {
  --accent: #2e7d32;
  /* ... */
}

:root[data-theme="my-theme-light"] {
  --accent: #1b5e20;
  /* ... */
}
```

Then register the name in `ui/src/app/theme.ts` (`ThemeName`, `resolveTheme`, and `THEME_OPTIONS`).
