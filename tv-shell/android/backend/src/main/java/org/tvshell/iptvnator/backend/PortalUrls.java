package org.tvshell.iptvnator.backend;

import java.io.UnsupportedEncodingException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLEncoder;
import java.nio.charset.Charset;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Ports of the URL helpers in libs/shared/interfaces:
 * {@code normalizeXtreamServerUrl}, {@code buildStalkerRequestUrl} and
 * {@code encodeStalkerCmdValue}.
 */
public final class PortalUrls {

    private static final Pattern XTREAM_API_ENDPOINT_PATTERN = Pattern.compile("/(?:get|player_api|panel_api)\\.php$", Pattern.CASE_INSENSITIVE);
    private static final Pattern SAFE_CMD_CHAR = Pattern.compile("^[A-Za-z0-9\\-_.~!*()/:?@$,+=\\[\\]%]$");
    private static final Charset UTF8 = Charset.forName("UTF-8");

    private PortalUrls() {
    }

    /** {@code origin} as the WHATWG URL API computes it: scheme://host[:port] with default ports dropped. */
    public static String origin(URI url) {
        String scheme = url.getScheme().toLowerCase(Locale.ROOT);
        String host = url.getHost();
        if (host == null) throw new IllegalArgumentException("URL has no host");
        host = host.toLowerCase(Locale.ROOT);
        int port = url.getPort();
        boolean defaultPort = port == -1 || (scheme.equals("http") && port == 80) || (scheme.equals("https") && port == 443);
        return scheme + "://" + host + (defaultPort ? "" : ":" + port);
    }

    public static URI parse(String value) {
        try {
            URI url = new URI(value.trim());
            if (url.getScheme() == null || url.getHost() == null) throw new IllegalArgumentException("Invalid URL");
            return url;
        } catch (URISyntaxException e) {
            throw new IllegalArgumentException("Invalid URL: " + e.getMessage());
        }
    }

    /** Server base URL: origin + path without trailing slashes and without a trailing API endpoint. */
    public static String normalizeXtreamServerUrl(String value) {
        String trimmed = value == null ? "" : value.trim();
        if (trimmed.isEmpty()) throw new IllegalArgumentException("Xtream URL is required");
        URI url = parse(trimmed);
        String scheme = url.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("http") && !scheme.equals("https")) {
            throw new IllegalArgumentException("Only http and https Xtream URLs are supported");
        }
        if (url.getUserInfo() != null && !url.getUserInfo().isEmpty()) {
            throw new IllegalArgumentException("URL credentials are not supported");
        }
        String path = url.getRawPath() == null ? "" : url.getRawPath();
        String pathWithoutTrailingSlash = path.replaceAll("/+$", "");
        String basePath = XTREAM_API_ENDPOINT_PATTERN.matcher(pathWithoutTrailingSlash).replaceAll("");
        return origin(url) + basePath;
    }

    /** {@code <base>/player_api.php} — path segment appended, query and fragment dropped. */
    public static String xtreamApiUrl(String normalizedBase) {
        return normalizedBase.replaceAll("/+$", "") + "/player_api.php";
    }

    /** JavaScript encodeURIComponent: unreserved set A-Z a-z 0-9 - _ . ! ~ * ' ( ). */
    public static String encodeURIComponent(String value) {
        try {
            String encoded = URLEncoder.encode(value, "UTF-8");
            // URLEncoder differs from encodeURIComponent on a few characters.
            return encoded.replace("+", "%20").replace("%21", "!").replace("%27", "'").replace("%28", "(").replace("%29", ")").replace("%7E", "~");
        } catch (UnsupportedEncodingException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Wire encoding of the Stalker {@code cmd} parameter (see stalker-cmd-encoding.util.ts). */
    public static String encodeStalkerCmdValue(String value) {
        StringBuilder encoded = new StringBuilder(value.length() + 16);
        int i = 0;
        while (i < value.length()) {
            int codePoint = value.codePointAt(i);
            String ch = new String(Character.toChars(codePoint));
            if (codePoint < 128 && SAFE_CMD_CHAR.matcher(ch).matches()) {
                encoded.append(ch);
            } else {
                for (byte b : ch.getBytes(UTF8)) {
                    encoded.append('%').append(String.format(Locale.ROOT, "%02X", b & 0xFF));
                }
            }
            i += Character.charCount(codePoint);
        }
        return encoded.toString();
    }

    /** Port of buildStalkerRequestUrl(): origin + pathname + hand-assembled query. */
    public static String buildStalkerRequestUrl(String portalUrl, Map<String, String> requestParams) {
        URI url = parse(portalUrl);
        String path = url.getRawPath() == null || url.getRawPath().isEmpty() ? "/" : url.getRawPath();
        StringBuilder query = new StringBuilder();
        for (Map.Entry<String, String> entry : requestParams.entrySet()) {
            if (query.length() > 0) query.append('&');
            if (entry.getKey().equals("cmd")) {
                query.append("cmd=").append(encodeStalkerCmdValue(entry.getValue()));
            } else {
                query.append(entry.getKey()).append('=').append(encodeURIComponent(entry.getValue()));
            }
        }
        String jsHttpRequest = requestParams.get("JsHttpRequest");
        if (jsHttpRequest == null || jsHttpRequest.isEmpty()) {
            if (query.length() > 0) query.append('&');
            query.append("JsHttpRequest=1-xml");
        }
        return origin(url) + path + "?" + query;
    }

    /** Appends query parameters (encodeURIComponent-encoded) to a URL that has none. */
    public static String withQuery(String url, Map<String, String> params) {
        StringBuilder sb = new StringBuilder(url);
        boolean first = !url.contains("?");
        for (Map.Entry<String, String> entry : params.entrySet()) {
            sb.append(first ? '?' : '&');
            first = false;
            sb.append(encodeURIComponent(entry.getKey())).append('=').append(encodeURIComponent(entry.getValue()));
        }
        return sb.toString();
    }

    public static Map<String, String> copy(Map<String, String> params) {
        return new LinkedHashMap<String, String>(params);
    }
}
