# Synthetic playback fixtures

`live.mpegts` is six seconds of generated color-pattern video and a sine wave,
H.264 baseline + AAC, used by the local Xtream live-format regression account.
No real provider media or credentials are included.

Regenerate from the repository root with FFmpeg:

```sh
ffmpeg -f lavfi -i testsrc2=size=160x90:rate=25 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 6 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -g 25 -c:a aac -b:a 48k -f mpegts apps/web-e2e/src/fixtures/playback/live.mpegts
```

The mock returns the fixture only for synthetic live-format account media;
manifest and denied-segment routes return controlled 200/403 responses. Web and
Electron E2E tests check advancing playback, not HTTP status alone.
