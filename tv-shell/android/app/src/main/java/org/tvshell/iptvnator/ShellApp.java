package org.tvshell.iptvnator;

import android.app.Application;
import android.util.Log;

import org.tvshell.iptvnator.server.TvShellServer;

/** Starts the embedded server as soon as the process exists. */
public class ShellApp extends Application {

    public static final String TAG = "TvShell";

    private static TvShellServer server;

    @Override
    public void onCreate() {
        super.onCreate();
        ensureServer();
    }

    /** Starts (or returns) the local server; the port is remembered so the web app keeps one origin. */
    public synchronized TvShellServer ensureServer() {
        if (server != null && server.isAlive()) return server;
        Prefs prefs = new Prefs(this);
        int preferred = prefs.serverPort();
        int[] candidates = {preferred, 43330, 43331, 43332, 43333, 43334};
        for (int port : candidates) {
            if (port <= 0) continue;
            TvShellServer candidate = new TvShellServer(this, prefs, port);
            try {
                candidate.start();
                server = candidate;
                prefs.setServerPort(port);
                Log.i(TAG, "embedded server listening on 127.0.0.1:" + port);
                return server;
            } catch (java.io.IOException e) {
                Log.w(TAG, "port " + port + " unavailable: " + e.getMessage());
            }
        }
        return null;
    }

    public static TvShellServer currentServer() {
        return server;
    }
}
