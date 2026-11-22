package org.tvshell.iptvnator.ui;

import java.io.IOException;
import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.function.BiPredicate;
import okhttp3.Call;
import okhttp3.Challenge;
import okhttp3.CookieJar;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.tvshell.iptvnator.backend.Json;

/** A credential-free request to the public source API metadata endpoint. */
final class HostedServerDiscovery {
    private HostedServerDiscovery() {}
    private static final int LIMIT = 16 * 1024;
    private static final OkHttpClient HTTP = new OkHttpClient.Builder().followRedirects(false)
        .followSslRedirects(false).retryOnConnectionFailure(false).cookieJar(CookieJar.NO_COOKIES)
        .callTimeout(7, TimeUnit.SECONDS).build();

    static Call instanceRequest(String address) {
        if (address == null || address.length() > 2048) return null;
        try {
            URI uri = new URI(address);
            if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) || uri.getHost() == null
                || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null) return null;
            HttpUrl base = HttpUrl.get(address);
            if (!base.encodedPath().equals(uri.getRawPath()) || !base.encodedPath().endsWith("/api")) return null;
            HttpUrl url = base.newBuilder().addPathSegment("v1").addPathSegment("instance").build();
            return HTTP.newCall(new Request.Builder().url(url).header("Accept", "application/json")
                .header("Cache-Control", "no-store").build());
        } catch (IllegalArgumentException | java.net.URISyntaxException invalid) { return null; }
    }

    static String classify(Response response, BiPredicate<String, String> savedPairing) throws IOException {
        HttpUrl url = response.request().url();
        String origin = HostedOrigin.normalize(url.resolve("/").toString());
        if (HostedAccessRedirect.isLogin(origin, response.code(), response.header("Location"))) return "access";
        if (url.isHttps() && response.code() == 401) {
            for (Challenge challenge : response.challenges()) {
                if (!"Bearer".equalsIgnoreCase(challenge.scheme())) continue;
                String metadata = challenge.authParams().get("resource_metadata");
                HttpUrl resource = metadata == null ? null : HttpUrl.parse(metadata);
                if (resource != null && resource.isHttps() && resource.encodedUsername().isEmpty()
                    && resource.encodedPassword().isEmpty()) return "access";
            }
        }
        Map<?, ?> info = sourceMetadata(response);
        if (info == null) return "unknown";
        List<?> capabilities = (List<?>) info.get("capabilities");
        Object auth = info.get("auth");
        if (capabilities.contains("cloudflare-device-v1")) return url.isHttps() ? "access" : "unknown";
        if ("none".equals(auth)) return "sources";
        if (!capabilities.contains("browser-pairing-v1")) return "token";
        return "/api/v1/instance".equals(url.encodedPath()) && savedPairing.test(origin, (String) info.get("instanceId"))
            ? "reconnect" : "pair";
    }

    static Map<?, ?> sourceMetadata(Response response) throws IOException {
        if (response.code() != 200 || response.body() == null) return null;
        MediaType type = response.body().contentType();
        if (type == null || !"application".equals(type.type()) || !"json".equals(type.subtype())
            || response.body().source().request(LIMIT + 1L)) return null;
        Object decoded;
        try { decoded = Json.parse(response.peekBody(LIMIT).string()); }
        catch (Json.JsonException invalid) { return null; }
        if (!(decoded instanceof Map)) return null;
        Map<?, ?> info = (Map<?, ?>) decoded;
        Object instance = info.get("instanceId");
        if (!"iptvnator".equals(info.get("service")) || !new Json.JsonNumber("1").equals(info.get("apiVersion"))
            || !"server".equals(info.get("storage")) || !(instance instanceof String) || ((String) instance).trim().isEmpty()
            || ((String) instance).length() > 200 || !(info.get("capabilities") instanceof List)) return null;
        List<?> capabilities = (List<?>) info.get("capabilities");
        Object auth = info.get("auth");
        if (!capabilities.contains("sources-v1") || !("none".equals(auth) || "token".equals(auth))) return null;
        return info;
    }
}
