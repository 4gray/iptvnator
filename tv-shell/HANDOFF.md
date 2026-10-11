# Passation — où en est le projet, et le prompt pour continuer

## État au 11 octobre 2026

**Fait et vérifié (hors appareil) :**

| Pièce | Vérification |
| --- | --- |
| `android/app/src/main/assets/tvshell/tv.js` (couche télécommande) | Testée dans Chromium (Playwright) sur la **vraie app IPTVnator v0.24.0** : ajout d'un portail Xtream et d'une playlist M3U uniquement au D-pad, formulaire, grille de films, Live TV, liste virtuelle de 180 chaînes, lecteur, overlay d'erreur, Retour, Menu. Scripts : `tests/tv-remote.mjs`, `tests/tv-longlist.mjs`. |
| `android/backend/` (backend Java pur) | 24 tests JVM verts (`./gradlew :backend:check` ou `TestMain`), dont les **43 fixtures du parser M3U générées par le vrai parser JS** (`tools/gen-parser-fixtures.mjs`). Le backend Java a aussi servi la vraie PWA dans Chromium via `LocalMain` : flux M3U → `/api/parse` et Xtream → `/api/xtream` OK. |
| `android/app/` (Android) | Compilé uniquement contre des **stubs** (`tools/android-stubs/gen_stubs.py`) : pas de SDK Android dans l'environnement d'origine. Première compilation réelle à faire (GitHub Actions ou Android Studio). |
| `devserver/` | Implémentation Node de référence des routes + fournisseur fictif (`mock-provider.mjs`). |
| `.github/workflows/build-tv-shell-apk.yml` | Écrit, **jamais exécuté**. |

**Jamais testé sur un vrai appareil.** Cible de l'utilisateur : Fire TV Stick « sheldon » (Fire TV Stick Lite / 3ᵉ gén. 2020, 1 Go de RAM, Fire OS 7 = Android 9). Point d'incertitude principal : la version du WebView Amazon (Angular 21 vise ≈ Chrome 111+). L'écran d'erreur et les réglages affichent la version pour le savoir.

**Choix d'architecture (ne pas défaire sans raison) :**
- Pas de serveur LAN : backend embarqué en Java (`WebBackend`), même contrat que `apps/web-backend` (provider-targets / parse / xtream / stalker). EPG (`/parse-xml`) volontairement en 501 : la PWA n'affiche pas l'EPG.
- Origine fixe `http://127.0.0.1:43330` (le stockage IndexedDB/localStorage de la PWA dépend de l'origine ; le port est mémorisé dans les prefs).
- Service worker Angular non servi (404 volontaire) : le bundle est dans l'APK.
- `tv.js` est chargé **avant** le bundle via une balise `<script src="tvshell/tv.js">` same-origin (le CSP de l'app interdit les scripts inline). Aucun fichier d'IPTVnator n'est modifié.
- Largeur de layout 1280 px CSS (`<meta viewport width=1280>`) pour garder la mise en page desktop sur l'écran TV ; réglable 960/1600.

## Mise à jour — premier APK construit (11 octobre 2026, session cloud)

- Le workflow `build-tv-shell-apk.yml` a tourné sans erreur dès le premier essai
  (push puis `workflow_dispatch` avec `create_release`, ~3 min 30 par run). Le
  `workflow_dispatch` fonctionne sur une branche non-default.
- Première Release : `tv-shell-v0.1.0-2` (commit `0e223c1`), APK
  `iptvnator-tv-shell-0.1.0-0e223c1.apk` (15,2 Mo ; 258 fichiers de PWA,
  `tvshell/tv.js`, 6 dex, signé debug). Contenu vérifié par `unzip`.
- Seuils mesurés sur le bundle livré (Angular 21) : le JS contient des blocs
  `static {}` dans 42 fichiers → **Chrome ≥ 94 obligatoire** (sinon erreur de
  syntaxe, page blanche) ; `Object.hasOwn` → 93 ; `Promise.withResolvers` et
  `structuredClone` sont polyfillés / hors chemin navigateur. La CSS utilise
  `color-mix()` 176 fois → couleurs correctes à partir de Chrome 111 (sinon
  l'app fonctionne avec des couleurs dégradées).
- Garde-fou ajouté dans `MainActivity` : si la page n'appelle pas
  `TvShell.onReady()` en 30 s, l'écran d'erreur s'affiche avec la dernière
  erreur console (`onConsoleMessage`) et le diagnostic (version du WebView).
  Le splash ne peut donc plus rester affiché indéfiniment.
- Workflow : `gh release create --target "$GITHUB_SHA"` pour que le tag pointe
  sur le commit construit (le premier tag pointait sur `master`).
- Revue adversariale (14 agents) après le premier build, trois défauts corrigés :
  (1) la clé de debug était régénérée à chaque run CI → le 2ᵉ APK refusait de
  s'installer par-dessus le 1ᵉʳ (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`) ; une clé
  de debug versionnée (`android/app/debug.keystore`) signe désormais les builds.
  (2) `tv.js` appelait `TvShell.onReady()` dès le DOM prêt, avant Angular, ce
  qui désarmait le garde-fou ; il n'est envoyé qu'une fois `#initial-splash`
  retiré par `main.ts` (poll sans limite, le garde-fou Java est la limite), et
  une `Uncaught SyntaxError` avant `onReady` affiche l'écran d'erreur aussitôt.
  (3) le viewport injecté portait `initial-scale=1`, ce qui empêchait le WebView
  (960 px CSS sur un Fire TV 1080p) de réduire la mise en page 1280 : le quart
  droit était hors écran ; le viewport ne fixe plus que `width`.

À relever sur le Stick (en plus de l'écran) :

```bash
adb shell dumpsys package com.amazon.webview.chromium | grep versionName
adb logcat -s TvShell chromium   # erreurs JS et bridge
```

Décision selon la version Chrome affichée : **< 94** → cas « WebView trop
ancien » (mettre à jour Amazon WebView, sinon GeckoView ; une ancienne version
d'IPTVnator ne suffit pas forcément : toute version sous Angular ≥ 15 émet aussi
de l'ES2022) ; **94–110** → l'app doit se charger, couleurs dégradées
possibles ; **≥ 111** → seul le comportement de `tv.js` reste à ajuster.

## Prompt pour Claude Code (cloud)

Copiez-collez ceci dans une session Claude Code ouverte sur votre fork d'IPTVnator (le dossier `tv-shell/` et le workflow étant commités) :

```
Je travaille dans mon fork d'IPTVnator. À la racine il y a un dossier `tv-shell/` : une coquille Android (Fire TV Stick) qui embarque la PWA IPTVnator + un backend Java (port du web-backend) + une couche télécommande `tv.js`. Lis d'abord `tv-shell/HANDOFF.md` puis `tv-shell/README.md`.

Objectif : obtenir un APK qui s'installe et tourne sur mon Fire TV Stick (modèle « sheldon », Fire OS 7, 1 Go de RAM).

Étapes :
1. Vérifie que `.github/workflows/build-tv-shell-apk.yml` est bien à cet emplacement et lance-le (ou pousse une modification sous `tv-shell/` pour le déclencher). Le job construit la PWA avec `pnpm nx build web --configuration=pwa`, copie `dist/apps/web` dans `tv-shell/android/app/src/main/assets/www` via `tv-shell/scripts/bundle-pwa.sh`, lance `./gradlew :backend:check` puis `:app:assembleDebug`.
2. Si la compilation Android échoue : le code Android (`tv-shell/android/app`) n'a jamais été compilé avec le vrai SDK, seulement contre des stubs. Corrige les erreurs de compilation en restant au plus près du code existant (Java, sans AndroidX, NanoHTTPD 2.3.1, minSdk 25, AGP 8.9.1, Gradle 8.14.3). Ne touche pas au contrat des routes `/api` ni à `tv.js` sans relancer leurs tests (`./gradlew :backend:check` ; `node tv-shell/tests/tv-remote.mjs` avec `tv-shell/devserver/run-dev.sh`).
3. Quand l'APK est produit, publie-le en Release (le workflow le fait avec `create_release`) et donne-moi l'URL directe du `.apk` pour l'application Downloader du Fire TV, plus la commande `adb install`.
4. Ensuite, je testerai sur le Stick et je te rapporterai : (a) ce qu'affiche l'écran d'erreur / le diagnostic (version du WebView), (b) le comportement de la navigation. Prévois les deux cas : WebView trop ancien pour Angular 21 (piste : embarquer GeckoView, ou servir une version plus ancienne d'IPTVnator) ; navigation à corriger dans `tv.js` (tout passe par `window.__tvShell`, voir l'en-tête du fichier).

Contraintes : ne modifie rien dans le code d'IPTVnator lui-même (hors `tv-shell/` et le workflow). Garde les réponses courtes et donne-moi les URLs et commandes à copier.
```

## Pistes si ça coince sur l'appareil

- **WebView trop ancien** (page blanche, erreurs de syntaxe JS dans `chrome://inspect`) : (1) mettre à jour Amazon WebView via l'Appstore ; (2) embarquer GeckoView (Mozilla, ~70 Mo, moteur à jour quel que soit l'OS) à la place du WebView — `MainActivity` et `TvShellBridge` sont les seules classes à adapter, le serveur et `tv.js` restent identiques ; (3) construire une version plus ancienne d'IPTVnator (`iptvnator_ref`).
- **Mémoire (1 Go)** : réduire les catalogues (catégories masquées dans IPTVnator), `largeHeap` est déjà activé ; si le renderer est tué, tester `android:process` / `WebView` en mode monoprocessus n'est pas possible côté app — préférer une playlist plus petite.
- **Touches non reconnues** (Menu / média) : `MainActivity.dispatchKeyEvent` liste les `KEYCODE_*` interceptés ; `adb shell getevent -l` ou `chrome://inspect` pour voir ce qu'envoie la télécommande.
- **Flux .ts** : c'est attendu dans un navigateur ; passer par VLC (proposé automatiquement) ou choisir `m3u8` pour Xtream.
- **Clavier à l'écran absent sur un champ** : `TvShellBridge.showKeyboard()` est appelé par `tv.js` sur OK dans un champ texte ; sinon `adb shell input text`.

## Ce qui reste à faire (idées)

- Signature de release stable (secrets `TVSHELL_*`).
- Icône/bannière définitives (actuelles générées, génériques).
- Raccourci « plein écran automatique à la lecture » et masquage du curseur de souris selon retours.
- Mettre `versionCode`/`versionName` à jour à chaque release.
