---
type: fix
area: ui
---

The EPG import panel, the update notification and every toast now share the
app's dialog frame: the same surface, hairline border, shadow and button
styles, with the update card's buttons in the kit look. A guide source that
fails to import is reported once, in the import panel with its Retry button,
instead of also as a raw error toast.
