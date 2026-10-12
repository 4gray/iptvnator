package org.tvshell.iptvnator.ui;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.webkit.ConsoleMessage;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.tvshell.iptvnator.Prefs;
import org.tvshell.iptvnator.R;
import org.tvshell.iptvnator.ShellApp;
import org.tvshell.iptvnator.server.TvShellServer;

/**
 * Full-screen WebView showing the bundled IPTVnator PWA from the embedded
 * server. Remote-control keys that the page cannot see as plain key events
 * (Back, Menu, media keys) are forwarded to the TV layer (tv.js).
 */
public class MainActivity extends Activity {

    private static final long LONG_PRESS_MS = 650;
    /** How long the web app may take to call TvShell.onReady() before the error panel explains the situation. */
    private static final long READY_TIMEOUT_MS = 30_000;
    /** Renderer deaths are counted across Activity recreations; a burst means the page itself is the problem. */
    private static final long RENDERER_DEATH_WINDOW_MS = 60_000;
    private static final int RENDERER_DEATH_LIMIT = 3;
    private static int rendererDeaths;
    private static long lastRendererDeathAt;

    private WebView webView;
    private FrameLayout root;
    private View splash;
    private View errorPanel;
    private TextView errorText;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private Prefs prefs;
    private TvShellServer server;
    private long menuDownAt;
    private boolean menuLongPressFired;
    private String lastOfferedUrl;
    private long lastOfferedAt;
    private AlertDialog externalDialog;
    private boolean resumed;
    private boolean pageReady;
    private int loadedLayoutWidth;
    private String lastConsoleError;
    private final Handler handler = new Handler(Looper.getMainLooper());
    /** Fires when the page never reported itself ready: a too-old WebView fails to parse the bundle silently. */
    private final Runnable readyWatchdog = new Runnable() {
        @Override
        public void run() {
            if (pageReady || errorPanel.getVisibility() == View.VISIBLE) return;
            String message = getString(R.string.load_timeout);
            if (lastConsoleError != null) message += "\n" + lastConsoleError;
            showError(message);
        }
    };

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = new Prefs(this);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_main);
        root = findViewById(R.id.root);
        webView = findViewById(R.id.webview);
        splash = findViewById(R.id.splash);
        errorPanel = findViewById(R.id.error_panel);
        errorText = findViewById(R.id.error_text);
        Button retry = findViewById(R.id.error_retry);
        Button settings = findViewById(R.id.error_settings);
        retry.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                load();
            }
        });
        settings.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openSettings();
            }
        });

        WebView.setWebContentsDebuggingEnabled(prefs.webDebug() || isDebugBuild());
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setUserAgentString(s.getUserAgentString() + " IPTVnatorTVShell/" + versionName());
        webView.setBackgroundColor(Color.BLACK);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.addJavascriptInterface(new TvShellBridge(this), "TvShell");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (server != null && uri.toString().startsWith(server.baseUrl())) return false;
                // Outside links (YouTube trailers, provider sites): hand http(s) to the system, the
                // same allowlist as the Electron shell. Any other scheme stays inside the shell.
                String scheme = uri.getScheme();
                if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
                    Log.w(ShellApp.TAG, "blocked navigation to scheme " + scheme);
                    return true;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (RuntimeException e) {
                    toast(getString(R.string.cannot_open_link));
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showError(getString(R.string.load_error, String.valueOf(error.getDescription()), String.valueOf(error.getErrorCode())));
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                view.requestFocus(View.FOCUS_DOWN);
            }

            /** The sandboxed renderer died (OOM abort or system kill). Unhandled, Chromium crashes or kills the app. */
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                boolean crashed = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && detail.didCrash();
                long now = SystemClock.uptimeMillis();
                rendererDeaths = now - lastRendererDeathAt < RENDERER_DEATH_WINDOW_MS ? rendererDeaths + 1 : 1;
                lastRendererDeathAt = now;
                Log.w(ShellApp.TAG, "web renderer gone (crashed=" + crashed + ", count=" + rendererDeaths + ")");
                handler.removeCallbacks(readyWatchdog);
                root.removeView(view);
                view.destroy();
                webView = null; // every remaining use is null-guarded
                if (resumed) {
                    toast(getString(R.string.renderer_restarted));
                    recreate(); // new Activity + WebView; ShellApp keeps the server
                }
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                    lastConsoleError = message.message() + " (" + message.sourceId() + ":" + message.lineNumber() + ")";
                    Log.w(ShellApp.TAG, "[console] " + lastConsoleError);
                    // A bundle this engine cannot parse: show the diagnostics now rather than after the timeout.
                    if (!pageReady && message.message().startsWith("Uncaught SyntaxError")) {
                        handler.removeCallbacks(readyWatchdog);
                        readyWatchdog.run();
                    }
                }
                return false;
            }

            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customViewCallback = callback;
                root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                webView.setVisibility(View.GONE);
                view.setFocusable(true);
                view.requestFocus();
            }

            @Override
            public void onHideCustomView() {
                if (customView == null) return;
                root.removeView(customView);
                customView = null;
                webView.setVisibility(View.VISIBLE);
                webView.requestFocus(View.FOCUS_DOWN);
                if (customViewCallback != null) customViewCallback.onCustomViewHidden();
                customViewCallback = null;
            }
        });

        if (rendererDeaths >= RENDERER_DEATH_LIMIT && SystemClock.uptimeMillis() - lastRendererDeathAt < RENDERER_DEATH_WINDOW_MS) {
            rendererDeaths = 0;
            server = ShellApp.currentServer(); // so the diagnostics show the port
            showError(getString(R.string.renderer_gone_loop));
        } else {
            load();
        }
    }

    private boolean isDebugBuild() {
        return (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (RuntimeException | android.content.pm.PackageManager.NameNotFoundException e) {
            return "0";
        }
    }

    private void load() {
        if (webView == null) {
            recreate();
            return;
        }
        errorPanel.setVisibility(View.GONE);
        splash.setVisibility(View.VISIBLE);
        pageReady = false;
        lastConsoleError = null;
        handler.removeCallbacks(readyWatchdog);
        server = ((ShellApp) getApplication()).ensureServer();
        if (server == null) {
            showError(getString(R.string.server_error));
            return;
        }
        loadedLayoutWidth = prefs.layoutWidth();
        server.setLayoutWidth(loadedLayoutWidth);
        server.setScreenWidth(screenCssWidth(this));
        webView.setVisibility(View.VISIBLE);
        webView.loadUrl(server.baseUrl());
        webView.requestFocus(View.FOCUS_DOWN);
        handler.postDelayed(readyWatchdog, READY_TIMEOUT_MS);
    }

    private void showError(String message) {
        splash.setVisibility(View.GONE);
        errorText.setText(message + "\n\n" + diagnostics());
        errorPanel.setVisibility(View.VISIBLE);
        errorPanel.findViewById(R.id.error_retry).requestFocus();
    }

    /** Screen width in CSS px at scale 1 (Android dp): 960 on a 1080p Fire TV. */
    static int screenCssWidth(android.content.Context context) {
        DisplayMetrics dm = context.getResources().getDisplayMetrics();
        return dm.density > 0 ? Math.round(dm.widthPixels / dm.density) : 0;
    }

    /** "1920×1080 px, density 2.0 → 960 px CSS" for the diagnostics. */
    static String screenInfo(android.content.Context context) {
        DisplayMetrics dm = context.getResources().getDisplayMetrics();
        return dm.widthPixels + "\u00d7" + dm.heightPixels + " px, density " + dm.density + " \u2192 " + screenCssWidth(context) + " px CSS";
    }

    String diagnostics() {
        String ua = WebSettings.getDefaultUserAgent(this);
        String chrome = "?";
        int at = ua.indexOf("Chrome/");
        if (at >= 0) {
            int end = ua.indexOf(' ', at);
            chrome = ua.substring(at + 7, end > 0 ? end : ua.length());
        }
        String webViewPackage = "";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            android.content.pm.PackageInfo info = WebView.getCurrentWebViewPackage();
            if (info != null) webViewPackage = info.packageName + " " + info.versionName;
        }
        return getString(R.string.diagnostics, chrome, webViewPackage, Build.MODEL, Build.VERSION.RELEASE,
            server == null ? "-" : String.valueOf(server.port()), screenInfo(this) + ", layout " + loadedLayoutWidth);
    }

    // ------------------------------------------------------------- keys
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        int action = event.getAction();
        if (customView == null && errorPanel.getVisibility() == View.VISIBLE) {
            return super.dispatchKeyEvent(event);
        }
        switch (code) {
            case KeyEvent.KEYCODE_BACK:
                if (action == KeyEvent.ACTION_UP) handleBack();
                return true;
            case KeyEvent.KEYCODE_MENU:
                if (action == KeyEvent.ACTION_DOWN) {
                    if (event.getRepeatCount() == 0) {
                        menuDownAt = SystemClock.uptimeMillis();
                        menuLongPressFired = false;
                    } else if (!menuLongPressFired && SystemClock.uptimeMillis() - menuDownAt >= LONG_PRESS_MS) {
                        menuLongPressFired = true;
                        openSettings();
                    }
                } else if (action == KeyEvent.ACTION_UP) {
                    if (!menuLongPressFired) js("window.__tvShell && window.__tvShell.menu()");
                    menuLongPressFired = false;
                }
                return true;
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_HEADSETHOOK:
                if (action == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) media("playpause");
                return true;
            case KeyEvent.KEYCODE_MEDIA_PLAY:
                if (action == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) media("play");
                return true;
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
                if (action == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) media("pause");
                return true;
            case KeyEvent.KEYCODE_MEDIA_STOP:
                if (action == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) media("stop");
                return true;
            case KeyEvent.KEYCODE_MEDIA_REWIND:
                if (action == KeyEvent.ACTION_DOWN) media("rewind");
                return true;
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
                if (action == KeyEvent.ACTION_DOWN) media("fastforward");
                return true;
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
                // A held OK is one activation. The WebView turns every Android key repeat into a fresh
                // Enter keydown + keypress with KeyboardEvent.repeat === false, so the page cannot filter
                // repeats itself; drop them here like the media keys above. D-pad repeats stay (hold to scroll).
                if (action == KeyEvent.ACTION_DOWN && event.getRepeatCount() > 0) return true;
                return super.dispatchKeyEvent(event);
            default:
                return super.dispatchKeyEvent(event);
        }
    }

    private void handleBack() {
        if (customView != null) {
            // Leaving fullscreen video is handled by the page (document.exitFullscreen).
            js("window.__tvShell ? window.__tvShell.back() : (document.fullscreenElement && document.exitFullscreen(), true)");
            return;
        }
        if (!pageReady || webView == null || webView.getVisibility() != View.VISIBLE) {
            finishAffinity();
            return;
        }
        js("window.__tvShell ? window.__tvShell.back() : (history.length > 1 ? (history.back(), true) : false)");
    }

    private void media(String action) {
        js("window.__tvShell && window.__tvShell.media('" + action + "')");
    }

    private void js(String script) {
        if (webView == null) return;
        webView.evaluateJavascript(script, null);
    }

    // --------------------------------------------------------- callbacks
    void onWebAppReady() {
        pageReady = true;
        handler.removeCallbacks(readyWatchdog);
        splash.setVisibility(View.GONE);
        errorPanel.setVisibility(View.GONE);
        if (webView != null) webView.requestFocus(View.FOCUS_DOWN);
    }

    void openExternal(String url, String title) {
        ExternalPlayer.open(this, url, title, prefs.externalPlayerPackage());
    }

    /**
     * Ask before leaving the app for a stream, unless the user said not to. One dialog at a time; the
     * same URL is not offered again within a few seconds (a copy followed by the error of the same
     * stream, or the player's error burst), but a later attempt on the channel asks again.
     */
    void offerExternal(final String url, final String title, boolean becauseOfError) {
        if (url == null || url.isEmpty() || webView == null || isFinishing()) return;
        if (becauseOfError && !prefs.promptExternalOnError()) return;
        if (externalDialog != null && externalDialog.isShowing()) return;
        long now = SystemClock.uptimeMillis();
        if (becauseOfError && url.equals(lastOfferedUrl) && now - lastOfferedAt < 5_000) return;
        lastOfferedUrl = url;
        lastOfferedAt = now;
        externalDialog = new AlertDialog.Builder(this)
            .setTitle(becauseOfError ? R.string.external_prompt_title_error : R.string.external_prompt_title)
            .setMessage(getString(R.string.external_prompt_message, title == null || title.isEmpty() ? url : title))
            .setPositiveButton(R.string.external_prompt_open, new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface dialog, int which) {
                    openExternal(url, title);
                }
            })
            .setNegativeButton(R.string.external_prompt_cancel, null)
            .setOnDismissListener(new DialogInterface.OnDismissListener() {
                @Override
                public void onDismiss(DialogInterface dialog) {
                    externalDialog = null;
                    if (webView != null) webView.requestFocus(View.FOCUS_DOWN);
                }
            })
            .show();
    }

    void showExitHint() {
        toast(getString(R.string.press_back_again));
    }

    void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    void showKeyboard() {
        if (webView == null || isFinishing()) return;
        webView.requestFocus(View.FOCUS_DOWN);
        InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (imm != null) imm.showSoftInput(webView, InputMethodManager.SHOW_IMPLICIT);
    }

    void openSettings() {
        startActivity(new Intent(this, SettingsActivity.class));
    }

    // ---------------------------------------------------------- lifecycle
    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        hideSystemUi();
        if (webView == null) {
            recreate(); // the renderer died while we were in the background
            return;
        }
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
            webView.requestFocus(View.FOCUS_DOWN);
        }
        if (SettingsActivity.dataCleared) {
            SettingsActivity.dataCleared = false;
            if (webView != null) webView.clearCache(true);
            load();
        } else if (server != null && prefs.layoutWidth() != loadedLayoutWidth) {
            load();
        }
    }

    @Override
    protected void onPause() {
        resumed = false;
        if (webView != null) {
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(readyWatchdog);
        if (webView != null) {
            webView.loadUrl("about:blank");
            root.removeView(webView); // destroy() must not run on an attached WebView
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private void hideSystemUi() {
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }
}
