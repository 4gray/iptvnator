package org.tvshell.iptvnator.ui;

import android.util.Log;

import org.tvshell.iptvnator.ShellApp;
import org.tvshell.iptvnator.backend.Json;

import java.util.List;

/** Dispatches messages from the trusted main frame on the UI thread. */
final class TvShellBridge {
    private final MainActivity activity;

    TvShellBridge(MainActivity activity) {
        this.activity = activity;
    }

    void receive(String message) {
        if (message == null || message.length() > 64 * 1024) return;
        Object parsed;
        try {
            parsed = Json.parse(message);
        } catch (Json.JsonException | NumberFormatException ignored) {
            return;
        }
        if (!(parsed instanceof List<?>)) return;
        List<?> args = (List<?>) parsed;
        String command = stringAt(args, 0);
        if (command == null) return;
        switch (command) {
            case "onReady":
                Log.i(ShellApp.TAG, "web app ready");
                activity.onWebAppReady();
                break;
            case "openExternal":
            case "onUrlCopied":
            case "onPlaybackError":
                String url = stringAt(args, 1);
                String title = stringAt(args, 2);
                if (url == null || title == null) return;
                if (command.equals("openExternal")) activity.openExternal(url, title);
                else activity.offerExternal(url, title, command.equals("onPlaybackError"));
                break;
            case "setKeepScreenOn":
                if (args.size() > 1 && args.get(1) instanceof Boolean) {
                    activity.setKeepScreenOn((Boolean) args.get(1));
                }
                break;
            case "exitApp":
                activity.finishAffinity();
                break;
            case "showExitHint":
                activity.showExitHint();
                break;
            case "toast":
                String text = stringAt(args, 1);
                if (text != null) activity.toast(text);
                break;
            case "showKeyboard":
                activity.showKeyboard();
                break;
            case "openSettings":
                activity.openSettings();
                break;
        }
    }

    private static String stringAt(List<?> args, int index) {
        return index < args.size() && args.get(index) instanceof String ? (String) args.get(index) : null;
    }
}
