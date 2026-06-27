# Xtream Portal Compatibility

This document captures the Xtream Codes compatibility rules shared by the
Electron and PWA paths.

## Connection Input

Xtream server URLs are normalized through
`normalizeXtreamServerUrl` from `@iptvnator/shared/interfaces`.

Rules:

1. Only `http` and `https` URLs are accepted.
2. URL username/password credentials are rejected.
3. Leading and trailing whitespace is ignored.
4. Trailing slashes are removed.
5. Full API or playlist URLs ending in `/player_api.php` or `/get.php` are
   reduced to the portal base URL.
6. Provider subpaths are preserved. For example,
   `https://example.test/panel/player_api.php?...` becomes
   `https://example.test/panel`.

The Xtream import form may extract `username` and `password` from full
`get.php` or `player_api.php` URLs, but stored playlist metadata should keep
the normalized `serverUrl` plus trimmed credentials.

## Account Status

Account status handling uses `resolveXtreamPortalStatus`.

Compatibility rules:

1. Status text is case-insensitive, so `Active`, `active`, and `ACTIVE` are
   treated the same.
2. `auth` values `1`, `'1'`, and `true` can mark a response as active when no
   status text is present.
3. `auth` values `0`, `'0'`, and `false` mark the response inactive.
4. `exp_date` values `0`, negative numbers, missing values, or invalid values
   are treated as no expiry.
5. A past positive `exp_date` marks the account expired even when status is
   active.

Status probes try account-info-compatible Xtream variants in this order:

1. `action=get_account_info`
2. no `action`
3. `action=get_profile`

This fallback exists because real panels differ even when they advertise
Xtream Codes compatibility.

## Request Construction

Electron IPC and the PWA backend both construct API requests by appending
`/player_api.php` to the normalized portal base URL. They must not append
`player_api.php` to an already full `player_api.php` or `get.php` URL.

Credentials sent to the API are trimmed before serialization.

The PWA backend only proxies Xtream requests through registered provider
targets. Those targets are validated when registered and revalidated before the
`/xtream` proxy request, including protocol, URL credentials, DNS resolution,
and private-network checks.

## Playback URL Formats

When account info includes `user_info.allowed_output_formats`, the current
Xtream playlist keeps those formats for the active session. The default
application format is `auto`: live stream URL construction chooses `m3u8` when
the provider allows HLS, falls back to `ts` when MPEG-TS is the only known
standard format, and otherwise uses the first provider-advertised format. If
the provider does not advertise output formats, `auto` falls back to `m3u8`.
Manual `ts` and `m3u8` settings remain supported; when a manual setting is not
allowed by the portal, URL construction falls back to the first
provider-allowed format.

If stored Xtream playback credentials contain an invalid server URL or blank
username/password, stream URL construction returns an empty URL instead of
throwing during playback.

## Catch-Up Playback URLs

Xtream-compatible portals differ on archive playback URL shape. IPTVnator
supports these catch-up variants:

1. REST-style `/timeshift/{username}/{password}/{duration}/{start}/{streamId}.ts`
   and `.m3u8`.
2. Legacy `/streaming/timeshift.php?username=...&password=...&stream=...&start=...&duration=...`
   with optional `extension=ts` or `extension=m3u8`.

Electron probes concrete catch-up variants before caching a playlist-level
choice. The cache key includes the playlist id and the normalized
`allowed_output_formats` advertised by the provider, so a catch-up variant
detected before account capabilities are known cannot force stale MPEG-TS URLs
after the portal later reports HLS-only playback. The probe uses a short range
`GET`, follows only validated redirects, and accepts only `200` or `206` as
playable. MPEG-TS is preferred before HLS when the provider allows it because
some portals return a valid HLS manifest while the first media segment fails in
Chromium/video.js. PWA fallback keeps the REST MPEG-TS URL when no Electron
probe API is available.
