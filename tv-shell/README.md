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

L'APK est signé avec la clé de debug versionnée (`android/app/debug.keystore`, mot de passe `android`) : stable d'un build à l'autre, donc les nouvelles versions s'installent par-dessus les anciennes. Les builds 1 à 4 utilisaient une clé générée à chaque run : désinstallez-les avant d'installer un build ≥ 5. Pour une signature stable entre builds, ajoutez les secrets `TVSHELL_KEYSTORE_B64` (keystore en base64), `TVSHELL_KEYSTORE_PASSWORD`, `TVSHELL_KEY_ALIAS`, `TVSHELL_KEY_PASSWORD`.

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

Le **diagnostic** (appui long sur Menu → Réglages de la coquille, ou l'écran d'erreur) donne la version du moteur Chrome du WebView, l'appareil, le port du serveur embarqué et la ligne « Écran » (pixels, densité, largeur en px CSS, largeur de layout). Joignez-le à tout rapport. Depuis un PC :

```bash
adb connect 192.168.x.x
adb logcat -s TvShell chromium          # [console] = erreurs de la page ; "web app ready" = app démarrée
adb shell dumpsys package com.amazon.webview.chromium | grep versionName
```

### Installation

- **« Application non installée » / `INSTALL_FAILED_UPDATE_INCOMPATIBLE`** : l'APK installé est signé avec une autre clé (c'est le cas des builds 1 à 4, signés avec une clé jetable). Désinstallez d'abord : Paramètres → Applications → Gérer les applications installées, ou `adb uninstall org.tvshell.iptvnator`. Depuis le build 5 la clé est stable et les mises à jour s'installent par-dessus avec `adb install -r`.
- **Downloader refuse d'installer** : activez *Applications de sources inconnues* (ou *Installer des applications inconnues → Downloader*) dans Options pour les développeurs, puis réessayez avec l'URL directe du `.apk` (bouton droit sur l'asset de la Release → copier le lien).
- **`adb connect` refusé** : activez *Débogage ADB* dans Options pour les développeurs, puis acceptez l'invite sur la TV au premier `adb` ; l'IP est dans À propos → Réseau.

### Démarrage

- **« Le lecteur n'a pas pu être chargé »** après 30 s : la page n'a pas démarré. Si la version Chrome affichée est inférieure à **94**, le WebView ne peut pas exécuter le bundle Angular 21 (blocs `static {}`) ; mettez à jour « Amazon WebView » / Android System WebView via l'Appstore, sinon piste GeckoView (voir `HANDOFF.md`). Entre 94 et 110, l'app fonctionne avec des couleurs dégradées (`color-mix()` demande 111). La dernière erreur console est affichée sous le message.
- **« Le serveur embarqué n'a pas pu démarrer »** : les ports 43330 à 43334 sont occupés par une autre application. Fermez-la ou redémarrez le Stick ; le port retenu est mémorisé pour conserver les données de l'app (elles sont liées à l'origine `http://127.0.0.1:port`).
- **Splash qui reste affiché** (builds ≤ 6) : mettez à jour ; depuis le build 7 l'écran d'erreur prend le relais au bout de 30 s.

### Affichage

- **L'image ne tient pas dans l'écran, ou est trop petite** : la mise à l'échelle est `px CSS ÷ largeur de layout` (sur un Fire TV 1080p : 960 ÷ 1280 = 0,75). Vérifiez la ligne « Écran » du diagnostic et changez *Taille de l'interface* (960 = grande, 1280 = normale, 1600 = dense). Si l'affichage reste coupé, rapportez la ligne « Écran » et le build.
- **Texte trop petit ou trop gros** : même réglage *Taille de l'interface*.

### Télécommande

- **Une touche ne fait rien** : `adb shell getevent -l` montre le code envoyé par la télécommande ; les touches interceptées sont listées dans `MainActivity.dispatchKeyEvent` (Retour, Menu, lecture/pause, ⏪, ⏩), le reste va à la page (`tv.js`).
- **Plus de focus visible** : appuyez sur une flèche, la couche télécommande replace le focus près de sa dernière position. Retour ferme d'abord dialogues et menus, puis remonte l'historique, puis quitte (deux appuis).
- **Pas de clavier sur un champ** : OK sur le champ ouvre le clavier Fire TV ; sinon `adb shell input text "..."`.

### Lecture

- **Flux muet / noir / « ce flux ne peut pas être lu ici »** : codec ou conteneur non géré par le WebView (`.ts` brut, AC3…). Acceptez l'ouverture dans VLC (à installer depuis l'Appstore), ou Menu sur l'image / « Copier l'URL du flux ». Pour Xtream, choisissez le format de sortie `m3u8` dans les réglages de la playlist.
- **La proposition VLC n'apparaît plus** : réglages de la coquille → *Lecteur externe* → cochez « Proposer un lecteur externe » et choisissez le lecteur.

### Données et mémoire

- **Repartir de zéro** : réglages de la coquille → *Effacer les données IPTVnator* (ou désinstaller l'app). Les données survivent aux mises à jour tant que le port du serveur ne change pas.
- **L'app se recharge ou se ferme seule (1 Go de RAM)** : le rendu web a été tué par le système. Réduisez le catalogue (catégories masquées dans IPTVnator, playlist plus petite) et fermez les autres applications.
- **Inspecter la page** : réglages de la coquille → *débogage à distance*, puis `chrome://inspect` sur un PC avec `adb connect`.
