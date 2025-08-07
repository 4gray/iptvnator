# Ruvo Player Rebranding - Assets Replacement Guide

## Completed Rebranding Tasks

✅ **Application Metadata**

-   Updated `package.json` with Ruvo Player branding
-   Updated `src/index.html` title and meta tags
-   Updated `src/manifest.webmanifest`
-   Updated `src-tauri/tauri.conf.json`
-   Updated `src-tauri/Cargo.toml`

✅ **UI Text & Internationalization**

-   Updated English (`en.json`) translations
-   Updated Spanish (`es.json`) translations
-   Updated French (`fr.json`) translations
-   Updated German (`de.json`) translations
-   Updated Dutch (`nl.json`) translations
-   Updated Chinese (`zh.json`) translations
-   Updated About dialog component with new GitHub and support URLs

✅ **Documentation**

-   Updated `README.md` with complete Ruvo Player branding
-   Updated `docker/README.md`

## Assets That Need Replacement

The following icon and image assets still contain the original IPTVnator branding and should be replaced with Ruvo Player branded versions:

### Web App Icons (`src/assets/icons/`)

-   `android-chrome-192x192.png`
-   `android-chrome-512x512.png`
-   `android-chrome-maskable-192x192.png`
-   `android-chrome-maskable-512x512.png`
-   `apple-touch-icon.png`
-   `favicon.256x256.png`
-   `favicon.512x512.png`
-   `favicon.icns`
-   `favicon.ico`
-   `favicon.png`
-   `icon-1024.png`
-   `icon-128.png`
-   `icon-16.png`
-   `icon-32.png`
-   `icon-48.png`
-   `icon-64.png`
-   `icon-tv-256.png` (used in About dialog)
-   `icon.png`

### Tauri App Icons (`src-tauri/icons/`)

-   `32x32.png`
-   `128x128.png`
-   `128x128@2x.png`
-   `icon.icns` (macOS)
-   `icon.ico` (Windows)
-   `icon.png`
-   All Android icons in `android/` subdirectory
-   All iOS icons in `ios/` subdirectory
-   All Windows Store icons (`Square*.png`, `StoreLogo.png`)

### Screenshots and Marketing Images

-   `iptv-dark-theme.png`
-   `iptv-epg.png`
-   `iptv-main.png`
-   `iptv-playlist-settings.png`
-   `iptv-settings.png`
-   `iptv-upload.png`
-   `playlists.png`
-   `upload-via-url.png`

## Remaining Language Files

The following language files still contain "IPTVnator" references that should be updated:

-   `src/assets/i18n/ru.json`
-   `src/assets/i18n/it.json`
-   `src/assets/i18n/tr.json`
-   `src/assets/i18n/ko.json`
-   `src/assets/i18n/ja.json`
-   `src/assets/i18n/pl.json`
-   `src/assets/i18n/by.json`
-   `src/assets/i18n/ar.json`
-   `src/assets/i18n/ary.json`
-   `src/assets/i18n/zhtw.json`

## Next Steps

1. **Create Ruvo Player Logo**: Design a new logo/icon for Ruvo Player
2. **Generate Icon Variants**: Create all required icon sizes and formats
3. **Replace All Icons**: Systematically replace all icon files with Ruvo Player versions
4. **Update Screenshots**: Take new screenshots showing Ruvo Player branding
5. **Complete Language Files**: Update remaining translation files
6. **Test Build**: Ensure the application builds and runs correctly with new branding

## Brand Guidelines

When creating new assets, consider:

-   Use Ruvo Play brand colors and typography
-   Maintain consistency with other Ruvo Play products
-   Ensure icons are readable at all required sizes
-   Follow platform-specific design guidelines (iOS, Android, Windows, macOS)

## Repository URLs Updated

All GitHub repository references have been updated from:

-   `https://github.com/4gray/iptvnator`
-   To: `https://github.com/ruvoplay/ruvo-player`

Support links now point to:

-   `https://ruvoplay.com/support`
-   `https://t.me/ruvoplayer`
