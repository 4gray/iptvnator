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
