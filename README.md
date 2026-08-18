# Story Builder

A simple, friendly tool for building the game's story **without touching code or
JSON**. You arrange images into a sequence of chapters, type the dialogue, pick a
difficulty, set the rewards, and add collectible "shard" items. The tool writes
all the game data files for you.

It works on a computer (Windows, Mac, Linux) and on an Android phone's web
browser.

---

## What you can do

- **Chapters** — the heart of the story. Each chapter is:
  - one **story image**,
  - a few lines of **dialogue** shown over that image,
  - a **level** (choose Easy / Medium / Hard — the tool fills in the details),
  - the **rewards** for finishing (coins, gems, an optional booster, and a
    collectible card that uses the story image).
- **Shards** — collectible items players unlock. Each has a name, an image,
  a rarity, a category, and how many shards are needed to unlock it.
- **Save into the game** or **download a content pack (.zip)** to move to
  another computer.

---

## First-time setup (computer)

You need **Node.js** installed (https://nodejs.org — the "LTS" version is fine).

1. Open a terminal in this folder: `tools/story-builder`
2. Run once:
   ```
   npm install
   ```
3. Start it:
   ```
   npm start
   ```
4. It prints two web addresses. Open the **Desktop** one in your browser:
   ```
   http://localhost:3000
   ```

The first time it runs, it loads the story that's **already in the game**, so you
start by editing real content — not a blank page.

---

## Using it on an Android phone

1. Start the tool on your **computer** (`npm start`) and keep it running.
2. Make sure the phone is on the **same Wi‑Fi** as the computer.
3. The terminal prints a **Phone** address like `http://192.168.0.61:3000`.
   Type that into the phone's browser.
4. You can now add photos straight from the phone.

> Fully offline / no computer? Use **Download content pack (.zip)** instead
> (see below) and hand the zip to whoever manages the game project.

---

## The screens

### Chapters
- **+ Add chapter** adds a new chapter at the end.
- Tap the image box to choose a picture (or drag one in on a computer).
- Type each **dialogue line**; set how many **seconds** it stays on screen.
- **Multiple images before a level:** each dialogue line is its own on-screen
  "slide". By default every slide uses the chapter image, but you can give any
  slide its **own image** (the small image box next to the text). So one chapter
  can show several different images in sequence before the level starts — add a
  dialogue line per image. Use **"Use chapter image"** to clear a slide's
  override.
- Add **visual effects** to any dialogue screen with **+ Add effect…**:
  flash, background tint, darken, brighten, vignette, shake, or a particle
  burst. Each effect has a couple of sliders/values you can adjust. Remove one
  with the **✕** next to it.
- Pick **Difficulty** and the reward **coins / gems / booster** and **card rarity**.
- Reorder with the **▲ ▼** buttons or by dragging the **⠿** handle.
- **▶ Preview** plays the chapter right in the browser — images, dialogue,
  per-slide effects, and auto-advance timing — so you can check the flow before
  saving. Use ◀/▶ (or arrow keys), toggle **Auto**, **Replay**, or **Close**
  (Esc). Note: the preview is a close approximation, not an exact copy of the
  in-game look (fonts, shaders and particles differ slightly between the browser
  and the game engine) — always do a final check in the actual game.
- **🗺 World-map placement** opens a map editor for the chapter: set the chapter's
  **map background image** and a **fallback colour**, then **drag the level marker**
  onto the artwork to position it. Positions use the game's 720 × 900 per-chapter
  canvas. Each story chapter becomes one world-map chapter with one level marker.
- **⧉** duplicates a chapter, **✕** deletes it.

### Shards
- **+ Add shard item**, then give it a name, image, rarity, category, and how
  many shards unlock it.

### Save & Export
- **Check now** looks for problems and explains them in plain English.
- **Save into the game** writes everything into the game's `data` folder.
- **Download content pack (.zip)** gives you a zip to copy onto another machine.
- **Reload from game** throws away your changes here and reloads what's in the
  game right now.

---

## After you save — one important step

When you add **new images**, open the game project in **Godot once**. Godot
imports the new pictures automatically. You only need to do this after adding new
images. (If you saved on the same computer where Godot is installed, the tool
tries to remind you.)

---

## Good to know

- Your work is **auto-saved** as you go (see "Saved" in the top-right). It's
  stored in `project.json` in this folder, so it survives closing the tool.
- Editing existing chapters keeps everything else in the game intact — the tool
  is careful not to change reward chest visuals, translations for other
  languages, or anything you didn't touch.
- Text is authored in **English**. Other languages (Spanish, Portuguese, French)
  keep any existing translations and fall back to English until a translator
  fills them in.

---

## For developers

- `server.js` — Express server + JSON API.
- `lib/reader.js` — reads the game `data/` into an editable model.
- `lib/generator.js` — writes the model back out to all data files
  (`experience_flows`, `narrative_stages`, `levels`, `collections`,
  `gallery_items.json`, and `translations/core/*.po`), preserving naming
  conventions and hand-tuned values on round-trip.
- `lib/po.js` — gettext `.po` read/write matching `systems/TranslationBootstrap.gd`.
- `lib/zip.js` — content-pack export.
- `lib/validate.js` — plain-English validation.
- `scripts/verify_roundtrip.js` — proves read→generate preserves the existing
  game data (`npm run verify`).

Run the fidelity check:
```
npm run verify
```

---

## Android app

The Story Builder also runs as a standalone **Android app** (Capacitor) for
authoring on your phone, fully offline, exporting a content-pack zip. See
[ANDROID.md](ANDROID.md) for build and usage instructions.

## Repo notes (data is NOT committed)

This repository contains only the tool's **source**. It does **not** include any
game data. The following are generated/excluded (see `.gitignore`):

- `webapp/base-data.zip` — a snapshot of the game's `data/` folder used to seed
  the Android app. Regenerate with `npm run build:seed` (run from a checkout that
  sits at `<game-project>/tools/story-builder`, so it can read `../../data`).
- `webapp/www/`, `webapp/src/engine-lib.js` — generated web bundle
  (`npm run build:www`).
- Android build outputs and APKs.

The desktop server (`npm start`) and the seed build both expect this folder to
live inside the Godot game project at `tools/story-builder/` so they can read and
write the game's `data/` folder two levels up. When used as a standalone repo,
place it there (or set the data root) before running those data-touching
commands. The Android app itself is self-contained once `base-data.zip` is built.
