package org.tvshell.iptvnator.ui;

import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okio.BufferedSource;
import okio.Timeout;
import org.json.JSONObject;

/** Only the packaged client's API routes can be mapped onto the selected server. */
final class HostedApiRequest {
    private HostedApiRequest() {}
    private static final int MAX_HEARTBEAT_BYTES = 128;
    private static final OkHttpClient API = HostedAccessOAuth.HTTP.newBuilder()
        .callTimeout(0, TimeUnit.SECONDS).readTimeout(45, TimeUnit.SECONDS).build();
    private static final OkHttpClient PLAYLIST_API = API.newBuilder()
        .readTimeout(310, TimeUnit.SECONDS).build();

    static Call call(String appBase, String instance, String token, String deviceKey, JSONObject input,
                     RequestBody upload) throws Exception {
        String relative = input.getString("path");
        String path = relative.split("\\?", 2)[0];
        String method = input.getString("method");
        if (relative.length() > 32768 || relative.contains("#") || relative.contains("\\") || !allowed(path, method))
            throw new IOException("Unsupported hosted request");
        HttpUrl target = HttpUrl.get(appBase + relative);
        String prefix = HttpUrl.get(appBase).encodedPath().replaceFirst("/$", "");
        if (!target.encodedPath().equals(prefix + path)) throw new IOException("Unsupported hosted request");
        Request.Builder request = new Request.Builder().url(target);
        if (!token.isEmpty()) request.header("Authorization", "Bearer " + token);
        if (!instance.isEmpty()) request.header("X-IPTVnator-Instance-Id", instance);
        if (!deviceKey.isEmpty()) request.header("X-IPTVnator-Device-Key", deviceKey);
        JSONObject headers = input.optJSONObject("headers");
        if (headers != null) {
            for (String name : new String[]{"if-match", "if-none-match", "accept"})
                if (headers.has(name)) request.header(name, headers.getString(name));
        }
        boolean read = "GET".equals(method) || "HEAD".equals(method);
        if (read && upload.contentLength() != 0) throw new IOException("Unexpected hosted request body");
        RequestBody body = read || ("DELETE".equals(method) && upload.contentLength() == 0) ? null : upload;
        return clientForPath(path).newCall(request.method(method, body).build());
    }

    static OkHttpClient clientForPath(String path) {
        return "/api/parse".equals(path) ? PLAYLIST_API : API;
    }

    static JSONObject responseHeaders(Response response) throws Exception {
        JSONObject headers = new JSONObject();
        for (String name : new String[]{"content-type", "etag", "cache-control", "www-authenticate", "x-iptvnator-device-status"}) {
            String value = response.header(name);
            if (value != null) headers.put(name, value);
        }
        return new JSONObject().put("status", response.code()).put("headers", headers);
    }

    static InputStream responseBody(Response response) throws IOException {
        BufferedSource source = response.body().source();
        if ("1".equals(response.header("X-IPTVnator-JSON-Heartbeat"))) {
            // Bound the heartbeat independently so the JSON keeps its full response budget.
            Timeout timeout = source.timeout();
            boolean hadDeadline = timeout.hasDeadline();
            long previousDeadline = hadDeadline ? timeout.deadlineNanoTime() : 0;
            long heartbeatDeadline = System.nanoTime() + TimeUnit.MINUTES.toNanos(15);
            timeout.deadlineNanoTime(hadDeadline ? Math.min(previousDeadline, heartbeatDeadline) : heartbeatDeadline);
            try {
                for (int skipped = 0; source.request(1) && source.getBuffer().getByte(0) == '\n'; skipped++) {
                    if (skipped == MAX_HEARTBEAT_BYTES) throw new IOException("Hosted heartbeat is too large");
                    source.skip(1);
                }
            } finally {
                if (hadDeadline) timeout.deadlineNanoTime(previousDeadline);
                else timeout.clearDeadline();
            }
        }
        return source.inputStream();
    }

    private static boolean allowed(String path, String method) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.contains("%2e") || lower.contains("%5c") ||
            path.contains("//") || !method.matches("GET|HEAD|POST|PUT|PATCH|DELETE")) return false;
        if (lower.contains("%2f") || path.contains("..")) {
            if (!sourceIdRoute(path, method)) return false;
            // Adjacent dots and encoded slashes can be part of an ID. Only whole dot segments traverse a path.
            for (String segment : lower.replace("%2f", "/").split("/")) {
                if (segment.equals(".") || segment.equals("..")) return false;
            }
            return true;
        }
        if (path.equals("/api/v1/instance")) return method.equals("GET") || method.equals("HEAD");
        if (path.matches("/api/v1/(sources|playlists|activity|favorites|history|user-state|app-state)(/[^/?]+)*")) return true;
        if (path.matches("/api/(parse|parse-xml|xtream|stalker)")) return method.equals("GET");
        return path.matches("/api/(provider-targets|connectivity-guard/reset|v1/tmdb-transfer|v1/device-pairing/cloudflare-invite)") && method.equals("POST");
    }

    // Express matches each :id as one path parameter before decoding it.
    private static boolean sourceIdRoute(String path, String method) {
        boolean read = method.equals("GET") || method.equals("HEAD");
        if (path.matches("/api/v1/sources/[^/]+"))
            return read || method.matches("PUT|PATCH|DELETE");
        if (path.matches("/api/v1/playlists/[^/]+"))
            return read || method.matches("PUT|DELETE");
        if (path.matches("/api/v1/(activity|favorites)/sources/[^/]+(/items)?")
            || path.matches("/api/v1/history/sources/[^/]+")) return read;
        return method.matches("PUT|DELETE") && path.matches(
            "/api/v1/user-state/xtream-(favorites|recent-items|collection-items|playback-positions)/[^/]+");
    }
}
