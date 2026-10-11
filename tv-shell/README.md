# TV Shell pour IPTVnator — Fire TV Stick / Android TV

Coquille Android qui fait tourner **IPTVnator** (la PWA officielle, construite depuis ce dépôt) sur un Fire TV Stick ou une box Android TV, pilotable à la télécommande, **sans serveur externe** : le backend web d'IPTVnator est réimplémenté en Java et embarqué dans l'APK.

```
APK
├── WebView plein écran ──► http://127.0.0.1:43330/   (serveur local, NanoHTTPD)
│                              ├── /            PWA IPTVnator (assets/www, bundle Angular)
│                              ├── /tvshell/tv.js   couche télécommande injectée dans index.html
│                              └── /api/*       backend embarqué (parse M3U, proxy Xtream, proxy Stalker)
└── touches Retour / Menu / média → tv.js ; flux illisibles → VLC (Intent)
```

> Ce projet n'est pas affilié à IPTVnator. « IPTVnator » est une marque du projet : ne redistribuez pas cette coquille sous ce nom (voir `TRADEMARK.md` du dépôt). Usage personnel.

## Ce que ça fait

- **Navigation à la télécommande** : le D-pad déplace le focus entre les éléments de l'app (algorithme FocusFinder d'Android porté en JS), OK active, Retour ferme les dialogues/menus puis remonte l'historique, Menu ouvre le menu contextuel de l'élément, Play/Pause/⏪/⏩ pilotent la vidéo. Listes virtuelles de milliers de chaînes : OK (défilement puis recherche).
- **Playlists M3U par URL, portails Xtream Codes, portails Stalker** : via le backend embarqué (même contrat que `apps/web-backend`, parser M3U porté à l'identique et vérifié par 43 fixtures générées avec le vrai parser).
- **Lecture** : lecteurs intégrés de la PWA (HLS `.m3u8`, MP4, DASH ClearKey…) dans le WebView. Les flux que le navigateur ne lit pas (`.ts` bruts, AC3…) déclenchent une proposition **« Ouvrir dans un lecteur »** (VLC, Kodi, MX Player…). Le bouton « Copier l'URL du flux » de l'app fait la même chose sur TV.
- **Réglages de la coquille** (appui long sur Menu) : taille de l'interface (960 / 1280 / 1600 px), lecteur externe préféré, effacement des données, diagnostic (version du WebView).
- Données (playlists, favoris, positions) stockées par la PWA dans le WebView (IndexedDB / localStorage), persistantes entre les lancements.

Limites héritées de la PWA : pas d'EPG/XMLTV, pas de téléchargements, pas de MPV embarqué (ces fonctions sont « desktop » dans IPTVnator).

## Construire l'APK

### Avec GitHub Actions (recommandé, rien à installer)

1. Déposez le dossier `tv-shell/` à la racine de votre fork d'IPTVnator et le fichier `.github/workflows/build-tv-shell-apk.yml`.
2. Onglet **Actions** → *Build TV shell APK* → **Run workflow** (laissez `create_release` coché).
3. Le workflow construit la PWA (`pnpm nx build web --configuration=pwa`, comme l'image Docker), lance les tests du backend, compile l'APK et crée une **Release** `tv-shell-v0.1.0-N` avec le fichier `iptvnator-tv-shell-0.1.0-xxxxxxx.apk`. L'APK est aussi disponible comme artefact du run.

L'APK est signé avec la clé de debug (parfait pour le sideload). Pour une signature stable entre builds, ajoutez les secrets `TVSHELL_KEYSTORE_B64` (keystore en base64), `TVSHELL_KEYSTORE_PASSWORD`, `TVSHELL_KEY_ALIAS`, `TVSHELL_KEY_PASSWORD`.

### En local (Android Studio ou ligne de commande)

```bash
# 1. la PWA, depuis la racine du dépôt IPTVnator
pnpm install --frozen-lockfile --ignore-scripts
pnpm nx build web --configuration=pwa
# 2. la copier dans la coquille
tv-shell/scripts/bundle-pwa.sh dist/apps/web
# 3. l'APK (JDK 17 + SDK Android ; Android Studio les fournit)
cd tv-shell/android && ./gradlew :backend:check :app:assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk
```

## Installer sur le Fire TV Stick

1. **Paramètres → Mon Fire TV → Options pour les développeurs** : activez *Applications de sources inconnues* (ou *Installer des applications inconnues* → Downloader) et, pour ADB, *Débogage ADB*.
2. **Méthode Downloader** : installez l'app *Downloader* depuis l'Appstore Amazon, entrez l'URL de l'APK de la Release GitHub (bouton droit sur l'`.apk` → copier le lien), installez.
3. **Méthode ADB** (depuis un PC sur le même réseau) :
   ```bash
   adb connect 192.168.x.x        # IP du Stick (Paramètres → Mon Fire TV → À propos → Réseau)
   adb install -r iptvnator-tv-shell-0.1.0-xxxxxxx.apk
   ```
4. Lancez *TV Shell pour IPTVnator* (Vos applications et chaînes). Ajoutez une source : **Sources → Add M3U / Add Xtream / Add Stalker** ; le clavier Fire TV s'ouvre sur les champs avec OK.
5. Installez **VLC pour Android** (Appstore) pour les flux `.ts`.

## Touches

| Télécommande | Action |
| --- | --- |
| D-pad | se déplacer entre les éléments ; sur l'image : ◀ ▶ = recherche (seek), ▲ ▼ = quitter / contrôles |
| OK | activer ; sur l'image : plein écran ; sur un champ texte : clavier |
| Retour | fermer dialogue/menu → quitter le plein écran → page précédente → (2×) quitter l'app |
| Menu | menu contextuel de l'élément ; sur l'image : ouvrir le flux dans VLC ; **appui long** : réglages de la coquille |
| ▶⏸ ⏪ ⏩ | lecture/pause, −15 s, +30 s |

## Structure

```
tv-shell/
├── android/                 projet Gradle
│   ├── backend/             bibliothèque Java pure : parser M3U, routes /api, helpers Xtream/Stalker (+ tests JVM)
│   └── app/                 application Android : serveur NanoHTTPD, WebView, réglages, pont JS, lecteur externe
│       └── src/main/assets/tvshell/tv.js   la couche télécommande (injectée dans la page)
├── devserver/               backend de référence en Node + mock de fournisseur, pour développer/tester sur PC
├── tests/                   tests Playwright : pilotage de la vraie app à la télécommande
├── tools/                   générateur des fixtures du parser (depuis le vrai parser JS), stubs Android pour javac, extracteur asar
└── scripts/bundle-pwa.sh    copie la PWA construite dans les assets
```

## Développer / tester sur PC

```bash
# backend de référence Node + fournisseur fictif (Xtream user/pass, M3U) servant une PWA construite
WWW=/chemin/vers/dist/apps/web tv-shell/devserver/run-dev.sh        # http://127.0.0.1:43330
# dans un navigateur : F9 = Retour, F10 = Menu, F8 = Play/Pause, F7 = lecteur externe
# tests télécommande (Playwright) contre le serveur de dev
node tv-shell/tests/tv-remote.mjs ; node tv-shell/tests/tv-longlist.mjs
# backend Java réel sur le JDK, sans Android (mêmes classes que l'APK)
cd tv-shell/android && ./gradlew :backend:check
```

## Dépannage

- **Écran « Le lecteur n'a pas pu être chargé »** : lisez le diagnostic (version Chrome du WebView). Angular 21 demande un WebView récent : moteur Chrome ≥ 94 pour charger le JS (blocs `static {}`), ≥ 111 pour des couleurs correctes (`color-mix()`). Mettez à jour « Amazon WebView » / Android System WebView via l'Appstore ; sinon, piste GeckoView (voir `HANDOFF.md`).
- **Flux muet / noir** : codec non supporté par le WebView → Menu sur l'image ou « Copier l'URL du flux » → VLC. Pour Xtream, choisissez le format de sortie `m3u8` dans les réglages de la playlist.
- **Inspecter la page** : réglages de la coquille → *débogage à distance*, puis `chrome://inspect` sur un PC avec `adb connect`.
