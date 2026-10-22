package org.tvshell.iptvnator;

import android.content.Context;
import android.content.SharedPreferences;

/** The shell's few settings. */
public class Prefs {

    public static final String NAME = "tvshell";
    public static final String KEY_LAYOUT_WIDTH = "layoutWidth";
    public static final String KEY_PROMPT_ON_ERROR = "promptExternalOnError";
    public static final String KEY_EXTERNAL_PLAYER = "externalPlayerPackage";
    public static final String KEY_SERVER_PORT = "serverPort";
    public static final String KEY_DEBUG = "webDebug";

    public static final int DEFAULT_LAYOUT_WIDTH = 1280;

    private final SharedPreferences prefs;

    public Prefs(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences(NAME, Context.MODE_PRIVATE);
    }

    /** CSS layout width of the web app (960 = big & phone-like, 1280 = desktop, 1600 = dense). */
    public int layoutWidth() {
        return prefs.getInt(KEY_LAYOUT_WIDTH, DEFAULT_LAYOUT_WIDTH);
    }

    public void setLayoutWidth(int width) {
        prefs.edit().putInt(KEY_LAYOUT_WIDTH, width).apply();
    }

    /** Offer the external player when the browser player cannot play a stream. */
    public boolean promptExternalOnError() {
        return prefs.getBoolean(KEY_PROMPT_ON_ERROR, true);
    }

    public void setPromptExternalOnError(boolean value) {
        prefs.edit().putBoolean(KEY_PROMPT_ON_ERROR, value).apply();
    }

    /** Package name of the preferred external player, or null for the system chooser. */
    public String externalPlayerPackage() {
        String value = prefs.getString(KEY_EXTERNAL_PLAYER, null);
        return value == null || value.isEmpty() ? null : value;
    }

    public void setExternalPlayerPackage(String packageName) {
        prefs.edit().putString(KEY_EXTERNAL_PLAYER, packageName == null ? "" : packageName).apply();
    }

    public int serverPort() {
        return prefs.getInt(KEY_SERVER_PORT, 43330);
    }

    /** False until the first server start persisted the port the web app's storage belongs to. */
    public boolean hasServerPort() {
        return prefs.contains(KEY_SERVER_PORT);
    }

    public void setServerPort(int port) {
        prefs.edit().putInt(KEY_SERVER_PORT, port).apply();
    }

    /** Remote debugging of the WebView (chrome://inspect over ADB). */
    public boolean webDebug() {
        return prefs.getBoolean(KEY_DEBUG, false);
    }

    public void setWebDebug(boolean value) {
        prefs.edit().putBoolean(KEY_DEBUG, value).apply();
    }
}
