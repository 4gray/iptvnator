---
type: fix
area: search
issues: [1161]
---

Searching for names that carry punctuation inside them — "A&E", "X-Men",
"L'Equipe" — finds them anywhere in a title, including channels the provider
prefixes, like "US: A&E".
