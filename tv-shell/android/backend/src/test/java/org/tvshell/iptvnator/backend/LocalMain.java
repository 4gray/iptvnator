package org.tvshell.iptvnator.backend;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

/**
 * Runs the real Java backend + site on a plain JDK HTTP server, so the shell's
 * Playwright tests can exercise the exact code the APK ships (minus NanoHTTPD
 * and Android). Not part of the app.
 *
 *   java -cp ... org.tvshell.iptvnator.backend.LocalMain --www dist/apps/web --tv tv.js [--port 43332]
 */
public final class LocalMain {

    private static final Charset UTF8 = Charset.forName("UTF-8");

    private LocalMain() {
    }

    public static void main(String[] args) throws IOException {
        String www = null;
        String tv = null;
        int port = 43332;
        for (int i = 0; i + 1 < args.length; i += 2) {
            if (args[i].equals("--www")) www = args[i + 1];
            else if (args[i].equals("--tv")) tv = args[i + 1];
            else if (args[i].equals("--port")) port = Integer.parseInt(args[i + 1]);
        }
        if (www == null || tv == null) {
            System.err.println("usage: LocalMain --www <dir> --tv <tv.js> [--port 43332]");
            System.exit(2);
        }
        final File wwwDir = new File(www);
        final File tvFile = new File(tv);
        ShellSite site = new ShellSite(new ShellSite.AssetSource() {
            @Override
            public byte[] read(String relativePath) throws IOException {
                File file;
                if (relativePath.equals("tvshell/tv.js")) file = tvFile;
                else if (relativePath.startsWith("www/")) file = new File(wwwDir, relativePath.substring(4));
                else return null;
                if (!file.isFile()) return null;
                InputStream in = new FileInputStream(file);
                try {
                    java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                    byte[] buffer = new byte[16384];
                    int read;
                    while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
                    return out.toByteArray();
                } finally {
                    in.close();
                }
            }
        }, "/api", 1280);
        final WebBackend backend = new WebBackend(new HttpFetcher(), "/api");
        final ShellSite finalSite = site;

        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 16);
        server.setExecutor(java.util.concurrent.Executors.newFixedThreadPool(8));
        server.createContext("/", new HttpHandler() {
            @Override
            public void handle(HttpExchange exchange) throws IOException {
                try {
                    String path = exchange.getRequestURI().getRawPath();
                    if (path.startsWith("/api")) {
                        String sub = path.substring(4);
                        String body = new String(readAll(exchange.getRequestBody()), UTF8);
                        WebBackend.Response r = backend.handle(exchange.getRequestMethod(), sub, parseQuery(exchange.getRequestURI().getRawQuery()), body);
                        exchange.getResponseHeaders().set("Content-Type", r.contentType);
                        for (Map.Entry<String, String> h : r.headers.entrySet()) exchange.getResponseHeaders().set(h.getKey(), h.getValue());
                        long length = r.bodyLength();
                        exchange.sendResponseHeaders(r.status, length == 0 ? -1 : length);
                        if (length > 0) {
                            // Streamed from the answer's chunks, as TvShellServer hands them to NanoHTTPD.
                            InputStream in = r.openBody();
                            OutputStream out = exchange.getResponseBody();
                            byte[] buffer = new byte[16 * 1024];
                            int read;
                            while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
                            out.close();
                        } else {
                            exchange.close();
                        }
                        return;
                    }
                    ShellSite.Resource res = finalSite.serve(URLDecoder.decode(path, "UTF-8"));
                    exchange.getResponseHeaders().set("Content-Type", res.contentType);
                    exchange.getResponseHeaders().set("Cache-Control", res.cacheControl);
                    exchange.sendResponseHeaders(res.status, res.body.length == 0 ? -1 : res.body.length);
                    if (res.body.length > 0) {
                        OutputStream out = exchange.getResponseBody();
                        out.write(res.body);
                        out.close();
                    } else {
                        exchange.close();
                    }
                } catch (RuntimeException e) {
                    e.printStackTrace();
                    byte[] msg = ("internal error: " + e).getBytes(UTF8);
                    exchange.sendResponseHeaders(500, msg.length);
                    OutputStream out = exchange.getResponseBody();
                    out.write(msg);
                    out.close();
                }
            }
        });
        server.start();
        System.out.println("Java backend (LocalMain) on http://127.0.0.1:" + port + "  www=" + wwwDir.getAbsolutePath());
    }

    static byte[] readAll(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int read;
        while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
        return out.toByteArray();
    }

    static Map<String, List<String>> parseQuery(String rawQuery) throws IOException {
        Map<String, List<String>> query = new LinkedHashMap<String, List<String>>();
        if (rawQuery == null || rawQuery.isEmpty()) return query;
        for (String pair : rawQuery.split("&")) {
            if (pair.isEmpty()) continue;
            int eq = pair.indexOf('=');
            String key = URLDecoder.decode(eq >= 0 ? pair.substring(0, eq) : pair, "UTF-8");
            String value = eq >= 0 ? URLDecoder.decode(pair.substring(eq + 1), "UTF-8") : "";
            List<String> values = query.get(key);
            if (values == null) {
                values = new ArrayList<String>();
                query.put(key, values);
            }
            values.add(value);
        }
        return query;
    }
}
