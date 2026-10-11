package org.tvshell.iptvnator.backend;

import java.io.IOException;
import java.nio.charset.Charset;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Serves the bundled IPTVnator PWA (the {@code www/} directory of the build)
 * with the three adjustments the TV shell needs:
 * <ul>
 *   <li>{@code index.html} loads {@code tvshell/tv.js} before the Angular
 *       bundle (same origin, so the app's CSP allows it), gets a fixed layout
 *       viewport width so the desktop layout is used on the TV, and a base
 *       href of {@code /};</li>
 *   <li>{@code assets/app-config.js} points the PWA at the embedded backend;</li>
 *   <li>the Angular service worker is not served (the bundle ships inside the
 *       APK; caching would only make updates stale).</li>
 * </ul>
 * Pure Java: the Android server and the local test server both wrap it.
 */
public class ShellSite {

    /** Where the files come from (Android assets, or a directory in tests). */
    public interface AssetSource {
        /** @return the file bytes, or null when the file does not exist. */
        byte[] read(String relativePath) throws IOException;
    }

    public static final class Resource {
        public final int status;
        public final String contentType;
        public final byte[] body;
        public final String cacheControl;

        Resource(int status, String contentType, byte[] body, String cacheControl) {
            this.status = status;
            this.contentType = contentType;
            this.body = body;
            this.cacheControl = cacheControl;
        }
    }

    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final Pattern HASHED_FILE = Pattern.compile("^/(?:chunk-|main-|polyfills-|styles-|scripts-)[A-Za-z0-9_-]{6,}\\.(?:js|css)$|^/media/.+");
    private static final Map<String, String> MIME = new HashMap<String, String>();

    static {
        MIME.put("html", "text/html; charset=utf-8");
        MIME.put("js", "application/javascript; charset=utf-8");
        MIME.put("mjs", "application/javascript; charset=utf-8");
        MIME.put("css", "text/css; charset=utf-8");
        MIME.put("json", "application/json; charset=utf-8");
        MIME.put("webmanifest", "application/manifest+json");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("gif", "image/gif");
        MIME.put("webp", "image/webp");
        MIME.put("ico", "image/x-icon");
        MIME.put("woff", "font/woff");
        MIME.put("woff2", "font/woff2");
        MIME.put("ttf", "font/ttf");
        MIME.put("otf", "font/otf");
        MIME.put("txt", "text/plain; charset=utf-8");
        MIME.put("map", "application/json");
        MIME.put("wasm", "application/wasm");
        MIME.put("mp3", "audio/mpeg");
        MIME.put("mp4", "video/mp4");
        MIME.put("webm", "video/webm");
    }

    private final AssetSource assets;
    private final String backendUrl;
    private volatile int layoutWidth;

    public ShellSite(AssetSource assets, String backendUrl, int layoutWidth) {
        this.assets = assets;
        this.backendUrl = backendUrl;
        this.layoutWidth = layoutWidth;
    }

    public void setLayoutWidth(int layoutWidth) {
        this.layoutWidth = layoutWidth;
    }

    public static String mimeFor(String path) {
        int dot = path.lastIndexOf('.');
        int slash = path.lastIndexOf('/');
        if (dot > slash) {
            String mime = MIME.get(path.substring(dot + 1).toLowerCase());
            if (mime != null) return mime;
        }
        return "application/octet-stream";
    }

    public Resource serve(String path) throws IOException {
        if (path == null || path.isEmpty()) path = "/";
        int q = path.indexOf('?');
        if (q >= 0) path = path.substring(0, q);
        int hash = path.indexOf('#');
        if (hash >= 0) path = path.substring(0, hash);
        if (path.contains("..")) return text(403, "forbidden");

        if (path.equals("/tvshell/tv.js")) {
            byte[] js = assets.read("tvshell/tv.js");
            if (js == null) return text(404, "tv.js missing");
            return new Resource(200, MIME.get("js"), js, "no-store");
        }
        if (path.equals("/assets/app-config.js")) {
            String js = "window.__IPTVNATOR_CONFIG__ = {\"BACKEND_URL\":" + Json.write(backendUrl) + "};\n";
            return new Resource(200, MIME.get("js"), js.getBytes(UTF8), "no-store");
        }
        if (path.equals("/ngsw-worker.js") || path.equals("/ngsw.json") || path.equals("/safety-worker.js") || path.equals("/worker-basic.min.js")) {
            return text(404, "service worker disabled in the TV shell");
        }

        String relative = path.equals("/") ? "index.html" : path.substring(1);
        byte[] data = relative.endsWith("/") ? null : assets.read("www/" + relative);
        if (data == null || relative.equals("index.html")) {
            // SPA fallback: every unknown route is the app itself.
            byte[] index = assets.read("www/index.html");
            if (index == null) return text(503, "IPTVnator web app is missing from the APK (www/index.html)");
            return new Resource(200, MIME.get("html"), injectTvLayer(new String(index, UTF8), layoutWidth).getBytes(UTF8), "no-store");
        }
        String cache = HASHED_FILE.matcher(path).matches() ? "public, max-age=31536000, immutable" : "no-store";
        return new Resource(200, mimeFor(relative), data, cache);
    }

    private static Resource text(int status, String message) {
        return new Resource(status, "text/plain; charset=utf-8", message.getBytes(UTF8), "no-store");
    }

    /** Same transformation as devserver/server.mjs injectTvLayer(). */
    public static String injectTvLayer(String html, int layoutWidth) {
        html = html.replaceFirst("<base href=\"[^\"]*\"\\s*/?>", "<base href=\"/\">");
        html = html.replaceFirst("<meta name=\"viewport\"[^>]*>",
            "<meta name=\"viewport\" content=\"width=" + layoutWidth + "\">");
        String marker = "<script src=\"assets/app-config.js\"";
        int at = html.indexOf(marker);
        if (at >= 0) {
            html = html.substring(0, at) + "<script src=\"tvshell/tv.js\" defer></script>\n        " + html.substring(at);
        } else {
            html = html.replaceFirst("</head>", "<script src=\"tvshell/tv.js\" defer></script></head>");
        }
        return html;
    }
}
