# Story Builder — Android app (Capacitor)

The Story Builder can run as a **standalone Android app** for authoring content
on your phone, fully offline. It uses the exact same authoring UI and data
engine as the desktop tool, but runs everything **in the browser/WebView** — no
Node server and no game project on the phone.

Because the phone doesn't have the Godot game project, the Android app works by
**exporting a content pack (.zip)** that you copy into the game's `data/` folder
on your computer (then open Godot once to import images). It can also save/import
its own **project zip** so you can move work between devices.

---

## How it works

- The whole authoring engine (`lib/*.js`) is bundled to run in the browser via a
  small **virtual filesystem** (`webapp/src/vfs.js`) — the same reader,
  generator, validator and `.po` writer, unchanged.
- On first launch the app **seeds** itself from `base-data.zip` (a snapshot of
  the current game `data/` folder), so you start by editing the real story.
- Your edits (model + images) persist on-device in **IndexedDB** and survive
  app restarts.
- Two exports:
  - **Save project** — a `story-project.zip` you can re-import later or on
    another device.
  - **Export content pack** — a `data/` zip to drop into the game project.

The desktop server (`npm start`) is unchanged and still writes directly into
`data/`.

---

## Building the APK

Requirements:
- Node.js (already used for the tool)
- Android SDK (e.g. from Android Studio) at `~/Library/Android/sdk`
- **JDK 21** (Capacitor 8 plugins require it). On macOS: `brew install openjdk@21`

Then, from `tools/story-builder`:

```
npm install          # once
npm run android:apk  # assembles web app, syncs Capacitor, builds debug APK
```

The APK is written to:
```
android/app/build/outputs/apk/debug/app-debug.apk
```

Install it on a connected device:
```
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Or open the project in Android Studio:
```
npx cap open android
```

### Build steps individually
```
npm run build:engine   # bundle lib/*.js -> webapp/src/engine-lib.js
npm run build:seed     # snapshot game data/ -> webapp/base-data.zip
npm run build:www      # assemble webapp/www/ (all of the above + copy assets)
npm run android:sync   # build:www + npx cap sync android
```

> Re-run `npm run build:seed` whenever you want the app's starting data to match
> the current game `data/` folder.

---

## Using the app

1. Launch it — it opens pre-loaded with the current story.
2. Author chapters, levels, narratives, effects, shards, and world-map placement
   exactly like the desktop tool.
3. Tap **Export content pack** (top bar) to produce `content-pack.zip`. Use the
   Android share sheet to send it to your computer (email, cloud, cable, etc.).
4. On the computer: unzip and copy its `data/` folder into the game project
   (overwrite; back up first), then open the project in Godot once so it imports
   any new images.
5. **Save project** produces `story-project.zip` — keep it as a backup or import
   it (top bar → **Import project**) on another device to continue editing.

---

## Notes / limitations

- The app cannot write into the game's `data/` folder directly (the phone
  doesn't have the project) — it always goes through the content-pack zip.
- Godot image import can only happen on the computer; the content pack README
  reminds you to open Godot once.
- `base-data.zip` is ~66 MB (mostly story images), so the APK is ~70 MB.
- Files under `webapp/www/`, `webapp/base-data.zip`, `webapp/src/engine-lib.js`
  and the Android build outputs are generated — they're git-ignored.
