# Building and releasing

## Desktop app

```bash
pnpm install
```

```bash
pnpm --filter @jobhunter/desktop dist
```

This builds the web UI, the engine bundle and the Electron main process, then runs electron-builder for the current OS. The output goes to `apps/desktop/release/`:

- macOS: `.dmg` and `.zip`
- Windows: NSIS installer `.exe`
- Linux: `.AppImage` and `.deb`

For a quick unpacked build to try out, run `node apps/desktop/scripts/package.mjs --dir` after `pnpm --filter @jobhunter/desktop build`, then start `apps/desktop/release/linux-unpacked/jobhunter` (or the `mac`/`win-unpacked` equivalent).

How it is put together:

- The engine runs in an Electron **utility process** (Electron's own Node runtime) on a free localhost port; the window loads the UI from it.
- Native modules (better-sqlite3, the keychain binding, argon2) are rebuilt for Electron by electron-builder.
- The official Claude Code binary ships inside the Agent SDK's platform package. Jobhunter only runs it.
- Playwright's Chromium is downloaded on first start into the app's data folder (about 150 MB, one time). It is used for PDFs and for applying.
- The app keeps running in the tray, so the daily scan and email checks still happen with the window closed. After the computer wakes from sleep it catches up on missed jobs. The tray menu has *Start at login*.

### Code signing

Release builds are **unsigned**, because signing needs paid certificates (Apple Developer Program, a Windows code-signing certificate). Because of that:

- macOS: the first time, right-click the app → *Open*, or run the command below.

  ```bash
  xattr -dr com.apple.quarantine /Applications/Jobhunter.app
  ```

- Windows: SmartScreen shows *Windows protected your PC* → *More info* → *Run anyway*.

To sign your own builds, set the usual electron-builder variables (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) and remove `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` from the release workflow.

## Server image

```bash
docker build -f docker/Dockerfile -t jobhunter .
```

See [SERVER.md](SERVER.md) to run it.

## Releasing

1. Update `version` in `apps/desktop/package.json` and `apps/engine/package.json`.
2. Tag and push:

   ```bash
   git tag v0.1.0 && git push origin v0.1.0
   ```

3. `.github/workflows/release.yml` builds the installers on macOS, Windows and Linux, pushes the multi-arch image to `ghcr.io/<owner>/jobhunter`, and creates a **draft** GitHub release with the installers attached. Review it and publish.
