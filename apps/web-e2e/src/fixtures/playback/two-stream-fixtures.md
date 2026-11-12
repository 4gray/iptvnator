# Two-stream fixtures

`two-stream-vod.webm` and `two-stream-live.webm` are generated test patterns,
not provider media. Both last 60 seconds at 160×90 / 10 fps. Different hue
and quiet 330/660 Hz mono tones make independent video/audio sessions visible.
The Electron test serves them exclusively from local mock HTTP servers.

Reproduce with FFmpeg (VP8/Opus):

```sh
ffmpeg -f lavfi -i 'testsrc2=size=160x90:rate=10:duration=60' -f lavfi -i 'sine=frequency=330:sample_rate=24000:duration=60' -af volume=0.03 -c:v libvpx -b:v 35k -c:a libopus -b:a 8k two-stream-vod.webm
ffmpeg -f lavfi -i 'testsrc2=size=160x90:rate=10:duration=60' -f lavfi -i 'sine=frequency=660:sample_rate=24000:duration=60' -vf hue=h=120 -af volume=0.03 -c:v libvpx -b:v 35k -c:a libopus -b:a 8k two-stream-live.webm
```

The second fixture is deliberately presented as live by the companion host.
It is a finite local test source, not a timeshift implementation.
