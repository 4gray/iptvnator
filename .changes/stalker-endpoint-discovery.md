---
type: fix
area: stalker
issues: [850, 686, 755]
---

Stalker setup now accepts a host or `/c` address, finds the working API
endpoint and authentication mode, and rechecks changed connection details in
Edit. Misclassified portals from earlier versions still repair themselves on
first compatible failure without losing favorites or history.
