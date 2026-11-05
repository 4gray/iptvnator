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

The check fails on missing or extra keys against `en.json`, and on values that
are identical to English unless `identical-en-baseline.json` lists that exact
English text for the locale and key. Do not copy English into a locale as a
placeholder: translate it. The contract, including when an entry stops
covering a key, is in the
[validation map](../../docs/architecture/validation-map.md#i18n).

Baseline entries that are no longer identical are reported, not fatal. After
translating baselined values, or for a value that is legitimately the same in a
language (a brand, a technical name, a loanword), rewrite the baseline and
review every added entry in the diff:

```bash
pnpm run i18n:baseline:update
```

`pnpm run i18n:check` also runs `check-usage.mjs`, which fails on a key the
renderer uses but `en.json` lacks (ngx-translate would show the raw key). It
scans production `.ts` and `.html` files under `apps/web/src`,
`apps/remote-control-web/src` and `libs` for piped keys (including the
branches of a parenthesised operand), translate calls and
dotted literals in an `en.json` namespace; run it alone with
`pnpm run i18n:usage`. Keys built entirely at runtime are not checked.

The checkers' own tests run with `pnpm run i18n:test`; CI runs both through
`pnpm run i18n:validate`. For a full audit that ignores the baseline, run:

```bash
node tools/i18n/check-drift.mjs --fail-on-identical
```

`pnpm run i18n:duplicates` lists English strings that `en.json` defines under
several keys while a locale translates those keys differently, such as one
"Close" button saying "Afsluiten" and another "Sluiten". Add `--verbose` for
each locale's variants and keys, or `--max <n>` to fail above n groups. It is
a report, not a CI gate: a group can be legitimate when context needs another
grammatical form. When aligning, change the drifted values rather than
removing keys.

## Changing existing translations

`fill-missing.mjs` never overwrites, so rewording an existing value or paying
down baseline debt means editing the value in the locale file directly (keep
the key order, 4-space indent and trailing newline), then running
`pnpm run i18n:baseline:update` and review the diff. Existing translations
normally remove entries; additions need an explicit reason such as a brand,
unit or language autonym that legitimately matches English.

## Translation rules

- Preserve `{{interpolation}}` placeholders verbatim.
- Preserve any inline HTML tags.
- Match the locale's existing punctuation, casing, and terminology.
- Keep brand names (IPTVnator, Xtream, Stalker, M3U, EPG, MPV, VLC) untranslated.
- Short UI strings stay short — no length blow-up.

## Regional Portuguese and source changes

`en.json` is the source text for every translation. Portuguese has two complete
catalogues: `pt-PT.json` (Portugal) and `pt-BR.json` (Brazil). Stored `pt` settings
and startup hints normalize to `pt-BR`; `pt` is no longer a third selectable
language or catalogue. Updates save the canonical code without resetting any
other settings. Browser-language resolution for the remote control uses
`pt-BR` for bare `pt` or Brazil, and `pt-PT` for other explicit Portuguese
regions. Dates and TMDB requests use the selected region too.
The startup hint is refreshed immediately when the saved language is applied,
so changing language in settings does not require a reload to prepare the next
cold start. IndexedDB settings remain authoritative.

The browser and Electron `portuguese-locales.e2e.ts` suites exercise regional
selection and reload/restart with isolated profiles. Electron also checks a
legacy `pt` IndexedDB record and preservation of unrelated settings on save.
The delayed-locale unit test resolves Brazil before an earlier Portugal
request, guarding the startup hint and final language against stale completion.
Playlist backups carry EPG URLs, not language preferences (see the
[backup contract](../../docs/architecture/playlist-backup-restore.md#app-settings)).

Use these terms consistently in context:

| English | Portugal | Brazil |
| --- | --- | --- |
| Settings | Definições | Configurações |
| App | Aplicação | Aplicativo |
| File / Save | Ficheiro / Guardar | Arquivo / Salvar |
| Username / Password | Nome de utilizador / Palavra-passe | Nome de usuário / Senha |
| Playlist | Playlist | Lista de reprodução |
| Player | Leitor | Reprodutor |
| Download | Transferir | Baixar |
| Live TV | TV em direto | TV ao vivo |
| Remote control | Comando remoto | Controle remoto |
| Subscription | Subscrição | Assinatura |
| Device signature | Assinatura | Assinatura |
| Recently viewed / watched | Visualizados recentemente / Vistos recentemente | Visualizados recentemente / Assistidos recentemente |
| Age rating / Review rating | Classificação etária / Classificação | Classificação indicativa / Avaliação |
| IMDb rating | Classificação IMDb | Avaliação IMDb |
| Blog | Blogue | Blog |
| Programme guide (UI label) | Guia TV | Guia de programação |

Portugal uses AO90 and consistent informal second-person instructions; Brazil
uses natural Brazilian Portuguese with você. Use infinitives for action labels,
sentence case, and localized decimal display (for example `{{value}},0`). Never
localize protocol identifiers, URLs, MAC addresses or numeric values in code.
Translate archive/catch-up according to its meaning (past programmes), rather
than confusing it with a local file. Technical metadata names may stay verbatim.
In Portugal, use feminine `a playlist` / `as playlists` for the named IPTV source,
while retaining `lista` for generic lists and queues. Use `Classificação` for a
review score, and `Classificação etária` for an age rating.
Use `Guia TV` for the guide's title and actions; explanatory descriptions may
use `guia de programação`, and protocol references retain `EPG` / `XMLTV`.

When an existing English string changes, review its consumers and update that
key in **every catalogue in the same change**, including both Portuguese
regions. A translation may stay unchanged when it already expresses the new
meaning, but that decision still needs review. Keep the old/new English and
regional translations together in review material. Automated translation tools,
including Claude, receive the full sentence, UI context and locale glossary;
they do not replace semantic review. Brand-only and autonym labels intentionally
match across languages.

`i18n:check` also rejects empty/non-string values in English and every
translation, changed interpolation placeholders (including their multiplicity),
and changed inline HTML. The baseline never exempts these errors. Coverage
checks cannot prove semantic correctness or catch all stale translations after
English wording changes; review the source change against every language and
verify relevant UI flows.
