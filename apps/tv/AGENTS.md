# IPTVnator TV

This is the Preact/Vite client shared by LG webOS and Samsung Tizen. Read the
[TV architecture](../../docs/architecture/tv-application.md) for runtime and
provider contracts.

## Local development

After the workspace dependency install, run `pnpm nx serve tv` from the
repository root and open <http://localhost:4310>. Use the arrow keys, Enter and
Escape to exercise directional navigation, OK and Back.

For provider requests and QR setup, start the matching web backend using the
[TV development guide](../../docs/development/tv-development.md). Allow the exact
browser origin in `CLIENT_URL` and enter the backend URL in TV Settings.

## Validation

- `pnpm nx test tv` runs the TV unit tests.
- `pnpm nx e2e tv-e2e` starts isolated services and checks browser flows with
  synthetic sources in Playwright Chromium.
- `pnpm nx run tv:verify-build` checks the build and TV package inputs. Use the
  [development guide](../../docs/development/tv-development.md) for device checks,
  including native playback and physical remote behavior.
