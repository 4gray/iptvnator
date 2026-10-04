### Embedded MPV page clipping

- The Windows native video surface clips to its DOM scroll viewport so scrolling does not paint video over surrounding app chrome. Clipping changes the drawing region without resizing playback.
- Fullscreen ignores former page scroll ancestors.
- Material episode pickers, menus and autocomplete panels temporarily hide native video using the existing overlay guard even when no backdrop is present.
