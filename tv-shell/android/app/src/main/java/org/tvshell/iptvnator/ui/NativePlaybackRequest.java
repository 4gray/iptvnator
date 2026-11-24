package org.tvshell.iptvnator.ui;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.common.util.Util;

import org.tvshell.iptvnator.backend.Json;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

import okhttp3.Cookie;
import okhttp3.CookieJar;
import okhttp3.Headers;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

final class NativePlaybackRequest {
    private static final List<String> PROVIDER_HEADERS = Arrays.asList(
        "accept", "authorization", "cookie", "origin", "referer", "sn", "user-agent", "x-user-agent");
    private static final OkHttpClient HTTP = new OkHttpClient.Builder()
        .addInterceptor(chain -> {
            Response response = chain.proceed(chain.request());
            if (response.isSuccessful() || response.body() == null) return response;
            // Media3 copies error bodies into memory. Its local error UI only needs the status.
            response.body().close();
            return response.newBuilder().body(ResponseBody.create(new byte[0], null)).build();
        }).build();

    private NativePlaybackRequest() {}

    @OptIn(markerClass = UnstableApi.class)
    static Intent toIntent(Context context, Object payload) {
        if (!(payload instanceof Map<?, ?>)) return null;
        Map<?, ?> request = (Map<?, ?>) payload;
        String url = text(request.get("url"));
        HttpUrl stream = HttpUrl.parse(url);
        if (stream == null || !stream.username().isEmpty() || !stream.password().isEmpty()) return null;
        boolean hls = Boolean.TRUE.equals(request.get("hls"));
        int sourceType = Util.inferContentType(Uri.parse(stream.toString()));
        if (sourceType != C.CONTENT_TYPE_HLS && sourceType != C.CONTENT_TYPE_OTHER
            && !(sourceType == C.CONTENT_TYPE_SS && hls)) return null;
        Bundle headers = new Bundle();
        if (request.get("headers") instanceof Map<?, ?>) {
            ((Map<?, ?>) request.get("headers")).forEach((key, value) -> {
                String name = text(key).toLowerCase(Locale.ROOT);
                String content = text(value).trim();
                if (PROVIDER_HEADERS.contains(name) && !content.isEmpty()
                    && content.length() <= 8192 && content.chars().allMatch(c -> c >= 32 && c < 127)) {
                    headers.putString(name, content);
                }
            });
        }
        return new Intent(context, NativePlayerActivity.class)
            .putExtra("url", stream.toString())
            .putExtra("hls", hls)
            .putExtra("live", Boolean.TRUE.equals(request.get("live")))
            .putExtra("captions", Boolean.TRUE.equals(request.get("captions")))
            .putExtra("position", positionMs(request.get("startTime")))
            .putExtra("volume", volume(request.get("volume"), 1f))
            .putExtra("audibleVolume", volume(request.get("audibleVolume"), 0.5f))
            .putExtra("headers", headers);
    }

    static OkHttpClient client(HttpUrl stream, Bundle headers) {
        Headers.Builder builder = new Headers.Builder();
        if (headers != null) {
            for (String name : headers.keySet()) {
                if (!name.equalsIgnoreCase("Cookie")) builder.set(name, headers.getString(name));
            }
        }
        Headers providerHeaders = builder.build();
        // The network interceptor runs for each redirect, segment and HLS key request.
        // Provider headers never become part of OkHttp's request for another origin.
        String initialCookies = headers == null ? null : headers.getString("cookie");
        return HTTP.newBuilder().cookieJar(new PlaybackCookies(stream, initialCookies)).addNetworkInterceptor(chain -> {
            Request request = chain.request();
            if (!sameOrigin(stream, request.url())) return chain.proceed(request);
            Request.Builder scoped = request.newBuilder();
            for (String name : providerHeaders.names()) {
                scoped.header(name, providerHeaders.get(name));
            }
            return chain.proceed(scoped.build());
        }).build();
    }

    private static boolean sameOrigin(HttpUrl origin, HttpUrl url) {
        return origin.scheme().equals(url.scheme()) && origin.host().equals(url.host())
            && origin.port() == url.port();
    }

    private static final class PlaybackCookies implements CookieJar {
        private final HttpUrl origin;
        private final List<Cookie> cookies = new ArrayList<>();

        PlaybackCookies(HttpUrl origin, String initialCookies) {
            this.origin = origin;
            if (initialCookies == null) return;
            for (String field : initialCookies.split(";")) {
                Cookie cookie = Cookie.parse(origin, field.trim() + "; Path=/");
                if (cookie != null) cookies.add(cookie);
            }
            if (cookies.size() > 64) cookies.subList(64, cookies.size()).clear();
        }

        @Override
        public synchronized void saveFromResponse(HttpUrl url, List<Cookie> received) {
            if (!sameOrigin(origin, url)) return;
            long now = System.currentTimeMillis();
            cookies.removeIf(cookie -> cookie.expiresAt() <= now);
            for (Cookie next : received) {
                cookies.removeIf(cookie -> cookie.name().equals(next.name())
                    && cookie.domain().equals(next.domain()) && cookie.path().equals(next.path()));
                if (next.expiresAt() > now && next.name().length() + next.value().length() <= 4096) {
                    if (cookies.size() == 64) cookies.remove(0);
                    cookies.add(next);
                }
            }
        }

        @Override
        public synchronized List<Cookie> loadForRequest(HttpUrl url) {
            if (!sameOrigin(origin, url)) return Collections.emptyList();
            long now = System.currentTimeMillis();
            List<Cookie> matches = new ArrayList<>();
            for (Cookie cookie : cookies) {
                if (cookie.expiresAt() > now && cookie.matches(url)) matches.add(cookie);
            }
            matches.sort((left, right) -> Integer.compare(right.path().length(), left.path().length()));
            return matches;
        }
    }

    static Bundle checkpointContent(Object payload, String origin) {
        // Called only for a validated request. Keep the stream URL and headers out of saved state here.
        Object checkpoint = ((Map<?, ?>) payload).get("checkpoint");
        if (!(checkpoint instanceof Map<?, ?>)) return null;
        Map<?, ?> raw = (Map<?, ?>) checkpoint;
        Map<String, Object> metadata = new LinkedHashMap<>();
        for (String key : Arrays.asList("profile", "playlistId", "contentXtreamId", "contentType",
            "seriesXtreamId", "seasonNumber", "seasonGroup", "episodeNumber", "activitySessionId", "activityIdentity")) {
            if (raw.containsKey(key)) metadata.put(key, raw.get(key));
        }
        String content = Json.write(metadata);
        if (content.length() > 8192) return null;
        Bundle saved = new Bundle();
        saved.putString("origin", origin);
        saved.putString("content", content);
        return saved;
    }

    private static float volume(Object raw, float fallback) {
        if (!(raw instanceof Number)) return fallback;
        double value = ((Number) raw).doubleValue();
        return Double.isFinite(value) ? (float) Math.max(0, Math.min(1, value)) : fallback;
    }

    private static long positionMs(Object seconds) {
        if (!(seconds instanceof Number)) return 0;
        double value = ((Number) seconds).doubleValue();
        return Double.isFinite(value) && value > 0 && value <= Long.MAX_VALUE / 1000.0
            ? Math.round(value * 1000) : 0;
    }

    private static String text(Object value) {
        return value instanceof String ? (String) value : "";
    }
}
