# Guide playback fixture

`guide-demo.mpegts` is an original, synthetic 20-second H.264 video slate at
1280×720 / 25 fps, with no audio or third-party footage. Feature-guide captures
serve it through a local HLS manifest, decode it with the real HTML5 player,
and pause the decoded frame for repeatability. No player state or statistics
are fabricated. Subtitle menus use the app's normal file-selection flow.

To regenerate on macOS with FFmpeg (Helvetica is a system font):

```sh
ffmpeg -f lavfi -i 'gradients=s=1280x720:r=25:c0=0x14243e:c1=0x507f9f:n=2:d=20:speed=0.01:seed=24' \
  -vf "drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:text='IPTVnator':fontcolor=white:fontsize=52:x=(w-text_w)/2:y=(h-text_h)/2-30,drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:text='DEMO STREAM':fontcolor=white@0.6:fontsize=20:x=(w-text_w)/2:y=(h-text_h)/2+35" \
  -c:v libx264 -preset fast -crf 28 -pix_fmt yuv420p -g 50 -an \
  -f mpegts tools/release/fixtures/guide-demo.mpegts
```

Capture the six feature-guide screens with:

```sh
pnpm nx run electron-backend:build-e2e
pnpm release:screenshots --group feature-guides --theme dark
```

The EPG article uses the original GitHub release image selected by the
maintainer, not this fixture. Its source is documented in
`apps/website/public/blog/feature-guides/SOURCES.md`.
