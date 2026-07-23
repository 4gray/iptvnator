# Recording Feature

Presentation layer for IPTVnator's local DVR recording library. The standalone
`RecordingLibraryComponent` is lazy-loaded at `/workspace/recordings` and
provides All, Upcoming, and Library filters plus cancel, play, reveal, and
remove actions.

Removing an entry deletes its SQLite metadata only; it does not delete the
recorded media file. Runtime state and Electron bridge calls belong in
`@iptvnator/recording/data-access` rather than this feature library.

See [`docs/architecture/dvr-recording.md`](../../../docs/architecture/dvr-recording.md)
for runtime limitations and state transitions.

## Running unit tests

```bash
pnpm nx test recording-feature
```
