package org.tvshell.iptvnator.ui;

import android.util.Log;
import android.webkit.JavascriptInterface;

import org.tvshell.iptvnator.ShellApp;

/**
 * {@code window.TvShell} inside the page. Every method is called from the
 * WebView's JavaScript thread; UI work is handed to the activity's main thread.
 */
public class TvShellBridge {

    private final MainActivity activity;

    TvShellBridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public void onReady(String url) {
        Log.i(ShellApp.TAG, "web app ready: " + url);
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.onWebAppReady();
            }
        });
    }

    @JavascriptInterface
    public void openExternal(final String url, final String title) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.openExternal(url, title);
            }
        });
    }

    /** The web app copied a stream URL: on a TV that means "play it elsewhere". */
    @JavascriptInterface
    public void onUrlCopied(final String url, final String title) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.offerExternal(url, title, false);
            }
        });
    }

    @JavascriptInterface
    public void onPlaybackError(final String url, final String title, final String code) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.offerExternal(url, title, true);
            }
        });
    }

    /** Something plays (or stopped): the screen stays on only during playback. */
    @JavascriptInterface
    public void setKeepScreenOn(final boolean on) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.setKeepScreenOn(on);
            }
        });
    }

    @JavascriptInterface
    public void exitApp() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.finishAffinity();
            }
        });
    }

    @JavascriptInterface
    public void showExitHint() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.showExitHint();
            }
        });
    }

    @JavascriptInterface
    public void toast(final String message) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.toast(message);
            }
        });
    }

    @JavascriptInterface
    public void showKeyboard() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.showKeyboard();
            }
        });
    }

    @JavascriptInterface
    public void openSettings() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.openSettings();
            }
        });
    }

    @JavascriptInterface
    public void log(String message) {
        Log.d(ShellApp.TAG, "[page] " + message);
    }
}
