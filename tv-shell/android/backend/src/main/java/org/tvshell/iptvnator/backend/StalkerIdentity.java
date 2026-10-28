package org.tvshell.iptvnator.backend;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Port of libs/shared/interfaces stalker-request-identity.util.ts and
 * stalker-identity.utils.ts: the cookie, User-Agent pair and SN/Authorization
 * headers a MAG box presents to a Stalker portal, plus the serial-number
 * parameter rules.
 */
public final class StalkerIdentity {

    public static final String STALKER_MAG_USER_AGENT =
        "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250";
    static final String LEGACY_DEFAULT_STALKER_SERIAL = "BEDACD4569BAF";
    private static final int STALKER_CFDUID_LENGTH = 32;
    private static final String STALKER_SERIAL_CFDUID_SUFFIX = "e030245495acd6ebfc1";

    public static final class RequestContext {
        public final Map<String, String> requestParams;
        public final Map<String, String> headers;
        public final String cookieString;
        public final String effectiveSerialNumber;

        RequestContext(Map<String, String> requestParams, Map<String, String> headers, String cookieString, String effectiveSerialNumber) {
            this.requestParams = requestParams;
            this.headers = headers;
            this.cookieString = cookieString;
            this.effectiveSerialNumber = effectiveSerialNumber;
        }
    }

    private StalkerIdentity() {
    }

    static String normalizeSerialNumber(String serialNumber) {
        String trimmed = serialNumber == null ? "" : serialNumber.trim();
        if (trimmed.isEmpty() || trimmed.toUpperCase(Locale.ROOT).equals(LEGACY_DEFAULT_STALKER_SERIAL)) return null;
        return trimmed;
    }

    static String buildSerialCfduid(String serialNumber) {
        String serialPrefix = serialNumber.toLowerCase(Locale.ROOT).replaceAll("[^a-f0-9]", "");
        String combined = serialPrefix + STALKER_SERIAL_CFDUID_SUFFIX;
        if (combined.length() > STALKER_CFDUID_LENGTH) combined = combined.substring(0, STALKER_CFDUID_LENGTH);
        StringBuilder padded = new StringBuilder(combined);
        while (padded.length() < STALKER_CFDUID_LENGTH) padded.append('0');
        return padded.toString();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, String> buildRequestParams(Map<String, String> params, String effectiveSerialNumber) {
        Map<String, String> requestParams = new LinkedHashMap<String, String>(params);
        boolean isProfileRequest = "stb".equals(requestParams.get("type")) && "get_profile".equals(requestParams.get("action"));
        if (!isProfileRequest) {
            requestParams.remove("sn");
            return requestParams;
        }
        if (effectiveSerialNumber != null) requestParams.put("sn", effectiveSerialNumber);
        else requestParams.remove("sn");

        String metrics = requestParams.get("metrics");
        if (metrics != null) {
            try {
                Object parsed = Json.parse(metrics);
                Map<String, Object> next = Json.object();
                if (parsed instanceof Map) next.putAll((Map<String, Object>) parsed);
                if (effectiveSerialNumber != null) next.put("sn", effectiveSerialNumber);
                else next.remove("sn");
                requestParams.put("metrics", Json.write(next));
            } catch (RuntimeException e) {
                // Keep original metrics payload when malformed.
            }
        }
        return requestParams;
    }

    private static String buildCookieString(String macAddress, String effectiveSerialNumber) {
        StringBuilder sb = new StringBuilder();
        sb.append("mac=").append(macAddress == null ? "" : macAddress);
        sb.append("; stb_lang=en_US@rg=dezzzz");
        sb.append("; timezone=Europe/Berlin");
        if (effectiveSerialNumber != null) sb.append("; __cfduid=").append(buildSerialCfduid(effectiveSerialNumber));
        return sb.toString();
    }

    public static RequestContext build(String macAddress, Map<String, String> params, String token, String serialNumber) {
        String effectiveSerialNumber = normalizeSerialNumber(serialNumber);
        Map<String, String> requestParams = buildRequestParams(params, effectiveSerialNumber);
        String cookieString = buildCookieString(macAddress, effectiveSerialNumber);
        Map<String, String> headers = new LinkedHashMap<String, String>();
        headers.put("Cookie", cookieString);
        headers.put("User-Agent", STALKER_MAG_USER_AGENT);
        headers.put("X-User-Agent", STALKER_MAG_USER_AGENT);
        headers.put("Accept", "*/*");
        headers.put("Connection", "keep-alive");
        headers.put("Accept-Language", "en-US,en;q=0.9");
        if (effectiveSerialNumber != null) headers.put("SN", effectiveSerialNumber);
        if (token != null && !token.isEmpty()) headers.put("Authorization", "Bearer " + token);
        return new RequestContext(requestParams, headers, cookieString, effectiveSerialNumber);
    }
}
