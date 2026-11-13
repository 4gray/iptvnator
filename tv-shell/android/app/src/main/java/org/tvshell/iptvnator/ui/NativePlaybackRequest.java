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

import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;

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
        int sourceType = Util.inferContentType(Uri.parse(stream.toString()));
        if (sourceType != C.CONTENT_TYPE_HLS && sourceType != C.CONTENT_TYPE_OTHER) return null;
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
            .putExtra("hls", Boolean.TRUE.equals(request.get("hls")))
            .putExtra("live", Boolean.TRUE.equals(request.get("live")))
            .putExtra("captions", Boolean.TRUE.equals(request.get("captions")))
            .putExtra("position", positionMs(request.get("startTime")))
            .putExtra("volume", volume(request.get("volume")))
            .putExtra("headers", headers);
    }

    static OkHttpClient client(HttpUrl stream, Bundle headers) {
        if (headers == null || headers.isEmpty()) return HTTP;
        Headers.Builder builder = new Headers.Builder();
        for (String name : headers.keySet()) builder.set(name, headers.getString(name));
        Headers providerHeaders = builder.build();
        // The network interceptor runs for each redirect, segment and HLS key request.
        // Provider headers never become part of OkHttp's request for another origin.
        return HTTP.newBuilder().addNetworkInterceptor(chain -> {
            Request request = chain.request();
            HttpUrl target = request.url();
            boolean sameOrigin = stream.scheme().equals(target.scheme())
                && stream.host().equals(target.host()) && stream.port() == target.port();
            if (!sameOrigin) return chain.proceed(request);
            Request.Builder scoped = request.newBuilder();
            for (String name : providerHeaders.names()) {
                scoped.header(name, providerHeaders.get(name));
            }
            return chain.proceed(scoped.build());
        }).build();
    }

    static Bundle checkpointContent(Object payload, String origin) {
        // Called only for a validated request. Keep the stream URL and headers out of saved state here.
        Object checkpoint = ((Map<?, ?>) payload).get("checkpoint");
        if (!(checkpoint instanceof Map<?, ?>)) return null;
        String content = Json.write(checkpoint);
        if (content.length() > 8192) return null;
        Bundle saved = new Bundle();
        saved.putString("origin", origin);
        saved.putString("content", content);
        return saved;
    }

    private static float volume(Object raw) {
        if (!(raw instanceof Number)) return 1f;
        double value = ((Number) raw).doubleValue();
        return Double.isFinite(value) ? (float) Math.max(0, Math.min(1, value)) : 1f;
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
