# TV Shell pour IPTVnator — Fire TV Stick / Android TV

Coquille Android expérimentale qui fait tourner **IPTVnator** (la PWA
construite depuis ce dépôt) sur un Fire TV Stick ou une box Android TV,
pilotable à la télécommande, **sans serveur à héberger** : le backend web est
réimplémenté en Java et embarqué dans l'APK. La documentation de référence
(architecture, modèle de sécurité, développement) est dans [`README.md`](README.md) ;
cette page résume l'installation, les touches et le dépannage.

## Installer sur le Fire TV Stick

1. **Paramètres → Mon Fire TV → Options pour les développeurs** : activez
   *Applications de sources inconnues* (ou *Installer des applications inconnues
   → Downloader*) et, pour ADB, *Débogage ADB*.
2. **Downloader** : installez l'app *Downloader* depuis l'Appstore, entrez l'URL
   du `.apk` de la release GitHub (bouton droit sur l'asset → copier le
   lien), installez.
3. **ADB** (depuis un PC sur le même réseau) :
   ```bash
   adb connect 192.168.x.x        # IP du Stick : Paramètres → Mon Fire TV → À propos → Réseau
   adb install -r iptvnator-tv-shell-0.1.0-xxxxxxx.apk
   ```
4. Lancez *TV Shell pour IPTVnator*. Ajoutez une source : **Sources → Add M3U /
   Add Xtream / Add Stalker** ; OK sur un champ texte ouvre le clavier Fire TV.
5. Installez **VLC pour Android** (Appstore) pour les flux `.ts`.

Sans secrets de signature (`TVSHELL_KEYSTORE_B64`, `TVSHELL_KEYSTORE_PASSWORD`,
`TVSHELL_KEY_ALIAS`, `TVSHELL_KEY_PASSWORD`), les APK publiés par le workflow
sont signés avec la clé de debug versionnée (`android/app/debug.keystore`) : les
nouvelles versions s'installent par-dessus les anciennes. Le `versionCode` est
l'heure du commit en minutes. Pour publier
une release : **Actions → Build TV shell APK → Run workflow**, cochez
`create_release` et décochez `prerelease` (dans le dépôt IPTVnator lui-même,
`prerelease` doit rester coché : une release « Latest » sans les fichiers de
l'app desktop casserait sa mise à jour automatique).

## Touches

| Télécommande | Action |
| --- | --- |
| D-pad | se déplacer entre les éléments ; sur l'image : ◀ ▶ = recherche, ▲ ▼ = quitter l'image / contrôles ; dans un champ texte, les flèches déplacent le curseur tant qu'il peut bouger |
| OK | activer ; sur l'image : plein écran ; sur un champ texte : clavier. Un appui maintenu vaut une activation |
| Retour | fermer dialogue/menu → quitter le plein écran → page précédente → (2×) quitter l'app |
| Menu | menu contextuel de l'élément ; sur l'image : ouvrir le flux dans VLC ; **appui long** : réglages de la coquille |
| ▶⏸ ⏪ ⏩ | lecture/pause, −15 s, +30 s |

## Réglages de la coquille (appui long sur Menu)

Taille de l'interface (960 / 1280 / 1600 px), lecteur externe préféré,
proposition automatique d'un lecteur externe, débogage à distance
(`chrome://inspect`, désactivé par défaut), effacement des données, diagnostic
(version du WebView, écran, port du serveur).

## Dépannage

Le **diagnostic** (appui long sur Menu, ou l'écran d'erreur) donne la version du
moteur Chrome du WebView, l'appareil, le port du serveur embarqué et la ligne
« Écran » (pixels, densité, largeur en px CSS, largeur de layout). Joignez-le à
tout rapport. Depuis un PC :

```bash
adb connect 192.168.x.x
adb logcat -s TvShell chromium          # [console] = erreurs de la page ; "web app ready" = app démarrée
adb shell dumpsys package com.amazon.webview.chromium | grep versionName
```

### Installation

- **« Application non installée » / `INSTALL_FAILED_UPDATE_INCOMPATIBLE`** :
  l'APK installé est signé avec une autre clé (build local, autre fork).
  Désinstallez-le d'abord (Paramètres → Applications, ou
  `adb uninstall org.tvshell.iptvnator`) ; les builds de ce dépôt partagent une
  clé et se mettent à jour avec `adb install -r`.
- **Downloader refuse d'installer** : activez *Applications de sources
  inconnues* dans Options pour les développeurs, puis utilisez l'URL directe du
  `.apk`.
- **`adb connect` refusé** : activez *Débogage ADB* et acceptez l'invite sur la
  TV au premier `adb` ; l'IP est dans À propos → Réseau.

### Démarrage

- **« Le lecteur n'a pas pu être chargé »** après 30 s : la page n'a pas démarré.
  Si la version Chrome affichée est inférieure à **94**, le WebView ne peut pas
  exécuter le bundle Angular ; mettez à jour « Amazon WebView » via l'Appstore
  (GeckoView serait la solution de repli). Entre 94 et 110, l'app fonctionne
  avec des couleurs dégradées. La dernière erreur console est affichée sous le
  message.
- **« Le serveur embarqué n'a pas pu démarrer »** : les ports 43330 à 43334 sont
  occupés ; fermez l'application concernée ou redémarrez le Stick.
- **« Le lecteur a été relancé après avoir manqué de mémoire »** : le rendu web a
  été tué par le système ; la page se recharge. Si cela se répète, réduisez la
  playlist (catégories masquées dans IPTVnator).

### Affichage

- **L'image ne tient pas dans l'écran, ou est trop petite** : la mise à l'échelle
  est `px CSS ÷ largeur de layout` (Fire TV 1080p : 960 ÷ 1280 = 0,75). Vérifiez
  la ligne « Écran » du diagnostic et changez *Taille de l'interface* (960 =
  grande, 1280 = normale, 1600 = dense). Si l'affichage reste coupé, rapportez
  la ligne « Écran » et le build.

### Télécommande

- **Une touche ne fait rien** : `adb shell getevent -l` montre le code envoyé ;
  les touches interceptées sont dans `MainActivity.dispatchKeyEvent`, le reste
  va à la page (`tv.js`).
- **Plus de focus visible** : appuyez sur une flèche. Retour ferme d'abord
  dialogues et menus, puis remonte l'historique, puis quitte (deux appuis).
- **Pas de clavier sur un champ** : OK sur le champ ouvre le clavier Fire TV ;
  sinon `adb shell input text "..."`.

### Lecture

- **Flux muet / noir / « ce flux ne peut pas être lu ici »** : codec ou conteneur
  non géré par le WebView (`.ts` brut, AC3…). Acceptez l'ouverture dans VLC, ou
  Menu sur l'image / « Copier l'URL du flux ». Pour Xtream, choisissez le format
  de sortie `m3u8` dans les réglages de la playlist. Chaque nouvel essai sur une
  chaîne repropose le lecteur.
- **La proposition VLC n'apparaît plus** : réglages de la coquille → *Lecteur
  externe* → cochez « Proposer un lecteur externe ».

### Données

- **Repartir de zéro** : réglages de la coquille → *Effacer les données
  IPTVnator* (ou désinstaller l'app). Les données survivent aux mises à jour
  tant que le port du serveur ne change pas.
- **Inspecter la page** : réglages de la coquille → *débogage à distance*, puis
  `chrome://inspect` sur un PC avec `adb connect`.
