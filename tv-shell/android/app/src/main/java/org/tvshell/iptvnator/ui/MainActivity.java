package org.tvshell.iptvnator.ui;

import android.annotation.SuppressLint;
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
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ValueCallback;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.activity.ComponentActivity;

import androidx.webkit.WebMessageCompat;
import androidx.webkit.ScriptHandler;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;
import org.tvshell.iptvnator.Prefs;
import org.tvshell.iptvnator.R;
import org.tvshell.iptvnator.ShellApp;
import org.tvshell.iptvnator.backend.DiagnosticRedactor;
import org.tvshell.iptvnator.backend.ShellSite;
import org.tvshell.iptvnator.server.TvShellServer;

import java.util.Collections;

/**
 * Full-screen WebView showing the bundled IPTVnator PWA from the embedded
 * server. Remote-control keys that the page cannot see as plain key events
 * (Back, Menu, media keys) are forwarded to the TV layer (tv.js).
 */
public class MainActivity extends ComponentActivity {

    private static final long LONG_PRESS_MS = 650;
    /**
     * How long the web app may take to report readiness before the error panel explains the
     * situation; doubled once while the page is still being fetched (a cold start on a slow stick
     * right after an update parses the whole bundle again).
     */
    private static final long READY_TIMEOUT_MS = 30_000;
    private static final long HOSTED_READY_TIMEOUT_MS = 8_000;
    /** A main-frame load error from the loopback server is retried once, after the server is restarted. */
    private static final long LOAD_RETRY_DELAY_MS = 1_200;
    /** Renderer deaths are counted across Activity recreations; a burst means the page itself is the problem. */
    private static final long RENDERER_DEATH_WINDOW_MS = 60_000;
    private static final int RENDERER_DEATH_LIMIT = 3;
    private static final String STATE_URL = "url";
    private static int rendererDeaths;
    private static long lastRendererDeathAt;

    private WebView webView;
    private String bridgeOrigin;
    private String loadedConnection;
    private String offlineOrigin;
    private final HostedAccessFlow accessFlow = new HostedAccessFlow(this);
    private volatile HostedAccessSession accessSession;
    private volatile TvShellServer bundledAccessSite;
    private HostedAccessBridge accessBridge;

    private String effectiveLibraryOrigin() {
        String preferred = prefs.hostedOrigin();
        return preferred.equals(offlineOrigin) ? "" : preferred;
    }
    private String activeOrigin;
    private ScriptHandler shellScript;
    private final WebFileChooser fileChooser = new WebFileChooser(this);
    private HostedPairingFlow pairing;
    private LibraryQrScanner libraryQrScanner;
    private final PairingAttempts connectionAttempts = new PairingAttempts();
    private AlertDialog connectionDialog;
    private FrameLayout root;
    private Button touchSettings;
    private TouchWindowInsets touchWindowInsets;
    private boolean tvDevice;
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
    private boolean pageFinished;
    private boolean watchdogExtended;
    private boolean loadRetried;
    private boolean webViewUnavailable;
    private int loadedLayoutWidth;
    private int loadedScreenWidth;
    private String restoreUrl;
    /** The route at the last pause, for the relaunch after the system reclaimed the hidden renderer. */
    private String lastRoute;
    private long backDownAt;
    private boolean backLongPressFired;
    private String lastConsoleError;
    private final Handler handler = new Handler(Looper.getMainLooper());
    /** Fires when the page never reported itself ready: a too-old WebView fails to parse the bundle silently. */
    private final Runnable readyWatchdog = new Runnable() {
        @Override
        public void run() {
            if (pageReady || errorPanel.getVisibility() == View.VISIBLE) return;
            if (fallbackToLocalLibrary()) return;
            if (!pageFinished && !watchdogExtended) {
                // Still fetching and parsing: slow, not broken. One more period before giving up.
                watchdogExtended = true;
                Log.i(ShellApp.TAG, "page still loading after " + READY_TIMEOUT_MS + " ms, waiting once more");
                handler.postDelayed(this, READY_TIMEOUT_MS);
                return;
            }
            showLoadTimeout();
        }
    };
    /** The one retry of a main-frame load the loopback server did not answer. */
    private final Runnable loadRetry = new Runnable() {
        @Override
        public void run() {
            if (!isFinishing() && !isDestroyed() && !pageReady) load();
        }
    };

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = new Prefs(this);
        pairing = new HostedPairingFlow(this);
        libraryQrScanner = new LibraryQrScanner(this, prefs, pairing);
        if (savedInstanceState != null) restoreUrl = savedInstanceState.getString(STATE_URL);
        setContentView(R.layout.activity_main);
        root = findViewById(R.id.root);
        tvDevice = Prefs.isTvDevice(this);
        touchWindowInsets = new TouchWindowInsets(this, root);
        touchSettings = findViewById(R.id.touch_settings);
        touchSettings.setOnClickListener(view -> openSettings());
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

        // The WebView is created in code, not inflated: when the system WebView is missing, disabled
        // or being updated (Amazon WebView updates in the background), its constructor throws an
        // AndroidRuntimeException, which from the inflater would kill the app before any message.
        try {
            webView = new WebView(this);
            WebView.setWebContentsDebuggingEnabled(prefs.webDebug() || isDebugBuild());
        } catch (RuntimeException e) {
            Log.e(ShellApp.TAG, "WebView unavailable", e);
            webView = null;
            webViewUnavailable = true;
            server = ShellApp.currentServer();
            loadedLayoutWidth = selectedLayoutWidth();
            showError(getString(R.string.webview_unavailable) + "\n" + e);
            return;
        }
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        root.addView(webView, 0, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setUserAgentString(s.getUserAgentString() + " IPTVnator/" + versionName());
        webView.setBackgroundColor(Color.BLACK);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                TvShellServer site = bundledAccessSite;
                if (site != null && HostedOrigin.sameOrigin(activeOrigin, request.getUrl().toString())) {
                    String path = request.getUrl().getEncodedPath();
                    return site.bundledResource(path != null && path.startsWith("/api/") ? "/ngsw.json" : path);
                }
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri uri = request.getUrl();
                if (activeOrigin != null && HostedOrigin.sameOrigin(activeOrigin, uri.toString())) return false;
                // Redirects never grant a new origin access to the shell or open a browser implicitly.
                if (request.isRedirect() || !request.hasGesture()) return true;
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
                if (!request.isForMainFrame()) return;
                int code = error.getErrorCode();
                boolean serverUnreachable = code == ERROR_CONNECT || code == ERROR_HOST_LOOKUP || code == ERROR_TIMEOUT
                    || code == ERROR_IO || code == ERROR_FAILED_SSL_HANDSHAKE;
                if (!HostedOrigin.sameOrigin(activeOrigin, request.getUrl().toString())) return;
                if (serverUnreachable && fallbackToLocalLibrary()) return;
                if (serverUnreachable && !loadRetried) {
                    // The embedded server was not answering (its thread died while the app sat in the
                    // background, or the process was restored before it listened): load() restarts it.
                    loadRetried = true;
                    Log.w(ShellApp.TAG, "main frame load failed (" + code + "), restarting the server and retrying once");
                    handler.removeCallbacks(loadRetry);
                    handler.postDelayed(loadRetry, LOAD_RETRY_DELAY_MS);
                    return;
                }
                showError(getString(R.string.load_error, String.valueOf(error.getDescription()), String.valueOf(code)));
            }

            /** The server answered the page itself with an error (the bundle missing from the APK, out of memory). */
            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                if (!request.isForMainFrame()) return;
                if (!HostedOrigin.sameOrigin(activeOrigin, request.getUrl().toString())) return;
                if (errorResponse.getStatusCode() >= 500 && fallbackToLocalLibrary()) return;
                showError(getString(R.string.load_error, String.valueOf(errorResponse.getReasonPhrase()), String.valueOf(errorResponse.getStatusCode())));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                boolean first = !pageFinished;
                pageFinished = true;
                if (!resumed) js("window.__tvShell && typeof window.__tvShell.setForeground === 'function' && window.__tvShell.setForeground(false)");
                if (first && !pageReady && errorPanel.getVisibility() != View.VISIBLE
                        && (loadedConnection == null || loadedConnection.isEmpty())) {
                    // The bundle has run: Angular's bootstrap (IndexedDB, playlists) gets a period of its own.
                    armWatchdog();
                }
                // Never take the focus away from the error panel (an error page commits after onReceivedError).
                if (loadedLayoutWidth != ShellSite.DEVICE_VIEWPORT && errorPanel.getVisibility() != View.VISIBLE) {
                    view.requestFocus(View.FOCUS_DOWN);
                }
            }

            /** The sandboxed renderer died (OOM abort or system kill). Unhandled, Chromium crashes or kills the app. */
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                fileChooser.cancel();
                boolean crashed = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && detail.didCrash();
                long now = SystemClock.uptimeMillis();
                if (crashed || resumed) {
                    // The system reclaiming the hidden renderer while another app (VLC, the launcher) is in
                    // front is routine on a 1 GB device, not a sign that the page is broken: not counted.
                    rendererDeaths = now - lastRendererDeathAt < RENDERER_DEATH_WINDOW_MS ? rendererDeaths + 1 : 1;
                    lastRendererDeathAt = now;
                }
                Log.w(ShellApp.TAG, "web renderer gone (crashed=" + crashed + ", resumed=" + resumed + ", count=" + rendererDeaths + ")");
                if (resumed) lastRoute = null; // a death in front reloads the start view
                handler.removeCallbacks(readyWatchdog);
                handler.removeCallbacks(loadRetry);
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
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (activeOrigin == null || !HostedOrigin.sameOrigin(activeOrigin, view.getUrl())) {
                    callback.onReceiveValue(null);
                    return true;
                }
                return fileChooser.show(callback, params);
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                    lastConsoleError = DiagnosticRedactor.redact(message.message() + " (" + message.sourceId() + ":" + message.lineNumber() + ")");
                    Log.w(ShellApp.TAG, "[console] " + lastConsoleError);
                    // A bundle this engine cannot parse: show the diagnostics now rather than after the timeout.
                    if (!pageReady && message.message().startsWith("Uncaught SyntaxError")) {
                        handler.removeCallbacks(readyWatchdog);
                        showLoadTimeout();
                    }
                }
                // Handled here: do not delegate the original, unsanitized message to WebView.
                return true;
            }

            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customViewCallback = callback;
                updatePresentation();
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
                updatePresentation();
                webView.setVisibility(View.VISIBLE);
                webView.requestFocus(View.FOCUS_DOWN);
                if (customViewCallback != null) customViewCallback.onCustomViewHidden();
                customViewCallback = null;
            }
        });

        if (rendererDeaths >= RENDERER_DEATH_LIMIT && SystemClock.uptimeMillis() - lastRendererDeathAt < RENDERER_DEATH_WINDOW_MS) {
            rendererDeaths = 0;
            server = ShellApp.currentServer(); // so the diagnostics show the port
            loadedLayoutWidth = selectedLayoutWidth(); // and the layout; also keeps onResume() from reloading over the panel
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
        pageFinished = false;
        watchdogExtended = false;
        lastConsoleError = null;
        handler.removeCallbacks(readyWatchdog);
        handler.removeCallbacks(loadRetry);
        setKeepScreenOn(true); // through the splash; the page then reports its playback state
        loadedLayoutWidth = selectedLayoutWidth();
        loadedScreenWidth = screenCssWidth(this);
        boolean tvLayout = loadedLayoutWidth != ShellSite.DEVICE_VIEWPORT;
        webView.getSettings().setUseWideViewPort(tvLayout);
        webView.getSettings().setLoadWithOverviewMode(tvLayout);
        webView.setInitialScale(0);
        updatePresentation();
        loadedConnection = effectiveLibraryOrigin();
        accessSession = HostedAccessSession.load(this, loadedConnection);
        server = loadedConnection.isEmpty() || accessSession != null ? ((ShellApp) getApplication()).ensureServer() : null;
        bundledAccessSite = accessSession != null ? server : null;
        if (server == null && (loadedConnection.isEmpty() || accessSession != null)) {
            showError(getString(R.string.server_error));
            return;
        }
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
            || (!loadedConnection.isEmpty() && !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT))) {
            showError(getString(loadedConnection.isEmpty() ? R.string.webview_bridge_unavailable : R.string.hosted_webview_upgrade));
            return;
        }
        activeOrigin = accessSession != null ? accessUiOrigin(accessSession)
            : loadedConnection.isEmpty() ? "http://127.0.0.1:" + server.port() : loadedConnection;
        try {
            bindBridge(activeOrigin, !loadedConnection.isEmpty());
        } catch (IOException | RuntimeException e) {
            showError(getString(R.string.hosted_webview_upgrade));
            return;
        }
        if (server != null) {
            if (loadedConnection.isEmpty() && ShellApp.onFallbackPort()) toast(getString(R.string.port_fallback, prefs.serverPort(), server.port()));
            server.setLayoutWidth(loadedLayoutWidth);
            server.setScreenWidth(loadedScreenWidth);
        }
        String defaultPath = !tvDevice && loadedConnection.isEmpty() && offlineOrigin != null
            ? "/workspace/settings/server" : "/";
        String url = restoreUrl != null && HostedOrigin.sameOrigin(activeOrigin, restoreUrl)
            ? restoreUrl : activeOrigin + defaultPath;
        restoreUrl = null;
        webView.setVisibility(View.VISIBLE);
        webView.loadUrl(url);
        if (loadedLayoutWidth != ShellSite.DEVICE_VIEWPORT) webView.requestFocus(View.FOCUS_DOWN);
        armWatchdog();
    }

    private void bindBridge(String origin, boolean hosted) throws IOException {
        if (accessBridge != null) {
            accessBridge.close();
            accessBridge = null;
            WebViewCompat.removeWebMessageListener(webView, "HostedAccessApi");
        }
        if (bridgeOrigin != null) {
            WebViewCompat.removeWebMessageListener(webView, "TvShell");
            WebViewCompat.removeWebMessageListener(webView, "HostedPairing");
        }
        if (shellScript != null) { shellScript.remove(); shellScript = null; }
        bridgeOrigin = origin;
        TvShellBridge bridge = new TvShellBridge(this);
        WebViewCompat.addWebMessageListener(webView, "TvShell", Collections.singleton(origin),
            (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                if (view == webView && isMainFrame && origin.equals(bridgeOrigin)
                    && HostedOrigin.sameOrigin(origin, sourceOrigin.toString())
                    && message.getType() == WebMessageCompat.TYPE_STRING) {
                    bridge.receive(message.getData());
                }
            });
        if (accessSession != null) {
            accessBridge = new HostedAccessBridge(this, webView, origin, accessSession);
            String bootstrap;
            try (InputStream input = getAssets().open("tvshell/hosted-access-api.js");
                 ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096];
                int count;
                while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
                bootstrap = bytes.toString("UTF-8");
            }
            shellScript = WebViewCompat.addDocumentStartJavaScript(webView,
                "if (window === window.top) {\n" + libraryConnectionScript(true)
                    + "window.__iptvnatorHostedAccessInstance=" + JSONObject.quote(accessSession.instance)
                    + ";\n" + bootstrap + "\n}", Collections.singleton(origin));
        } else if (hosted) {
            PairedCredentialStore credentials = new PairedCredentialStore(this);
            if (credentials.contains(origin)) {
                WebViewCompat.addWebMessageListener(webView, "HostedPairing", Collections.singleton(origin),
                    (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                        if (view != webView || !isMainFrame || !origin.equals(bridgeOrigin)
                            || !origin.equals(prefs.hostedOrigin())
                            || !HostedOrigin.sameOrigin(origin, sourceOrigin.toString())
                            || message.getType() != WebMessageCompat.TYPE_STRING) return;
                        try {
                            String data = message.getData();
                            if (data == null || data.length() > 1024) return;
                            org.json.JSONObject request = new org.json.JSONObject(data);
                            String instance = request.optString("instanceId", "");
                            if (instance.isEmpty() || instance.length() > 200) return;
                            if ("forget".equals(request.optString("action"))) {
                                boolean forgotten = credentials.forget(origin, instance);
                                replyProxy.postMessage(new org.json.JSONObject().put("forgotten", forgotten).toString());
                            } else if ("credential".equals(request.optString("action"))) {
                                String token = credentials.read(origin, instance);
                                replyProxy.postMessage(new org.json.JSONObject()
                                    .put("token", token == null ? org.json.JSONObject.NULL : token).toString());
                            }
                        } catch (org.json.JSONException | RuntimeException ignored) {
                            // Never log native messages or credential values.
                        }
                    });
            }
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream in = getAssets().open("tvshell/tv.js")) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = in.read(buffer)) != -1) bytes.write(buffer, 0, count);
            }
            String tvScript = bytes.toString("UTF-8");
            bytes.reset();
            try (InputStream in = getAssets().open("tvshell/hosted-layout.js")) {
                byte[] buffer = new byte[4096];
                int count;
                while ((count = in.read(buffer)) != -1) bytes.write(buffer, 0, count);
            }
            String bootstrap = libraryConnectionScript(true)
                + "window.__tvShellTouchLayout=" + (loadedLayoutWidth == ShellSite.DEVICE_VIEWPORT)
                + ";window.__tvShellViewport=\"" + ShellSite.viewport(loadedLayoutWidth, loadedScreenWidth) + "\";\n";
            shellScript = WebViewCompat.addDocumentStartJavaScript(webView,
                "if (window === window.top) {\n" + bootstrap + bytes.toString("UTF-8") + "\n" + tvScript + "\n}", Collections.singleton(origin));
        } else if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            shellScript = WebViewCompat.addDocumentStartJavaScript(webView,
                "if (window === window.top) {\n" + libraryConnectionScript(false) + "}", Collections.singleton(origin));
        }
    }

    private String libraryConnectionScript(boolean hosted) {
        if (tvDevice) return "";
        // During a temporary fallback, the embedded app still offers the selected server.
        String savedOrigin = hosted ? loadedConnection : prefs.hostedOrigin();
        return "window.__tvShellLibraryConnection={origin:" + JSONObject.quote(loadedConnection)
            + ",savedOrigin:" + JSONObject.quote(savedOrigin)
            + ",offline:" + (!hosted && prefs.hostedOrigin().equals(offlineOrigin))
            + ",paired:" + new PairedCredentialStore(this).contains(savedOrigin)
            + ",approvalOrigin:" + JSONObject.quote(hosted ? "" : prefs.approvalOrigin())
            + ",canScanQr:" + LibraryQrScanner.available(this) + "};\n";
    }

    private static String accessUiOrigin(HostedAccessSession session) {
        java.util.UUID id = java.util.UUID.nameUUIDFromBytes(
            (session.origin + "\n" + session.instance).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return "https://" + id + ".iptvnator.invalid";
    }

    boolean connectScannedLibrary(String scanned) {
        if (scanned == null || scanned.length() > 2048 || isFinishing() || isDestroyed()) return false;
        try {
            Uri uri = Uri.parse(scanned);
            String path = uri.getEncodedPath();
            boolean browserPairingPage = "/connect-device.html".equals(path);
            if (uri.getEncodedQuery() != null || (path != null && !path.isEmpty() && !"/".equals(path) && !browserPairingPage)) return false;
            String origin = HostedOrigin.normalize(uri.buildUpon().path(null).fragment(null).build().toString());
            String fragment = uri.getFragment();
            if (fragment != null && fragment.startsWith("iptvnator-access=") && origin.startsWith("https://")) {
                String[] parts = fragment.substring("iptvnator-access=".length()).split("&invite=", -1);
                if (!parts[0].matches("[A-Za-z0-9_-]{1,200}")
                    || (browserPairingPage ? parts.length != 2 || !parts[1].matches("[A-Za-z0-9_-]{43}") : parts.length != 1))
                    return false;
                accessFlow.cancel();
                accessFlow.offer(origin, parts[0], browserPairingPage ? parts[1] : "");
                return true;
            }
            if (browserPairingPage || fragment != null || !"http".equals(uri.getScheme()) || uri.getPort() != 4334) return false;
            if (!PairingLink.privateIpv4(uri.getHost())) return false;
            handler.postDelayed(() -> connectLibrary(origin), 100);
            return true;
        } catch (IllegalArgumentException e) { return false; }
    }

    void offerAccessSignIn(String origin, String instance) {
        if (origin.equals(prefs.hostedOrigin())) accessFlow.offer(origin, instance);
    }

    void reportAccessDeviceStatus(HostedAccessSession session, String status) {
        if (session != accessSession || !session.origin.equals(prefs.hostedOrigin())
            || isFinishing() || isDestroyed()) return;
        if ("revoked".equals(status)) {
            session.forget();
            prefs.setHostedOrigin("");
            offlineOrigin = null;
            reloadLibraryFromSettings();
            toast(getString(R.string.access_device_revoked));
        } else {
            accessFlow.deviceRegistrationRequired();
        }
    }

    void useAccessLibrary(String origin) {
        prefs.setHostedOrigin(origin);
        reloadPairedLibrary();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (Intent.ACTION_VIEW.equals(intent.getAction())) accessFlow.callback(intent.getData());
    }

    /** (Re)starts the ready watchdog for a full period; while paused onResume() does it. */
    private void armWatchdog() {
        handler.removeCallbacks(readyWatchdog);
        if (!resumed) return; // startup time in the background does not count
        handler.postDelayed(readyWatchdog, loadedConnection != null && !loadedConnection.isEmpty()
            ? HOSTED_READY_TIMEOUT_MS : READY_TIMEOUT_MS);
    }

    private boolean fallbackToLocalLibrary() {
        if (loadedConnection == null || loadedConnection.isEmpty()
            || !loadedConnection.equals(prefs.hostedOrigin()) || isFinishing() || isDestroyed()) return false;
        offlineOrigin = loadedConnection;
        restoreUrl = null;
        webView.stopLoading();
        load();
        toast(getString(R.string.connection_offline_local));
        return true;
    }

    /** The screen stays on only while the page plays something (and during the start-up splash). */
    void setKeepScreenOn(boolean on) {
        if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    /** The page never reported itself ready (or cannot be parsed): the error panel with the diagnostics. */
    private void showLoadTimeout() {
        if (pageReady || errorPanel.getVisibility() == View.VISIBLE) return;
        String message = getString(R.string.load_timeout);
        if (lastConsoleError != null) message += "\n" + lastConsoleError;
        showError(message);
    }

    private void showError(String message) {
        setKeepScreenOn(false);
        splash.setVisibility(View.GONE);
        errorText.setText(message + "\n\n" + diagnostics());
        errorPanel.setVisibility(View.VISIBLE);
        updatePresentation();
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
        String chrome = "?";
        String webViewPackage = "";
        try {
            String ua = WebSettings.getDefaultUserAgent(this);
            int at = ua.indexOf("Chrome/");
            if (at >= 0) {
                int end = ua.indexOf(' ', at);
                chrome = ua.substring(at + 7, end > 0 ? end : ua.length());
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                android.content.pm.PackageInfo info = WebView.getCurrentWebViewPackage();
                if (info != null) webViewPackage = info.packageName + " " + info.versionName;
            }
        } catch (RuntimeException e) {
            // The system WebView is missing, disabled or being updated: the rest still helps.
            webViewPackage = "unavailable (" + e.getClass().getSimpleName() + ")";
        }
        String port = server == null ? "-" : String.valueOf(server.port());
        if (server != null && ShellApp.onFallbackPort()) port += " (temporary, saved data on " + prefs.serverPort() + ")";
        String layout = loadedLayoutWidth == ShellSite.DEVICE_VIEWPORT ? "device-width" : String.valueOf(loadedLayoutWidth);
        return getString(R.string.diagnostics, chrome, webViewPackage, Build.MODEL, Build.VERSION.RELEASE,
            port, screenInfo(this) + ", layout " + layout);
    }

    // ------------------------------------------------------------- keys
    // ComponentActivity inherits this Activity callback from androidx.core, where
    // it is library-restricted. Preserve its dispatch to focused native controls.
    @SuppressLint("RestrictedApi")
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        int action = event.getAction();
        if (customView == null && errorPanel.getVisibility() == View.VISIBLE) {
            // The WebView underneath stays focusable: keys must land on the panel's buttons.
            View focus = getCurrentFocus();
            if (focus == null || focus == webView) errorPanel.findViewById(R.id.error_retry).requestFocus();
            return super.dispatchKeyEvent(event);
        }
        switch (code) {
            case KeyEvent.KEYCODE_BACK:
                // A held Back opens the shell settings: remotes without a Menu key (Google TV, HDMI-CEC).
                if (action == KeyEvent.ACTION_DOWN) {
                    if (event.getRepeatCount() == 0) {
                        backDownAt = SystemClock.uptimeMillis();
                        backLongPressFired = false;
                    } else if (!backLongPressFired && SystemClock.uptimeMillis() - backDownAt >= LONG_PRESS_MS) {
                        backLongPressFired = true;
                        openSettings();
                    }
                } else if (action == KeyEvent.ACTION_UP) {
                    if (!backLongPressFired && !event.isCanceled()) handleBack();
                    backLongPressFired = false;
                }
                return true;
            case KeyEvent.KEYCODE_MENU:
            case KeyEvent.KEYCODE_TV_MEDIA_CONTEXT_MENU: // HDMI-CEC remotes
            case KeyEvent.KEYCODE_BUTTON_Y: // game controllers
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
                if (loadedLayoutWidth == ShellSite.DEVICE_VIEWPORT && customView == null) {
                    return super.dispatchKeyEvent(event);
                }
                // A held OK is one activation. The WebView turns every Android key repeat into a fresh
                // Enter keydown + keypress with KeyboardEvent.repeat === false, so the page cannot filter
                // repeats itself; drop them here like the media keys above. D-pad repeats stay (hold to scroll).
                if (action == KeyEvent.ACTION_DOWN && event.getRepeatCount() > 0) return true;
                if (customView != null) return forwardToPage(event, "Enter");
                return super.dispatchKeyEvent(event);
            case KeyEvent.KEYCODE_DPAD_UP:
                if (customView != null) return forwardToPage(event, "ArrowUp");
                return super.dispatchKeyEvent(event);
            case KeyEvent.KEYCODE_DPAD_DOWN:
                if (customView != null) return forwardToPage(event, "ArrowDown");
                return super.dispatchKeyEvent(event);
            case KeyEvent.KEYCODE_DPAD_LEFT:
                if (customView != null) return forwardToPage(event, "ArrowLeft");
                return super.dispatchKeyEvent(event);
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                if (customView != null) return forwardToPage(event, "ArrowRight");
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

    /**
     * In fullscreen the WebView is hidden and Chromium's fullscreen view holds focus, so D-pad and
     * OK may not reach the page. Let the page route those keys to its controls and keep native
     * delivery for keys it declines, such as input inside a trailer frame or text caret movement.
     * The key names are constants from the switch above. Ctrl, Alt and Meta combinations stay on
     * the native path: the replay carries no modifier flags, so the page guards that skip modified
     * arrows would see a plain arrow and seek or move focus instead of moving the caret.
     */
    @SuppressLint("RestrictedApi") // Same inherited Activity key dispatch as dispatchKeyEvent above.
    private boolean forwardToPage(KeyEvent event, String key) {
        if (event.isCtrlPressed() || event.isAltPressed() || event.isMetaPressed()) {
            return super.dispatchKeyEvent(event);
        }
        int action = event.getAction();
        if (webView == null || (action != KeyEvent.ACTION_DOWN && action != KeyEvent.ACTION_UP)) {
            return super.dispatchKeyEvent(event);
        }
        View fullscreenView = customView;
        KeyEvent nativeKey = new KeyEvent(event);
        String type = action == KeyEvent.ACTION_DOWN ? "keydown" : "keyup";
        webView.evaluateJavascript(
            "window.__tvShell && window.__tvShell.key && window.__tvShell.key('" + type + "','" + key + "')",
            handled -> {
                if (!"true".equals(handled) && customView == fullscreenView) {
                    fullscreenView.dispatchKeyEvent(nativeKey);
                }
            });
        return true;
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
        loadRetried = false;
        setKeepScreenOn(false); // from here the page says when something plays
        handler.removeCallbacks(readyWatchdog);
        handler.removeCallbacks(loadRetry);
        splash.setVisibility(View.GONE);
        errorPanel.setVisibility(View.GONE);
        updatePresentation();
        if (webView != null && loadedLayoutWidth != ShellSite.DEVICE_VIEWPORT) webView.requestFocus(View.FOCUS_DOWN);
    }

    void openExternal(String url, String title) {
        if (url == null || url.trim().isEmpty()) {
            toast(getString(R.string.no_stream_to_open));
            return;
        }
        String candidate = url.trim();
        Uri media = Uri.parse(candidate);
        String scheme = media.getScheme();
        if (!effectiveLibraryOrigin().isEmpty() && ((!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme))
            || media.getHost() == null || HostedOrigin.sameOrigin(effectiveLibraryOrigin(), candidate))) {
            toast(getString(R.string.no_stream_to_open));
            return;
        }
        ExternalPlayer.open(this, candidate, title, prefs.externalPlayerPackage());
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
        if (message == null || message.isEmpty()) return; // Toast.show() throws on an empty text (API 30+)
        // The application context: a toast may outlive this Activity (renderer restart, exit).
        Toast.makeText(getApplicationContext(), message, Toast.LENGTH_SHORT).show();
    }

    void showKeyboard() {
        if (webView == null || isFinishing()) return;
        // requestFocus(FOCUS_DOWN) on a WebView that already has focus moves the page focus to its
        // first element, away from the field that asked for the keyboard.
        View inputView = customView != null ? customView : webView;
        if (!inputView.hasFocus()) inputView.requestFocus();
        InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (imm == null) return;
        // The field may have become editable after the WebView last described it to the keyboard
        // (tv.js holds a D-pad-focused field read-only): describe it again before showing.
        imm.restartInput(inputView);
        imm.showSoftInput(inputView, InputMethodManager.SHOW_IMPLICIT);
    }

    void openSettings() {
        startActivity(new Intent(this, SettingsActivity.class));
    }

    void openPhoneSettings(String section) {
        if (tvDevice || SettingsActivity.PhoneSection.fromKey(section) == null) return;
        startActivity(new Intent(this, SettingsActivity.class)
            .putExtra(SettingsActivity.EXTRA_PHONE_SECTION, section));
    }

    private boolean canManageLibrary() {
        return !tvDevice && resumed && !isFinishing() && !isDestroyed()
            && loadedConnection != null && loadedConnection.equals(effectiveLibraryOrigin());
    }

    void scanLibraryQr() {
        if (!canManageLibrary()) return;
        cancelConnection();
        libraryQrScanner.open();
    }

    void inviteAccessDevice() {
        HostedAccessSession session = accessSession;
        if (!canManageLibrary() || session == null) return;
        accessFlow.inviteDevice(session, () -> session == accessSession && canManageLibrary());
    }

    void disconnectLibrary() {
        if (!canManageLibrary() || prefs.hostedOrigin().isEmpty()) return;
        cancelConnection();
        accessFlow.cancel();
        libraryQrScanner.cancel();
        pairing.cancel();
        prefs.setHostedOrigin("");
        offlineOrigin = null;
        reloadLibraryFromSettings();
    }

    void removeLibraryPairing() {
        if (!canManageLibrary()) return;
        String origin = prefs.hostedOrigin();
        PairedCredentialStore credentials = new PairedCredentialStore(this);
        String accessKey = HostedAccessSession.storageKey(origin);
        if (!credentials.contains(origin) && !credentials.contains(accessKey)) return;
        cancelConnection();
        libraryQrScanner.cancel();
        pairing.cancel();
        connectionDialog = new AlertDialog.Builder(this)
            .setTitle(R.string.remove_pairing)
            .setMessage(R.string.remove_pairing_confirm)
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(R.string.remove_pairing, (dialog, button) -> {
                if (!canManageLibrary() || !origin.equals(prefs.hostedOrigin())) return;
                if (!credentials.remove(origin) || !credentials.remove(accessKey)) {
                    toast(getString(R.string.remove_pairing_failed));
                    return;
                }
                prefs.setHostedOrigin("");
                offlineOrigin = null;
                reloadLibraryFromSettings();
            }).show();
    }

    void pairLibrary(String address, String approvalAddress) {
        if (!canManageLibrary() || address == null || approvalAddress == null) return;
        final String trusted;
        try {
            trusted = approvalAddress.trim().isEmpty() && !loadedConnection.isEmpty()
                ? prefs.approvalOrigin() : HostedConnection.approvalOrigin(approvalAddress);
        } catch (IllegalArgumentException e) {
            toast(getString(R.string.approval_address_invalid));
            return;
        }
        cancelConnection();
        libraryQrScanner.cancel();
        pairing.start(address, trusted, () -> prefs.setApprovalOrigin(trusted));
    }

    void connectLibrary(String address) {
        if (!canManageLibrary() || address == null) return;
        final String origin;
        try { origin = HostedOrigin.normalize(address); }
        catch (IllegalArgumentException e) {
            toast(getString(R.string.connection_invalid));
            return;
        }
        cancelConnection();
        accessFlow.cancel();
        libraryQrScanner.cancel();
        pairing.cancel();
        long attempt = connectionAttempts.begin();
        connectionDialog = new AlertDialog.Builder(this).setTitle(R.string.connection_title)
            .setMessage(getString(R.string.connection_confirm_address, origin)
                + (origin.startsWith("http:") ? getString(R.string.pairing_http) : ""))
            .setPositiveButton(R.string.pairing_continue, null)
            .setNegativeButton(R.string.external_prompt_cancel, (d, w) -> cancelConnection())
            .setOnCancelListener(d -> cancelConnection()).show();
        connectionDialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            if (!connectionAttempts.active(attempt)) return;
            v.setVisibility(View.GONE);
            connectionDialog.setMessage(getString(R.string.connection_checking));
            new Thread(() -> {
                int result = HostedConnection.probe(origin, new PairedCredentialStore(this));
                runOnUiThread(() -> completeLibraryConnection(attempt, origin, result));
            }, "hosted-library-probe").start();
        });
    }

    private void completeLibraryConnection(long attempt, String origin, int result) {
        if (!connectionAttempts.active(attempt) || !canManageLibrary()) return;
        cancelConnection();
        if (result == 0) {
            prefs.setHostedOrigin(origin);
            offlineOrigin = null;
            reloadLibraryFromSettings();
        } else if (result == R.string.connection_access) {
            connectionDialog = HostedConnection.offerAccessQr(this, this::scanLibraryQr);
        } else {
            connectionDialog = new AlertDialog.Builder(this).setTitle(R.string.connection_title)
                .setMessage(result).setPositiveButton(android.R.string.ok, null).show();
        }
    }

    private void cancelConnection() {
        connectionAttempts.cancel();
        if (connectionDialog != null) {
            connectionDialog.dismiss();
            connectionDialog = null;
        }
    }

    void reloadPairedLibrary() {
        offlineOrigin = null;
        reloadLibraryFromSettings();
    }

    private void reloadLibraryFromSettings() {
        String url = webView != null ? webView.getUrl() : null;
        Uri current = url == null ? null : Uri.parse(url);
        String section = "/workspace/settings/server";
        String origin = prefs.hostedOrigin();
        if (current != null && section.equals(current.getPath())) {
            if (origin.isEmpty()) {
                TvShellServer local = ((ShellApp) getApplication()).ensureServer();
                if (local != null) origin = "http://127.0.0.1:" + local.port();
            }
            restoreUrl = origin.isEmpty() ? null : origin + section;
        } else {
            restoreUrl = null;
        }
        load();
    }

    // ---------------------------------------------------------- lifecycle
    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        updatePresentation();
        if (webView == null) {
            if (!webViewUnavailable) recreate(); // the renderer died while we were in the background
            return;
        }
        webView.onResume();
        js("window.__tvShell && typeof window.__tvShell.setForeground === 'function' && window.__tvShell.setForeground(true)");
        if (loadedLayoutWidth != ShellSite.DEVICE_VIEWPORT && errorPanel.getVisibility() != View.VISIBLE) {
            webView.requestFocus(View.FOCUS_DOWN);
        }
        // Give a foreground startup a fresh ready budget.
        if (!pageReady && errorPanel.getVisibility() != View.VISIBLE) armWatchdog();
        if (SettingsActivity.connectionPaired) {
            SettingsActivity.connectionPaired = false;
            offlineOrigin = null;
            restoreUrl = null;
            load();
        } else if (SettingsActivity.dataCleared) {
            SettingsActivity.dataCleared = false;
            if (webView != null) webView.clearCache(true);
            load();
        } else if (loadedConnection != null && !loadedConnection.equals(effectiveLibraryOrigin())) {
            restoreUrl = null;
            load();
        } else if (selectedLayoutWidth() != loadedLayoutWidth) {
            restoreUrl = webView.getUrl();
            load();
        } else if (server != null && prefs.hostedOrigin().isEmpty() && ShellApp.onFallbackPort() && ((ShellApp) getApplication()).ensureServer() != server) {
            load(); // the saved port is free again: back to the origin that holds the user's data
        }
    }

    @Override
    protected void onPause() {
        resumed = false;
        handler.removeCallbacks(readyWatchdog); // startup time in the background does not count
        if (webView != null) {
            lastRoute = pageReady ? webView.getUrl() : null;
            // Keep media events runnable: pauseTimers would also freeze the late-play guard.
            js("(function(){if(window.__tvShell && typeof window.__tvShell.setForeground === 'function'){window.__tvShell.setForeground(false);}else{document.querySelectorAll('video,audio').forEach(function(media){media.pause();});}})()");
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        // The route the user was on, for a restart after the system killed the process in the background,
        // or for the relaunch after it reclaimed the hidden renderer (webView is null by then).
        String url = webView != null ? (pageReady ? webView.getUrl() : null) : lastRoute;
        if (url != null) outState.putString(STATE_URL, url);
    }

    /** Display changes the manifest keeps the Activity through: the pinned page scale must follow. */
    @Override
    public void onConfigurationChanged(android.content.res.Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        tvDevice = Prefs.isTvDevice(this);
        updatePresentation();
        if (webView != null && errorPanel.getVisibility() != View.VISIBLE
                && (selectedLayoutWidth() != loadedLayoutWidth
                    || (loadedLayoutWidth != ShellSite.DEVICE_VIEWPORT && screenCssWidth(this) != loadedScreenWidth))) {
            restoreUrl = webView.getUrl(); // the same page with the new scale (load() checks the origin)
            load();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (!fileChooser.onActivityResult(requestCode, resultCode, data)
            && !libraryQrScanner.onActivityResult(requestCode, resultCode, data)) {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    @Override
    protected void onStop() {
        cancelConnection();
        libraryQrScanner.cancel();
        pairing.cancel();
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        fileChooser.cancel();
        accessFlow.cancel();
        if (accessBridge != null) accessBridge.close();
        handler.removeCallbacks(readyWatchdog);
        handler.removeCallbacks(loadRetry);
        if (webView != null) {
            webView.loadUrl("about:blank");
            root.removeView(webView); // destroy() must not run on an attached WebView
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private int selectedLayoutWidth() {
        return prefs.useTvLayout(this) ? prefs.layoutWidth() : ShellSite.DEVICE_VIEWPORT;
    }

    private void updatePresentation() {
        boolean touch = loadedLayoutWidth == ShellSite.DEVICE_VIEWPORT;
        boolean handheldControls = touch || !tvDevice;
        boolean immersive = !handheldControls || customView != null;
        boolean showSettings = handheldControls && pageReady && !immersive
            && errorPanel.getVisibility() != View.VISIBLE;
        touchSettings.setVisibility(showSettings ? View.VISIBLE : View.GONE);
        if (webView != null) {
            webView.getSettings().setLoadWithOverviewMode(!touch);
            FrameLayout.LayoutParams layout = (FrameLayout.LayoutParams) webView.getLayoutParams();
            int barHeight = showSettings ? touchSettings.getLayoutParams().height : 0;
            if (layout.bottomMargin != barHeight) {
                layout.bottomMargin = barHeight;
                webView.setLayoutParams(layout);
            }
        }
        View decor = getWindow().getDecorView();
        touchWindowInsets.setActive(handheldControls);
        if (!immersive) {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
            decor.setSystemUiVisibility(0);
            return;
        }
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_PAN);
        decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }
}
