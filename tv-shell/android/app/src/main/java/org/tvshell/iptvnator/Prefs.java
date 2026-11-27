package org.tvshell.iptvnator;

import android.app.UiModeManager;
import android.content.Context;
import android.content.res.Configuration;
import android.content.pm.PackageManager;
import android.content.SharedPreferences;

/** The shell's few settings. */
public class Prefs {

    public static final String NAME = "tvshell";
    public static final String KEY_LAYOUT_WIDTH = "layoutWidth";
    public static final String KEY_PROMPT_ON_ERROR = "promptExternalOnError";
    public static final String KEY_EXTERNAL_PLAYER = "externalPlayerPackage";
    public static final String KEY_SERVER_PORT = "serverPort";
    private static final String KEY_NATIVE_PLAYBACK = "native_playback";
    public static final String KEY_DEBUG = "webDebug";

    public static final int DEFAULT_LAYOUT_WIDTH = 1280;

    private final SharedPreferences prefs;

    public Prefs(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences(NAME, Context.MODE_PRIVATE);
    }

    public enum LayoutMode { AUTO, TOUCH, TV }

    public LayoutMode layoutMode() {
        try {
            return LayoutMode.valueOf(prefs.getString("layoutMode", LayoutMode.AUTO.name()));
        } catch (IllegalArgumentException e) {
            return LayoutMode.AUTO;
        }
    }

    public void setLayoutMode(LayoutMode mode) {
        prefs.edit().putString("layoutMode", mode.name()).apply();
    }

    /** Device type stays stable when the phone rotates or the window changes size. */
    public boolean useTvLayout(Context context) {
        return LayoutPolicy.useTvLayout(layoutMode().name(), isTvDevice(context),
            context.getResources().getConfiguration().screenWidthDp);
    }

    public static boolean isTvDevice(Context context) {
        UiModeManager ui = (UiModeManager) context.getSystemService(Context.UI_MODE_SERVICE);
        PackageManager pm = context.getPackageManager();
        return LayoutPolicy.isTvDevice(ui != null && ui.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION,
            pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK),
            pm.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN));
    }

    /** Empty selects the bundled local library and clears the server address. */
    public String hostedOrigin() { return prefs.getString("hostedOrigin", ""); }

    public String approvalOrigin() { return prefs.getString("approvalOrigin", ""); }

    public void setApprovalOrigin(String origin) { prefs.edit().putString("approvalOrigin", origin).apply(); }

    public boolean usesNasLibrary() { return prefs.getBoolean("nasLibrary", false); }

    public void setNasLibrary(String appBase) {
        prefs.edit().putString("hostedOrigin", appBase).putBoolean("nasLibrary", true).remove("savedHostedOrigin").apply();
    }

    public void setHostedOrigin(String origin) {
        prefs.edit().putString("hostedOrigin", origin).remove("nasLibrary").remove("savedHostedOrigin").apply();
    }

    /** CSS layout width used in TV mode. */
    public int layoutWidth() {
        return prefs.getInt(KEY_LAYOUT_WIDTH, DEFAULT_LAYOUT_WIDTH);
    }

    public void setLayoutWidth(int width) {
        prefs.edit().putInt(KEY_LAYOUT_WIDTH, width).apply();
    }

    public boolean nativePlayback() {
        return prefs.getBoolean(KEY_NATIVE_PLAYBACK, true);
    }

    public void setNativePlayback(boolean enabled) {
        prefs.edit().putBoolean(KEY_NATIVE_PLAYBACK, enabled).apply();
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
