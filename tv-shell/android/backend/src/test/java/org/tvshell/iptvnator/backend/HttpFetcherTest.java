package org.tvshell.iptvnator.backend;

import static org.tvshell.iptvnator.backend.TestMain.assertEquals;
import static org.tvshell.iptvnator.backend.TestMain.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStreamReader;
import java.net.ServerSocket;
import java.net.Socket;
import java.io.IOException;
import java.net.MalformedURLException;
import java.net.URL;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.zip.GZIPOutputStream;

/** Mirrors apps/web-backend validated-http-client.spec.ts: identity headers stop at the origin boundary. */
public class HttpFetcherTest {

    private static Map<String, String> identity() {
        Map<String, String> headers = new LinkedHashMap<String, String>();
        headers.put("Authorization", "Bearer portal-token");
        headers.put("cOoKiE", "mac=00:1A:79:00:00:01");
        headers.put("Proxy-Authorization", "Basic x");
        headers.put("sN", "serial");
        headers.put("User-Agent", "Mozilla/5.0");
        return headers;
    }

    private static Map<String, String> redirected(String from, String location) throws MalformedURLException {
        URL sent = new URL(from);
        return HttpFetcher.headersForRedirect(identity(), sent, new URL(sent, location));
    }

    public void testBodyCapFollowsTheHeapAndRejectsEarly() throws Exception {
        assertTrue("cap at most 64 MB", HttpFetcher.MAX_BODY_BYTES <= 64L * 1024 * 1024);
        assertTrue("cap at most an eighth of the heap", HttpFetcher.MAX_BODY_BYTES <= Runtime.getRuntime().maxMemory() / 8);
        byte[] ten = "0123456789".getBytes("UTF-8");
        assertEquals("declared size sizes the buffer", 10, Integer.valueOf(HttpFetcher.readAll(new ByteArrayInputStream(ten), 10, 10).length));
        assertEquals("unknown size", 10, Integer.valueOf(HttpFetcher.readAll(new ByteArrayInputStream(ten), -1, 10).length));
        try {
            HttpFetcher.readAll(new ByteArrayInputStream(ten), 11, 10);
            throw new TestMain.AssertionFailed("declared over the cap must not read a byte");
        } catch (HttpFetcher.TooLargeException expected) {
            // refused before reading
        }
        try {
            HttpFetcher.readAll(new ByteArrayInputStream(ten), -1, 9);
            throw new TestMain.AssertionFailed("body over the cap must stop");
        } catch (HttpFetcher.TooLargeException expected) {
            // refused while reading
        }
        ProviderException e = HttpFetcher.tooLarge();
        assertEquals("code", "ERR_RESPONSE_TOO_LARGE", e.code);
        assertTrue("no http status", !e.hasHttpStatus());
    }

    public void testSameOriginRedirectKeepsEveryHeader() throws Exception {
        assertEquals("same origin", identity(), redirected("https://provider.example/start", "https://provider.example/next"));
        assertEquals("relative location", identity(), redirected("https://provider.example/start", "/next"));
        assertEquals("default port is the same origin", identity(), redirected("http://a.example/x", "http://a.example:80/y"));
        assertEquals("host case", identity(), redirected("https://Provider.example/x", "https://provider.EXAMPLE/y"));
    }

    public void testCrossOriginRedirectDropsIdentityHeaders() throws Exception {
        Map<String, String> onlyAgent = new LinkedHashMap<String, String>();
        onlyAgent.put("User-Agent", "Mozilla/5.0");
        assertEquals("other host", onlyAgent, redirected("https://provider.example/start", "https://other.example/next"));
        assertEquals("other port", onlyAgent, redirected("https://provider.example/start", "https://provider.example:8443/next"));
        assertEquals("https to http", onlyAgent, redirected("https://provider.example/start", "http://provider.example/next"));
        Map<String, String> input = identity();
        HttpFetcher.headersForRedirect(input, new URL("https://a.example/"), new URL("https://b.example/"));
        assertTrue("input map is not mutated", input.containsKey("Authorization"));
        assertTrue("null headers stay null", HttpFetcher.headersForRedirect(null, new URL("https://a.example/"), new URL("https://b.example/")) == null);
    }
    /** A real HTTP 200 whose body cannot be consumed; no external host or provider data. */
    private static final class BrokenBodyServer implements AutoCloseable {
        private static final byte[] PLAYLIST = "#EXTM3U\n#EXTINF:-1,Synthetic Channel\nhttps://stream.example/live.m3u8\n".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        final ServerSocket listener;
        final Thread thread;
        volatile IOException failure;

        BrokenBodyServer(final String mode) throws IOException {
            final boolean timeout = mode.equals("timeout");
            final boolean truncated = mode.equals("truncated");
            final boolean missingGzipMember = mode.equals("gzip-member");
            listener = new ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"));
            thread = new Thread(() -> {
                try (Socket socket = listener.accept()) {
                    socket.setSoTimeout(2000);
                    BufferedReader request = new BufferedReader(new InputStreamReader(socket.getInputStream(), "US-ASCII"));
                    String line;
                    while ((line = request.readLine()) != null && !line.isEmpty()) { /* consume headers */ }
                    byte[] body = timeout ? new byte[0] : truncated ? PLAYLIST
                        : missingGzipMember ? gzip(PLAYLIST) : new byte[] { 0x1f, (byte) 0x8b, 0x08 };
                    int declared = timeout ? 1 : truncated || missingGzipMember ? 1024 : body.length;
                    String headers = "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: " + declared
                        + (timeout || truncated ? "" : "\r\nContent-Encoding: gzip") + "\r\n\r\n";
                    socket.getOutputStream().write(headers.getBytes("US-ASCII"));
                    socket.getOutputStream().write(body);
                    socket.getOutputStream().flush();
                    // A stalled body ends when the client times out and disconnects.
                    if (timeout) socket.getInputStream().read();
                } catch (IOException e) {
                    failure = e;
                }
            }, "synthetic-broken-body");
            thread.start();
        }

        private static byte[] gzip(byte[] body) throws IOException {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (GZIPOutputStream gzip = new GZIPOutputStream(out)) {
                gzip.write(body);
            }
            return out.toByteArray();
        }

        String url() { return "http://127.0.0.1:" + listener.getLocalPort() + "/synthetic.m3u"; }

        @Override
        public void close() throws Exception {
            listener.close();
            thread.join(3000);
            assertTrue("server thread finished", !thread.isAlive());
            if (failure != null) throw failure;
        }
    }

    public void testBodyReadFailuresLoseTheSuccessfulHttpStatus() throws Exception {
        for (String mode : new String[] { "gzip", "timeout", "truncated" }) {
            try (BrokenBodyServer server = new BrokenBodyServer(mode)) {
                try {
                    new HttpFetcher().get(server.url(), null, 200);
                    throw new TestMain.AssertionFailed("broken body must fail");
                } catch (ProviderException error) {
                    assertTrue("body failure is a transport error", !error.hasHttpStatus());
                    assertTrue("network error code retained", error.code != null);
                    if (mode.equals("timeout")) assertEquals("body timeout code", "ETIMEDOUT", error.code);
                }
            }
        }
    }

    public void testBrokenPlaylistBodyCannotLookLikeASuccessfulImport() throws Exception {
        for (String mode : new String[] { "gzip", "truncated", "gzip-member" }) {
            assertBrokenPlaylistImport(mode);
        }
    }

    private void assertBrokenPlaylistImport(String mode) throws Exception {
        try (BrokenBodyServer server = new BrokenBodyServer(mode)) {
            WebBackend backend = new WebBackend(new HttpFetcher(), "/api");
            String id = WebBackendTest.register(backend, server.url());
            WebBackend.Response response = backend.handle("GET", "/parse", WebBackendTest.query("targetId", id), null);
            assertEquals("failed import is non-2xx", 500, Integer.valueOf(response.status));
            assertEquals("error payload status", 500, ((Number) WebBackendTest.body(response).get("status")).intValue());
            assertTrue("never a playlist", !WebBackendTest.body(response).containsKey("playlist"));
        }
    }

}
