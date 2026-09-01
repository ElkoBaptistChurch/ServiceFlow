# ServiceFlow

ServiceFlow is a small Windows app for running Bible verses and song lyrics
into an OBS live stream during a church service. An operator searches or
staged content ahead of time, then puts it live with one click. OBS picks it
up over the network as a normal Browser Source — no OBS plugin required.

This document is for whoever installs and runs ServiceFlow at the church. It
assumes no programming background.

## 1. Building the installer

**ServiceFlow's installer must be built on a Windows PC.** It cannot be built
on Linux or WSL.

The reason: ServiceFlow uses a small embedded database (`better-sqlite3`)
that has to be compiled specifically for Windows and for the exact version of
Electron (the app framework) that ships inside the installer. That compile
step can only run on Windows itself — there's no way to cross-build it from a
different operating system that also produces a trustworthy result. If it's
attempted anyway, either the build fails outright, or it succeeds but the
installer's database silently breaks the first time the app is opened.

To build it, on a Windows PC with [Node.js](https://nodejs.org) installed:

```
git clone <the ServiceFlow repository>
cd ServiceFlow
npm install
npm run rebuild:electron
npm run package
```

**Do not skip `npm run rebuild:electron`.** `npm install` does *not* compile
the database module for the app framework automatically — that is
deliberate, since doing it automatically would make the database module
unusable by the project's own automated tests. `npm run rebuild:electron` is
the step that compiles it correctly for the app; skipping it produces an
installer whose database silently fails the first time the app is opened.
When `npm run package` finishes, the installer is at:

```
release\ServiceFlow-Setup-0.1.0.exe
```

If you'd rather not build by hand, these same steps already run automatically
in GitHub Actions on a Windows machine (`.github/workflows/build.yml`), on
every push to `main` and on demand from the repository's **Actions** tab. Each
run attaches the finished installer as a downloadable artifact named
`ServiceFlow-Setup`.

To publish an installer somewhere easier to point people at, push a version
tag and it lands on the repository's **Releases** page:

```
git tag v0.1.0
git push origin v0.1.0
```

Copy that one `.exe` file to the church's PC (a USB drive or a file share both
work fine) and continue with installing, below.

## 2. Installing

Double-click `ServiceFlow-Setup-0.1.0.exe` on the church's Windows PC.

**You will see a blue "Windows protected your PC" warning from SmartScreen.**
This is expected — it appears for any installer that hasn't paid Microsoft
for a code-signing certificate, not because anything is wrong with
ServiceFlow. To get past it:

1. Click **"More info"** (small text, easy to miss, on the warning window).
2. Click **"Run anyway"**.

The installer then lets you choose an install location and offers to create a
desktop shortcut — leave both at their defaults unless you have a reason not
to. Launch ServiceFlow from that shortcut when it finishes.

## 3. Setting up the OBS Browser Source

1. Open ServiceFlow and go to **Settings**. Under "OBS Browser Source URLs"
   you'll see one or two web addresses (they look like
   `http://localhost:PORT/output` and, if OBS is on a different computer,
   `http://192.168.x.x:PORT/output`).
2. In OBS: **Sources → + → Browser Source** (create a new one).
3. Paste in the correct URL from ServiceFlow's Settings screen — use the
   `localhost` one if OBS runs on the same PC as ServiceFlow, or the network
   (`192.168.x.x`) one if OBS is on a different computer.
4. Set **Width** and **Height** to match your stream's resolution (for
   example 1920 x 1080).
5. Leave **"Shutdown source when not visible"** unchecked.
6. The output background is already transparent — no extra checkbox needed.
   Place the Browser Source above your camera source in OBS's source list and
   the verse/lyric text will overlay the camera feed correctly.

**Important — there is no manual port to set.** ServiceFlow automatically
finds a free port on the PC each time it starts; it doesn't always use the
same one. **Always copy the URL currently shown on the Settings screen** —
don't reuse a URL you wrote down previously, and don't try to force a
particular port number in OBS or anywhere else. If the port ever changes
(for example, another program was using ServiceFlow's usual port), just
re-copy the new URL from Settings into the existing OBS Browser Source.

## 4. Running with OBS on a second computer

ServiceFlow and OBS don't have to be on the same PC. If they're on separate
machines connected to the same church Wi-Fi/network:

- Use the network URL (the one starting with `http://192.168...` rather than
  `http://localhost...`) from ServiceFlow's Settings screen.
- Both computers need to be on the same local network (same church Wi-Fi or
  wired network) — this does not work over the internet.
- If the OBS machine can't load the page, double check both PCs are on the
  same network and that no firewall prompt was dismissed with "block" instead
  of "allow" the first time ServiceFlow ran.

## 5. Importing from OpenLP

ServiceFlow reuses the church's existing OpenLP song and Bible files rather
than requiring content to be re-entered by hand.

1. In ServiceFlow, go to **Settings → Import from OpenLP**.
2. Click **"Import from OpenLP"** and select the OpenLP database file(s) —
   the songs database and any Bible translation files. ServiceFlow figures
   out which file is which automatically; you don't need to sort them first.
3. When the import finishes, a summary lists each file, how many songs or
   verses were imported, and anything skipped.

**Re-running the import is always safe.** If OpenLP's content changes later
(new songs added, a fuller Bible translation downloaded), just repeat the
same import — it replaces the previous data for the same source cleanly and
won't create duplicates. The one thing to avoid is importing in the middle of
a live service, since anything currently on air could reference content that
import step replaces.

## Known limits

- **NET and NKJV are partial sample files as shipped with the church's OpenLP
  install** — 106 and 152 verses respectively, versus KJV's full 36,503.
  Until fuller NET/NKJV database files are downloaded (in OpenLP) and
  re-imported into ServiceFlow, those two translations will look almost
  entirely empty when browsing or searching. KJV is complete and unaffected.
- This is a v1 build: no auto-update and no code signing (hence the
  SmartScreen warning above), single-operator use only, and no in-app preview
  of the OBS output — use OBS's own source preview to confirm what's live.
- Song titles must be unique within an import: two OpenLP songs sharing the
  exact same title would merge into one on import. This isn't the case
  today — all 556 imported titles are distinct — but worth knowing if the
  church's song list grows.
- Because the NKJV file is only a partial sample, browsing to a book it has
  no verses for (Romans, for example) shows an empty chapter list with no
  explanation. KJV is unaffected.
