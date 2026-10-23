package org.tvshell.iptvnator.backend;

import static org.tvshell.iptvnator.backend.TestMain.assertEquals;
import static org.tvshell.iptvnator.backend.TestMain.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.MalformedURLException;
import java.net.URL;
import java.util.LinkedHashMap;
import java.util.Map;

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
}
