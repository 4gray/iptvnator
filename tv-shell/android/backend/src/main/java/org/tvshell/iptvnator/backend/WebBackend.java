package org.tvshell.iptvnator.backend;

import java.nio.charset.Charset;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The IPTVnator web-backend contract, embedded in the TV shell.
 *
 * Routes (all under the {@code /api} prefix the PWA is configured with):
 * <pre>
 *   GET  /health
 *   GET  /config.js
 *   POST /provider-targets          { url }  -> { targetId }
 *   POST /connectivity-guard/reset  { url }  -> { reset }
 *   GET  /parse?targetId&userAgent           -> Playlist record (M3U)
 *   GET  /xtream?targetId&...                -> { action, payload } | error body
 *   GET  /stalker?targetId&macAddress&token&serialNumber&... -> { action, payload } | error body
 *   GET  /parse-xml                          -> 501 (EPG is not part of the PWA)
 * </pre>
 * Mirrors apps/web-backend/src/app/web-backend-app.ts: same JSON shapes,
 * same HTTP statuses, same "provider failure answered with 200 + error body"
 * convention on the portal routes.
 */
public class WebBackend {

    public static final int TIMEOUT_PLAYLIST_MS = 30_000;
    public static final int TIMEOUT_XTREAM_MS = 30_000;
    public static final int TIMEOUT_STALKER_MS = 15_000;
    public static final int TIMEOUT_STALKER_CREATE_LINK_MS = 30_000;
    private static final Charset UTF8 = Charset.forName("UTF-8");

    public static final class Response {
        public final int status;
        public final String contentType;
        public final byte[] body;
        public final Map<String, String> headers = new LinkedHashMap<String, String>();

        public Response(int status, String contentType, byte[] body) {
            this.status = status;
            this.contentType = contentType;
            this.body = body;
            headers.put("Cache-Control", "no-store");
        }

        public String bodyText() {
            return new String(body, UTF8);
        }
    }

    private final HttpFetcher fetcher;
    private final String runtimeBackendUrl;
    private final Map<String, String> providerTargets = new ConcurrentHashMap<String, String>();

    public WebBackend(HttpFetcher fetcher, String runtimeBackendUrl) {
        this.fetcher = fetcher;
        this.runtimeBackendUrl = runtimeBackendUrl;
    }

    // ---------------------------------------------------------------- entry
    public Response handle(String method, String path, Map<String, List<String>> rawQuery, String body) {
        Map<String, String> query = firstValues(rawQuery);
        if (path == null || path.isEmpty()) path = "/";
        if ("OPTIONS".equals(method)) {
            Response r = new Response(200, "text/plain", new byte[0]);
            r.headers.put("Access-Control-Allow-Origin", "*");
            r.headers.put("Access-Control-Allow-Headers", "*");
            r.headers.put("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            return r;
        }
        if ("GET".equals(method) && (path.equals("/") || path.equals("/health"))) {
            Map<String, Object> out = Json.object();
            out.put("status", "ok");
            out.put("service", "iptvnator-tv-shell-backend");
            return json(200, out);
        }
        if ("GET".equals(method) && path.equals("/config.js")) {
            String js = "window.__IPTVNATOR_CONFIG__ = Object.assign({}, window.__IPTVNATOR_CONFIG__, {\"BACKEND_URL\":"
                + Json.write(runtimeBackendUrl) + "});\n";
            return new Response(200, "application/javascript; charset=utf-8", js.getBytes(UTF8));
        }
        if ("POST".equals(method) && path.equals("/provider-targets")) return registerProviderTarget(body);
        if ("POST".equals(method) && path.equals("/connectivity-guard/reset")) {
            Map<String, Object> out = Json.object();
            out.put("reset", Boolean.FALSE);
            return json(200, out);
        }
        if ("GET".equals(method) && path.equals("/parse")) return parse(query);
        if ("GET".equals(method) && path.equals("/parse-xml")) {
            return json(501, error("EPG (XMLTV) is not available in the TV shell", 501));
        }
        if ("GET".equals(method) && path.equals("/xtream")) return xtream(query);
        if ("GET".equals(method) && path.equals("/stalker")) return stalker(query);
        return json(404, error("Not found", 404));
    }

    // -------------------------------------------------------------- routes
    @SuppressWarnings("unchecked")
    private Response registerProviderTarget(String body) {
        String rawUrl = null;
        try {
            Object parsed = Json.parse(body == null || body.trim().isEmpty() ? "{}" : body);
            if (parsed instanceof Map) rawUrl = Json.optString((Map<String, Object>) parsed, "url");
        } catch (RuntimeException e) {
            rawUrl = null;
        }
        if (rawUrl == null || rawUrl.trim().isEmpty()) return json(400, error("Missing url", 400));
        String href;
        try {
            href = normalizeHref(rawUrl.trim());
        } catch (IllegalArgumentException e) {
            return json(400, error("Provider URL is not valid", 400));
        }
        String scheme = href.substring(0, href.indexOf(':')).toLowerCase();
        if (!scheme.equals("http") && !scheme.equals("https")) {
            return json(400, error("Only http and https provider URLs are supported", 400));
        }
        String id = sha256Hex(href);
        providerTargets.put(id, href);
        Map<String, Object> out = Json.object();
        out.put("targetId", id);
        return json(200, out);
    }

    /** The registered URL for a request, or an error response. */
    private Object registeredTarget(Map<String, String> query) {
        String id = query.get("targetId");
        if (id == null) return json(400, error("Missing targetId", 400));
        String url = providerTargets.get(id);
        if (url == null) return json(404, error("Provider target not found", 404));
        return url;
    }

    private Response parse(Map<String, String> query) {
        Object target = registeredTarget(query);
        if (target instanceof Response) return (Response) target;
        String url = (String) target;
        String userAgent = query.get("userAgent");
        Map<String, String> headers = new LinkedHashMap<String, String>();
        if (userAgent != null) headers.put("User-Agent", userAgent);
        String text;
        try {
            text = fetcher.get(url, headers, TIMEOUT_PLAYLIST_MS).body;
        } catch (ProviderException e) {
            Map<String, Object> err = Json.object();
            if (e.hasHttpStatus()) {
                err.put("status", Integer.valueOf(e.status));
                err.put("message", e.statusText);
                return json(e.status, err);
            }
            err.put("status", Integer.valueOf(500));
            err.put("message", e.code == null ? "Error, something went wrong" : "Error, something went wrong (" + e.code + ")");
            if (e.code != null) err.put("code", e.code);
            return json(500, err);
        }
        Map<String, Object> parsed;
        try {
            parsed = M3uParser.parse(text);
        } catch (RuntimeException e) {
            return json(500, error("Error, something went wrong", 500));
        }
        text = null; // the playlist text is not needed while the record is built and serialised
        return json(200, PlaylistBuilder.build(parsed, PlaylistBuilder.lastUrlSegment(url), url, userAgent));
    }

    private Response xtream(Map<String, String> query) {
        Object target = registeredTarget(query);
        if (target instanceof Response) return (Response) target;
        String registeredUrl = (String) target;
        String action = query.get("action");
        boolean connectionTest = "true".equals(query.get("connectionTest"));
        try {
            String base = PortalUrls.normalizeXtreamServerUrl(registeredUrl);
            Map<String, String> params = proxyParams(query, "targetId", "connectionTest");
            String requestUrl = PortalUrls.withQuery(PortalUrls.xtreamApiUrl(base), params);
            HttpFetcher.Result result = fetcher.get(requestUrl, null, TIMEOUT_XTREAM_MS);
            Map<String, Object> out = Json.object();
            out.put("action", action);
            out.put("payload", payloadOf(result.body));
            return json(200, out);
        } catch (ProviderException e) {
            if (connectionTest) {
                Map<String, Object> out = Json.object();
                out.put("connectionFailure", describeConnectionFailure(e));
                return json(200, out);
            }
            return json(200, e.toErrorBody());
        } catch (IllegalArgumentException e) {
            // normalizeXtreamServerUrl() threw: the web backend answers "Bad Gateway".
            if (connectionTest) {
                Map<String, Object> out = Json.object();
                Map<String, Object> failure = Json.object();
                failure.put("kind", "unknown");
                failure.put("canTryHttp", Boolean.FALSE);
                out.put("connectionFailure", failure);
                return json(200, out);
            }
            return json(200, error("Bad Gateway", 502));
        }
    }

    private Response stalker(Map<String, String> query) {
        Object target = registeredTarget(query);
        if (target instanceof Response) return (Response) target;
        String portalUrl = (String) target;
        String macAddress = query.get("macAddress");
        String token = query.get("token");
        String serialNumber = query.get("serialNumber");
        String action = query.get("action");
        try {
            Map<String, String> params = proxyParams(query, "targetId", "macAddress", "token", "serialNumber", "skipConnectionGuard");
            if ("handshake".equals(params.get("action")) && token != null) params.put("token", token);
            StalkerIdentity.RequestContext identity = StalkerIdentity.build(macAddress == null ? "" : macAddress, params, token, serialNumber);
            Map<String, String> headers = new LinkedHashMap<String, String>(identity.headers);
            if (macAddress == null) headers.remove("Cookie");
            String requestUrl = PortalUrls.buildStalkerRequestUrl(portalUrl, identity.requestParams);
            int timeout = "create_link".equals(params.get("action")) ? TIMEOUT_STALKER_CREATE_LINK_MS : TIMEOUT_STALKER_MS;
            HttpFetcher.Result result = fetcher.get(requestUrl, headers, timeout);
            Map<String, Object> out = Json.object();
            out.put("action", action);
            out.put("payload", payloadOf(result.body));
            return json(200, out);
        } catch (ProviderException e) {
            return json(200, e.toErrorBody());
        } catch (IllegalArgumentException e) {
            return json(200, error("Bad Gateway", 502));
        }
    }

    // ------------------------------------------------------------- helpers
    static Map<String, Object> describeConnectionFailure(ProviderException e) {
        Map<String, Object> failure = Json.object();
        if (e.hasHttpStatus()) {
            failure.put("kind", "http");
            failure.put("status", Integer.valueOf(e.status));
            failure.put("canTryHttp", Boolean.FALSE);
            return failure;
        }
        String code = e.code == null ? "" : e.code;
        if (code.isEmpty()) {
            failure.put("kind", "unknown");
            failure.put("canTryHttp", Boolean.FALSE);
            return failure;
        }
        boolean wrongVersion = code.equals("ERR_SSL_WRONG_VERSION_NUMBER");
        boolean tls = code.matches(".*(CERT|TLS|SSL|CRL).*") || code.equals("EPROTO") || code.equals("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
        failure.put("kind", tls ? "tls" : "connection");
        failure.put("canTryHttp", Boolean.valueOf(code.equals("ECONNREFUSED") || wrongVersion));
        return failure;
    }

    /**
     * axios parses JSON answers; anything else stays a string. A JSON answer is validated and
     * passed through verbatim ({@link Json.Raw}): nothing here inspects it, and rebuilding a
     * 20 MB catalogue as maps and lists would need several times that in heap on a 1 GB device.
     */
    static Object payloadOf(String body) {
        if (body == null) return "";
        String trimmed = body.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith("\"") || trimmed.equals("null")
            || trimmed.equals("true") || trimmed.equals("false") || trimmed.matches("-?\\d.*")) {
            if (Json.validate(trimmed)) return new Json.Raw(trimmed);
            try {
                // Lenient JSON (a raw tab in a title, a sloppy escape): rebuilt, so the writer re-escapes it.
                return Json.parse(trimmed);
            } catch (RuntimeException e) {
                return body;
            }
        }
        return body;
    }

    static Map<String, String> proxyParams(Map<String, String> query, String... excluded) {
        Map<String, String> params = new LinkedHashMap<String, String>();
        outer:
        for (Map.Entry<String, String> entry : query.entrySet()) {
            for (String ex : excluded) {
                if (ex.equals(entry.getKey())) continue outer;
            }
            params.put(entry.getKey(), entry.getValue());
        }
        return params;
    }

    /** First value per key, trimmed; empty values are dropped (normalizeQueryValue). */
    static Map<String, String> firstValues(Map<String, List<String>> raw) {
        Map<String, String> out = new LinkedHashMap<String, String>();
        if (raw == null) return out;
        for (Map.Entry<String, List<String>> entry : raw.entrySet()) {
            List<String> values = entry.getValue();
            if (values == null || values.isEmpty()) continue;
            String value = values.get(0);
            if (value == null) continue;
            String trimmed = value.trim();
            if (!trimmed.isEmpty()) out.put(entry.getKey(), trimmed);
        }
        return out;
    }

    /** Roughly {@code new URL(raw).href}: validates and normalises scheme/host. */
    static String normalizeHref(String raw) {
        java.net.URI uri = PortalUrls.parse(raw);
        String path = uri.getRawPath() == null || uri.getRawPath().isEmpty() ? "/" : uri.getRawPath();
        String query = uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery();
        String fragment = uri.getRawFragment() == null ? "" : "#" + uri.getRawFragment();
        String userInfo = uri.getRawUserInfo() == null ? "" : uri.getRawUserInfo() + "@";
        String origin = PortalUrls.origin(uri);
        int schemeEnd = origin.indexOf("://") + 3;
        return origin.substring(0, schemeEnd) + userInfo + origin.substring(schemeEnd) + path + query + fragment;
    }

    static String sha256Hex(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(value.getBytes(UTF8));
            StringBuilder hex = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16));
                hex.append(Character.forDigit(b & 0xF, 16));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    static Map<String, Object> error(String message, int status) {
        Map<String, Object> body = Json.object();
        body.put("message", message);
        body.put("status", Integer.valueOf(status));
        return body;
    }

    /** Serialised straight to UTF-8 bytes: one growing buffer, not a char buffer plus a String plus bytes. */
    static Response json(int status, Object body) {
        return new Response(status, "application/json; charset=utf-8", Json.writeUtf8(body));
    }

    /** For tests and diagnostics. */
    public int registeredTargetCount() {
        return providerTargets.size();
    }
}
