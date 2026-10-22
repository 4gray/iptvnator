package org.tvshell.iptvnator;

import android.app.Application;
import android.os.SystemClock;
import android.util.Log;

import org.tvshell.iptvnator.server.TvShellServer;

/** Starts the embedded server as soon as the process exists. */
public class ShellApp extends Application {

    public static final String TAG = "TvShell";

    private static TvShellServer server;
    private static boolean fallbackPort;
    /** The remembered port is tried a few times: a collision with a short-lived socket clears quickly. */
    private static final int PREFERRED_PORT_ATTEMPTS = 3;
    private static final long PREFERRED_PORT_RETRY_MS = 250;

    @Override
    public void onCreate() {
        super.onCreate();
        ensureServer();
    }

    /**
     * Starts (or returns) the local server. The web app's storage (playlists, portals, favourites)
     * belongs to the origin http://127.0.0.1:port, so the port is persisted once and never replaced:
     * when another app holds it, a fallback port serves this run only and the next start returns to
     * the user's data ({@link #onFallbackPort()} lets the UI say so).
     */
    public synchronized TvShellServer ensureServer() {
        if (server != null && server.isAlive()) {
            if (!fallbackPort) return server;
            // On a temporary port: the saved one may be free again (the other app was closed).
            Prefs prefs = new Prefs(this);
            TvShellServer home = tryBind(prefs, prefs.serverPort());
            if (home == null) return server;
            server.stop();
            Log.i(TAG, "port " + home.port() + " free again: back to the saved data");
            return listening(home, false);
        }
        Prefs prefs = new Prefs(this);
        int preferred = prefs.serverPort();
        for (int attempt = 0; attempt < PREFERRED_PORT_ATTEMPTS; attempt++) {
            if (attempt > 0) SystemClock.sleep(PREFERRED_PORT_RETRY_MS);
            TvShellServer bound = tryBind(prefs, preferred);
            if (bound != null) {
                if (!prefs.hasServerPort()) prefs.setServerPort(preferred);
                return listening(bound, false);
            }
        }
        for (int port : new int[] {43330, 43331, 43332, 43333, 43334}) {
            if (port == preferred) continue;
            TvShellServer bound = tryBind(prefs, port);
            if (bound == null) continue;
            if (!prefs.hasServerPort()) {
                // First start: no data exists yet, this port becomes the origin for good.
                prefs.setServerPort(port);
                return listening(bound, false);
            }
            Log.w(TAG, "port " + preferred + " busy: serving on " + port + " for this run only");
            return listening(bound, true);
        }
        return null;
    }

    private static TvShellServer listening(TvShellServer bound, boolean fallback) {
        server = bound;
        fallbackPort = fallback;
        Log.i(TAG, "embedded server listening on 127.0.0.1:" + bound.port());
        return bound;
    }

    private TvShellServer tryBind(Prefs prefs, int port) {
        if (port <= 0) return null;
        TvShellServer candidate = new TvShellServer(this, prefs, port);
        try {
            candidate.start();
            return candidate;
        } catch (java.io.IOException e) {
            Log.w(TAG, "port " + port + " unavailable: " + e.getMessage());
            return null;
        }
    }

    /** True while this run serves on another port than the one the web app's data lives on. */
    public static boolean onFallbackPort() {
        return server != null && fallbackPort;
    }

    public static TvShellServer currentServer() {
        return server;
    }
}
