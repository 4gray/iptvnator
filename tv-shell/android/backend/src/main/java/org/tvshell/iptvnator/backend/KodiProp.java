package org.tvshell.iptvnator.backend;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Port of libs/shared/m3u-utils kodiprop.utils.ts: turns the {@code #KODIPROP:}
 * lines kept in an item's {@code raw} block into the {@code drm} value the
 * player understands (ClearKey keys, or an unsupported license type).
 */
public final class KodiProp {

    private static final String KODIPROP_PREFIX = "#kodiprop:";
    private static final String LICENSE_TYPE_PROP = "inputstream.adaptive.license_type";
    private static final String LICENSE_KEY_PROP = "inputstream.adaptive.license_key";
    private static final String DRM_LEGACY_PROP = "inputstream.adaptive.drm_legacy";
    private static final Pattern HEX_128_BIT_PATTERN = Pattern.compile("^[0-9a-f]{32}$");
    private static final Pattern BASE64_PATTERN = Pattern.compile("^[A-Za-z0-9_+/-]+={0,2}$");

    private KodiProp() {
    }

    private static boolean isClearKeyLicenseType(String licenseType) {
        String t = licenseType.trim().toLowerCase(Locale.ROOT);
        return t.equals("clearkey") || t.equals("org.w3.clearkey");
    }

    /** @return the drm object, or null when the raw block carries no DRM props. */
    public static Map<String, Object> extractDrmFromRaw(String raw) {
        Map<String, String> props = collectKodipropValues(raw);
        if (props.isEmpty()) return null;

        String licenseType = props.containsKey(LICENSE_TYPE_PROP) ? props.get(LICENSE_TYPE_PROP).trim() : "";
        String licenseKey = props.containsKey(LICENSE_KEY_PROP) ? props.get(LICENSE_KEY_PROP).trim() : "";

        String drmLegacy = props.containsKey(DRM_LEGACY_PROP) ? props.get(DRM_LEGACY_PROP).trim() : null;
        if (drmLegacy != null && !drmLegacy.isEmpty() && (licenseType.isEmpty() || licenseKey.isEmpty())) {
            String[] parts = drmLegacy.split("\\|", -1);
            if (licenseType.isEmpty()) licenseType = parts.length > 0 ? parts[0].trim() : "";
            if (licenseKey.isEmpty()) {
                StringBuilder rest = new StringBuilder();
                for (int i = 1; i < parts.length; i++) {
                    if (i > 1) rest.append('|');
                    rest.append(parts[i]);
                }
                licenseKey = rest.toString().trim();
            }
        }

        if (licenseType.isEmpty() && licenseKey.isEmpty()) return null;

        String normalizedType = licenseType.toLowerCase(Locale.ROOT);
        Map<String, Object> clearKeys = null;
        if (isClearKeyLicenseType(normalizedType) || normalizedType.isEmpty()) {
            clearKeys = parseClearKeys(licenseKey);
        }

        Map<String, Object> drm = Json.object();
        if (clearKeys != null) {
            drm.put("licenseType", normalizedType.isEmpty() ? "clearkey" : normalizedType);
            drm.put("supported", Boolean.TRUE);
            drm.put("clearKeys", clearKeys);
            return drm;
        }
        drm.put("licenseType", normalizedType);
        drm.put("supported", Boolean.FALSE);
        return drm;
    }

    private static Map<String, String> collectKodipropValues(String raw) {
        Map<String, String> props = new LinkedHashMap<String, String>();
        if (raw == null || raw.isEmpty()) return props;
        for (String line : raw.split("\r?\n", -1)) {
            String trimmed = line.trim();
            if (!trimmed.toLowerCase(Locale.ROOT).startsWith(KODIPROP_PREFIX)) continue;
            String assignment = trimmed.substring(KODIPROP_PREFIX.length());
            int separatorIndex = assignment.indexOf('=');
            if (separatorIndex < 1) continue;
            String name = assignment.substring(0, separatorIndex).trim().toLowerCase(Locale.ROOT);
            String value = assignment.substring(separatorIndex + 1).trim();
            if (name.equals(LICENSE_TYPE_PROP) || name.equals(LICENSE_KEY_PROP) || name.equals(DRM_LEGACY_PROP)) {
                props.put(name, value);
            }
        }
        return props;
    }

    private static Map<String, Object> parseClearKeys(String value) {
        if (value == null || value.isEmpty()) return null;
        return value.startsWith("{") ? parseClearKeysFromJson(value) : parseClearKeysFromPairs(value);
    }

    private static Map<String, Object> parseClearKeysFromPairs(String value) {
        Map<String, Object> keys = Json.object();
        for (String pair : value.split(",", -1)) {
            String[] parts = pair.split(":", -1);
            if (parts.length > 2) return null;
            String kidHex = normalizeKeyComponent(parts.length > 0 ? parts[0] : null);
            String keyHex = normalizeKeyComponent(parts.length > 1 ? parts[1] : null);
            if (kidHex == null || keyHex == null) return null;
            keys.put(kidHex, keyHex);
        }
        return keys.isEmpty() ? null : keys;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> parseClearKeysFromJson(String value) {
        Object parsed;
        try {
            parsed = Json.parse(value);
        } catch (RuntimeException e) {
            return null;
        }
        if (!(parsed instanceof Map)) return null;
        Map<String, Object> record = (Map<String, Object>) parsed;
        Object keys = record.get("keys");
        if (keys instanceof List) return parseW3cClearKeyLicense((List<Object>) keys);
        return parseClearKeyMap(record);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> parseW3cClearKeyLicense(List<Object> entries) {
        Map<String, Object> keys = Json.object();
        for (Object entry : entries) {
            if (!(entry instanceof Map)) return null;
            Map<String, Object> e = (Map<String, Object>) entry;
            String kidHex = normalizeKeyComponent(Json.optString(e, "kid"));
            String keyHex = normalizeKeyComponent(Json.optString(e, "k"));
            if (kidHex == null || keyHex == null) return null;
            keys.put(kidHex, keyHex);
        }
        return keys.isEmpty() ? null : keys;
    }

    private static Map<String, Object> parseClearKeyMap(Map<String, Object> record) {
        Map<String, Object> keys = Json.object();
        for (Map.Entry<String, Object> entry : record.entrySet()) {
            if (!(entry.getValue() instanceof String)) return null;
            String kidHex = normalizeKeyComponent(entry.getKey());
            String keyHex = normalizeKeyComponent((String) entry.getValue());
            if (kidHex == null || keyHex == null) return null;
            keys.put(kidHex, keyHex);
        }
        return keys.isEmpty() ? null : keys;
    }

    private static String normalizeKeyComponent(String value) {
        if (value == null) return null;
        String compact = value.trim().replace("-", "").toLowerCase(Locale.ROOT);
        if (compact.isEmpty()) return null;
        if (HEX_128_BIT_PATTERN.matcher(compact).matches()) return compact;
        String fromBase64 = base64ToHex(value.trim());
        return fromBase64 != null && HEX_128_BIT_PATTERN.matcher(fromBase64).matches() ? fromBase64 : null;
    }

    private static String base64ToHex(String value) {
        if (!BASE64_PATTERN.matcher(value).matches()) return null;
        String base64 = value.replace('-', '+').replace('_', '/');
        byte[] bytes = Base64Lite.decode(base64);
        if (bytes == null) return null;
        StringBuilder hex = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            hex.append(Character.forDigit((b >> 4) & 0xF, 16));
            hex.append(Character.forDigit(b & 0xF, 16));
        }
        return hex.toString();
    }
}
