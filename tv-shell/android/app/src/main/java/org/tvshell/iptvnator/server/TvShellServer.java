package org.tvshell.iptvnator.server;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Log;

import org.tvshell.iptvnator.Prefs;
import org.tvshell.iptvnator.ShellApp;
import org.tvshell.iptvnator.backend.HttpFetcher;
import org.tvshell.iptvnator.backend.ShellSite;
import org.tvshell.iptvnator.backend.WebBackend;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import fi.iki.elonen.NanoHTTPD;

/**
 * The loopback HTTP server the WebView talks to:
 * <ul>
 *   <li>{@code /api/*} → the embedded web backend ({@link WebBackend});</li>
 *   <li>everything else → the bundled PWA ({@link ShellSite}) from the APK assets.</li>
 * </ul>
 * Bound to 127.0.0.1 only. The port is fixed per device (see {@link Prefs})
 * because the web app's storage (IndexedDB, localStorage) belongs to the origin.
 */
public class TvShellServer extends NanoHTTPD {

    private final AssetManager assets;
    private final ShellSite site;
    private final WebBackend backend;
    private final int port;
    /** Same bound as the upstream web backend (express.json limit 16kb): only tiny JSON bodies are legitimate. */
    private static final long MAX_API_BODY_BYTES = 16 * 1024;

    public TvShellServer(Context context, Prefs prefs, int port) {
        super("127.0.0.1", port);
        this.port = port;
        this.assets = context.getApplicationContext().getAssets();
        this.site = new ShellSite(new ShellSite.AssetSource() {
            @Override
            public byte[] read(String relativePath) throws IOException {
                return readAsset(relativePath);
            }
        }, "/api", prefs.layoutWidth());
        this.backend = new WebBackend(new HttpFetcher(), "/api");
    }

    public void start() throws IOException {
        start(NanoHTTPD.SOCKET_READ_TIMEOUT, false);
    }

    public String baseUrl() {
        return "http://127.0.0.1:" + port + "/";
    }

    public int port() {
        return port;
    }

    public void setLayoutWidth(int width) {
        site.setLayoutWidth(width);
    }

    /** Screen width in CSS px (Android dp), so index.html can pin the page scale. */
    public void setScreenWidth(int cssWidth) {
        site.setScreenWidth(cssWidth);
    }

    private byte[] readAsset(String relativePath) throws IOException {
        InputStream in;
        try {
            in = assets.open(relativePath, AssetManager.ACCESS_STREAMING);
        } catch (FileNotFoundException e) {
            return null;
        }
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream(64 * 1024);
            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
            return out.toByteArray();
        } finally {
            in.close();
        }
    }

    /** NanoHTTPD only knows a handful of statuses; the backend uses a few more (422, 502, ...). */
    private static Response.IStatus status(final int code) {
        for (Response.Status known : Response.Status.values()) {
            if (known.getRequestStatus() == code) return known;
        }
        final String reason;
        switch (code) {
            case 422: reason = "Unprocessable Entity"; break;
            case 502: reason = "Bad Gateway"; break;
            case 503: reason = "Service Unavailable"; break;
            case 504: reason = "Gateway Timeout"; break;
            default: reason = "Status " + code;
        }
        return new Response.IStatus() {
            @Override
            public String getDescription() {
                return code + " " + reason;
            }

            @Override
            public int getRequestStatus() {
                return code;
            }
        };
    }

    @Override
    public Response serve(IHTTPSession session) {
        String uri = session.getUri();
        try {
            if (uri.startsWith("/api")) {
                String sub = uri.substring(4);
                String body = null;
                Method method = session.getMethod();
                if (Method.POST.equals(method) || Method.PUT.equals(method)) {
                    // NanoHTTPD trusts Content-Length and copies the whole body into a byte[] and a String;
                    // an OutOfMemoryError there is not caught by its client thread and kills the process.
                    long declared = 0;
                    String length = session.getHeaders().get("content-length");
                    if (length != null) {
                        try {
                            declared = Long.parseLong(length.trim());
                        } catch (NumberFormatException e) {
                            return close(error(Response.Status.BAD_REQUEST, "invalid Content-Length"));
                        }
                    }
                    if (declared > MAX_API_BODY_BYTES) {
                        return close(error(Response.Status.PAYLOAD_TOO_LARGE, "request body too large"));
                    }
                    Map<String, String> files = new HashMap<String, String>();
                    try {
                        session.parseBody(files);
                    } catch (ResponseException e) {
                        return error(e.getStatus(), e.getMessage());
                    }
                    body = files.get("postData");
                }
                Map<String, List<String>> query = session.getParameters();
                WebBackend.Response r = backend.handle(method.name(), sub, query, body);
                Response response = newFixedLengthResponse(status(r.status), r.contentType, new ByteArrayInputStream(r.body), r.body.length);
                for (Map.Entry<String, String> header : r.headers.entrySet()) response.addHeader(header.getKey(), header.getValue());
                return response;
            }
            ShellSite.Resource res = site.serve(uri);
            Response response = newFixedLengthResponse(status(res.status), res.contentType, new ByteArrayInputStream(res.body), res.body.length);
            response.addHeader("Cache-Control", res.cacheControl);
            return response;
        } catch (IOException e) {
            Log.e(ShellApp.TAG, "serve " + uri + " failed", e);
            return error(Response.Status.INTERNAL_ERROR, "I/O error: " + e.getMessage());
        } catch (RuntimeException e) {
            Log.e(ShellApp.TAG, "serve " + uri + " crashed", e);
            return error(Response.Status.INTERNAL_ERROR, "Internal error: " + e);
        } catch (OutOfMemoryError e) {
            // NanoHTTPD's ClientHandler only catches Exception: an Error escaping serve() reaches
            // Android's default uncaught handler, which kills the whole process. Once this frame
            // unwinds the request buffers are unreachable, so answering is safe; the PWA shows the
            // message in its usual error toast (same body shape as the backend's 500 answers).
            Log.e(ShellApp.TAG, "serve " + uri + " ran out of memory");
            Response r = newFixedLengthResponse(status(500), "application/json; charset=utf-8",
                "{\"message\":\"The provider response is too large for this device's memory\",\"status\":500}");
            return r;
        } catch (StackOverflowError e) {
            // Same reasoning: the JSON reader bounds its nesting (Json.MAX_DEPTH), this is the
            // backstop for any other deep recursion a hostile payload might find.
            Log.e(ShellApp.TAG, "serve " + uri + " overflowed the stack");
            return newFixedLengthResponse(status(500), "application/json; charset=utf-8",
                "{\"message\":\"The provider response is too deeply nested for this device\",\"status\":500}");
        }
    }

    /** Loopback traffic gains nothing from compression; NanoHTTPD would otherwise gzip text answers after serve(). */
    @Override
    protected boolean useGzipWhenAccepted(Response r) {
        return false;
    }

    /** The body was not read: close the socket so NanoHTTPD does not parse it as the next keep-alive request. */
    private static Response close(Response response) {
        response.addHeader("Connection", "close");
        return response;
    }

    private static Response error(Response.IStatus status, String message) {
        Response response = newFixedLengthResponse(status, "text/plain; charset=utf-8", message == null ? "" : message);
        return response;
    }
}
