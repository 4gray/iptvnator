package org.tvshell.iptvnator.ui;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.tvshell.iptvnator.ShellApp;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/** Only resume metadata is retained. A newer result replaces the previous result for the same item. */
final class NativePlaybackCheckpoints {
    private final SharedPreferences storage;

    NativePlaybackCheckpoints(Context context) {
        storage = context.getSharedPreferences("native_playback_checkpoints", Context.MODE_PRIVATE);
    }

    void saveResult(Bundle content, String id, Intent result) {
        if (content == null || id == null || result == null) return;
        long position = result.getLongExtra("position", 0);
        long duration = result.getLongExtra("duration", 0);
        if (position <= 0 && duration <= 0) return;
        Bundle checkpoint = new Bundle(content);
        checkpoint.putString("id", id);
        checkpoint.putLong("position", position);
        checkpoint.putLong("duration", duration);
        checkpoint.putLong("savedAt", result.getLongExtra("savedAt", System.currentTimeMillis()));
        save(checkpoint);
    }

    void save(Bundle checkpoint) {
        try {
            JSONObject content = new JSONObject(checkpoint.getString("content", ""));
            String origin = checkpoint.getString("origin");
            String key = new JSONArray()
                .put(origin).put(content.getString("profile")).put(content.getString("playlistId"))
                .put(content.getString("contentType")).put(content.getLong("contentXtreamId")).toString();
            JSONObject previous = read(storage.getString(key, null));
            long savedAt = checkpoint.getLong("savedAt");
            if (previous != null && previous.optLong("savedAt") >= savedAt) return;

            JSONObject entry = new JSONObject()
                .put("id", checkpoint.getString("id")).put("origin", origin)
                .put("content", content.toString()).put("positionMs", checkpoint.getLong("position"))
                .put("durationMs", checkpoint.getLong("duration")).put("savedAt", savedAt);
            // Checkpoint the finished session before the WebView sees it. A process
            // killed immediately after a failed WebView write must still be able to retry.
            if (!storage.edit().putString(key, entry.toString()).commit()) {
                Log.w(ShellApp.TAG, "Could not persist native playback checkpoint");
            }
        } catch (JSONException ignored) {
            // Invalid resume metadata cannot be recovered by the web player.
        }
    }

    List<JSONObject> forOrigin(String origin) {
        List<JSONObject> checkpoints = new ArrayList<>();
        for (Object value : storage.getAll().values()) {
            JSONObject entry = read(value);
            if (entry != null && origin.equals(entry.optString("origin"))) checkpoints.add(entry);
        }
        checkpoints.sort(Comparator.comparingLong((JSONObject entry) -> entry.optLong("savedAt")).reversed());
        return checkpoints;
    }

    void acknowledge(String origin, String id) {
        for (Map.Entry<String, ?> row : storage.getAll().entrySet()) {
            JSONObject entry = read(row.getValue());
            if (entry != null && id.equals(entry.optString("id")) && origin.equals(entry.optString("origin"))) {
                // The WebView may delete its reset guards when the durable queue is empty.
                if (!storage.edit().remove(row.getKey()).commit())
                    storage.edit().putString(row.getKey(), (String) row.getValue()).apply();
                return;
            }
        }
    }

    boolean isEmpty() {
        return storage.getAll().isEmpty();
    }

    void clear() {
        storage.edit().clear().apply();
    }

    private static JSONObject read(Object raw) {
        if (!(raw instanceof String)) return null;
        try {
            return new JSONObject((String) raw);
        } catch (JSONException ignored) {
            return null;
        }
    }
}
