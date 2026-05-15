# i18n fill-missing tool

One-shot helper for bringing every locale file in `apps/web/src/assets/i18n/`
to full coverage of `en.json`.

## How it works

`en.json` is the source of truth. For every other locale, the script:

1. Walks `en.json` in order (top-level + nested).
2. For each leaf key:
    - Keeps the locale's existing translation if present.
    - Otherwise pulls the translation from `tools/i18n/patches/<lang>.json`
      (a flat object keyed by dotted path).
    - If neither exists, leaves the key absent and exits non-zero.
3. Writes the merged tree back to the locale file with 4-space indent and a
   trailing newline.

Existing translations are never overwritten.

## Workflow

```bash
# 1. Generate one missing-strings dump per locale (flat dotted-path → EN string)
node tools/i18n/fill-missing.mjs --emit-missing
# → tools/i18n/missing/<lang>.json

# 2. Translate each missing/<lang>.json into the equivalent patch file
#    in tools/i18n/patches/<lang>.json (same shape: { dotted.path: translated }).

# 3. Merge patches into the locale files
node tools/i18n/fill-missing.mjs

# 4. Verify
node -e "
const fs=require('fs');
const en=JSON.parse(fs.readFileSync('apps/web/src/assets/i18n/en.json','utf8'));
const collect=(d,p='')=>Object.entries(d).flatMap(([k,v])=>v&&typeof v==='object'?collect(v,p?p+'.'+k:k):[p?p+'.'+k:k]);
const enKeys=new Set(collect(en));
for(const f of fs.readdirSync('apps/web/src/assets/i18n').filter(x=>x.endsWith('.json')&&x!=='en.json')){
  const k=new Set(collect(JSON.parse(fs.readFileSync('apps/web/src/assets/i18n/'+f,'utf8'))));
  console.log(f,'missing:',[...enKeys].filter(x=>!k.has(x)).length,'extra:',[...k].filter(x=>!enKeys.has(x)).length);
}"
```

For a non-mutating CI/agent check, run:

```bash
pnpm run i18n:check
```

The check fails on missing or extra keys against `en.json`. It reports values
that are still identical to English as warnings so untranslated fallback strings
remain visible without blocking key-parity validation. For stricter translation
audits, run:

```bash
node tools/i18n/check-drift.mjs --fail-on-identical
```

## Translation rules

- Preserve `{{interpolation}}` placeholders verbatim.
- Preserve any inline HTML tags.
- Match the locale's existing punctuation, casing, and terminology.
- Keep brand names (IPTVnator, Xtream, Stalker, M3U, EPG, MPV, VLC) untranslated.
- Short UI strings stay short — no length blow-up.
