package org.tvshell.iptvnator.ui;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import okhttp3.Headers;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;

final class NativePlaybackRequest {
    private static final List<String> PROVIDER_HEADERS = Arrays.asList(
        "accept", "authorization", "cookie", "origin", "referer", "sn", "user-agent", "x-user-agent");
    private static final OkHttpClient HTTP = new OkHttpClient();

    private NativePlaybackRequest() {}

    static Intent toIntent(Context context, Object payload) {
        if (!(payload instanceof Map<?, ?>)) return null;
        Map<?, ?> request = (Map<?, ?>) payload;
        String url = text(request.get("url"));
        HttpUrl stream = HttpUrl.parse(url);
        if (stream == null || !stream.username().isEmpty() || !stream.password().isEmpty()
            || stream.encodedPath().toLowerCase(Locale.ROOT).endsWith(".mpd")) return null;
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
            Request.Builder scoped = request.newBuilder();
            for (String name : providerHeaders.names()) {
                if (sameOrigin) scoped.header(name, providerHeaders.get(name));
                else scoped.removeHeader(name);
            }
            return chain.proceed(scoped.build());
        }).build();
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
