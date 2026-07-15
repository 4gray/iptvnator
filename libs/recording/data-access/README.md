# Recording Data Access

Renderer-side data access for IPTVnator's Electron DVR feature.

`RecordingService`:

- checks the runtime and native recording capability
- exposes reactive recording, loading, support, error, and active-count state
- invokes the semantic `window.electron.recordings*` preload API
- reloads state when the main process emits a recording update

This library must not access the recording table through generic database IPC.
Stream credentials and absolute file paths stay in the Electron main process;
renderer state uses the sanitized `RecordingItem` contract.

See [`docs/architecture/dvr-recording.md`](../../../docs/architecture/dvr-recording.md)
for the complete ownership, security, and lifecycle contract.

## Running unit tests

```bash
pnpm nx test recording-data-access
```
