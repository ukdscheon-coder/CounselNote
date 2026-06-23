# Building the Windows installer (CounselNote.exe)

Real Windows executables must be built on a Windows toolchain — they cannot
be reliably cross-compiled from Linux/macOS sandboxes. The included GitHub
Actions workflow (`.github/workflows/build-windows.yml`) does this for you
automatically using a free GitHub-hosted Windows runner.

## One-time setup

1. Push this folder to a **private** GitHub repository (never commit real
   pupil data — there shouldn't be any in this folder, but double check).
2. No extra secrets are required for the basic build.

## Build a release

```bash
git tag v1.0.0
git push origin v1.0.0
```

Pushing a tag starting with `v` triggers the workflow, which:

1. Installs Node 20 on a Windows runner.
2. Packages `server.js` into `CounselNote.exe` with `@yao-pkg/pkg`.
3. Copies `index.html`, `styles.css`, `app.js`, `README.md`, `LICENCE.txt`,
   `PRICING.md` next to the `.exe` (the server reads these from disk at
   runtime — they are not embedded — so the app stays easy to inspect and
   patch).
4. Adds a `Launch-CounselNote.bat` double-click launcher that starts the
   exe and opens the browser.
5. Zips everything as `CounselNote-Windows.zip`, generates a SHA-256
   checksum file, and attaches both to the GitHub Release for that tag.

## Manual test build (no tag/release)

Run the workflow manually from the **Actions** tab
("Build CounselNote Windows installer" → "Run workflow"). The zip is
attached as a workflow artefact instead of a release.

## What end users do

1. Download `CounselNote-Windows.zip` from the Release page (or your sales
   site, once you proxy the download — see `PAYMENT.md`).
2. Unzip it anywhere (e.g. `Documents\CounselNote`).
3. Double-click `Launch-CounselNote.bat`.
4. Windows SmartScreen will likely show "Windows protected your PC" because
   the .exe is unsigned. Until you buy a code-signing certificate, tell
   pilot schools to click **More info → Run anyway**. This is the single
   biggest blocker to a smooth non-technical rollout — budget for an EV
   code-signing certificate (~£200–400/year) before a public launch.

## Next hardening steps (not done yet)

- Code-sign `CounselNote.exe` (removes the SmartScreen warning).
- Optionally wrap with Inno Setup or NSIS for a proper installer with a
  Start Menu shortcut and uninstaller, instead of a zip + .bat.
- Auto-update is intentionally **not** included — this is local-first,
  offline software; ship update zips per version instead.
