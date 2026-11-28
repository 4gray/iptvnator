package org.tvshell.iptvnator.ui;

import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.IOException;
import junit.framework.TestCase;
import okhttp3.HttpUrl;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.Okio;
import org.json.JSONObject;

public class HostedAccessSourceRouteTest extends TestCase {
    private static final String ORIGIN = "https://library.example.test";
    private static final String ID = "family%2Fnews";
    private static final RequestBody EMPTY = RequestBody.create(new byte[0], null);
    private HostedAccessSession session;
    private PairedCredentialStore store;

    @Override protected void setUp() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        store = new PairedCredentialStore(context);
        JSONObject pairing = new JSONObject().put("instanceId", "example-library");
        String record = store.saveRecord(HostedAccessSession.storageKey(ORIGIN), pairing);
        session = new HostedAccessSession(store, ORIGIN, pairing, record);
    }

    @Override protected void tearDown() {
        session.forget();
    }

    public void testLongReadTimeoutIsLimitedToPlaylistParsing() {
        assertEquals(310000, HostedApiRequest.clientForPath("/api/parse").readTimeoutMillis());
        for (String path : new String[]{"/api/parse-xml", "/api/xtream", "/api/v1/sources"})
            assertEquals(45000, HostedApiRequest.clientForPath(path).readTimeoutMillis());
    }

    public void testHeartbeatNewlinesAreRemovedBeforeTheBridgeCountsBytes() throws Exception {
        String json = "{\n\"url\":\"https://media.test/live?first=1&second=2\"}";
        String wireBody = "\n\n" + json;
        for (boolean heartbeat : new boolean[]{false, true}) {
            Response.Builder builder = new Response.Builder()
                .request(new Request.Builder().url(ORIGIN + "/library/api/parse").build())
                .protocol(Protocol.HTTP_1_1).code(200).message("OK")
                .body(ResponseBody.create(wireBody, null));
            if (heartbeat) builder.header("X-IPTVnator-JSON-Heartbeat", "1");
            try (Response response = builder.build()) {
                assertEquals(heartbeat ? json : wireBody,
                    Okio.buffer(Okio.source(HostedApiRequest.responseBody(response))).readUtf8());
            }
        }
    }

    public void testHeartbeatHasItsOwnByteLimit() throws Exception {
        String json = "{\"source\":\"Synthetic playlist\"}";
        String prefix = String.join("", java.util.Collections.nCopies(128, "\n"));
        for (boolean tooLarge : new boolean[]{false, true}) {
            try (Response response = new Response.Builder()
                    .request(new Request.Builder().url(ORIGIN + "/api/parse").build())
                    .protocol(Protocol.HTTP_1_1).code(200).message("OK")
                    .header("X-IPTVnator-JSON-Heartbeat", "1")
                    .body(ResponseBody.create(prefix + (tooLarge ? "\n" : "") + json, null))
                    .build()) {
                try {
                    assertEquals(json, Okio.buffer(Okio.source(HostedApiRequest.responseBody(response))).readUtf8());
                    assertFalse("An oversized heartbeat must be rejected", tooLarge);
                } catch (IOException error) {
                    assertTrue(tooLarge);
                    assertEquals("Hosted heartbeat is too large", error.getMessage());
                }
            }
        }
    }

    public void testXtreamHeartbeatUsesTheOrdinaryResponseBudget() throws Exception {
        String body = String.join("", java.util.Collections.nCopies(129, "\n")) + "{}";
        try (Response response = new Response.Builder()
                .request(new Request.Builder().url(ORIGIN + "/library/api/xtream").build())
                .protocol(Protocol.HTTP_1_1).code(200).message("OK")
                .header("X-IPTVnator-JSON-Heartbeat", "1")
                .body(ResponseBody.create(body, null)).build()) {
            assertEquals(body, Okio.buffer(Okio.source(HostedApiRequest.responseBody(response))).readUtf8());
        }
    }

    public void testSourceOperationsKeepEncodedIdOnThePairedHost() throws Exception {
        for (String method : new String[]{"GET", "PUT", "PATCH", "DELETE"})
            assertResource("sources/" + ID, method);
        for (String method : new String[]{"GET", "PUT", "DELETE"})
            assertResource("playlists/" + ID, method);
        assertResource("history/sources/" + ID, "GET");
        for (String path : new String[]{"favorites/sources/", "activity/sources/"}) {
            assertResource(path + ID, "GET");
            assertResource(path + ID + "/items?cursor=example", "GET");
        }
        assertResource("user-state/xtream-favorites/" + ID, "PUT");
        assertResource("user-state/xtream-recent-items/" + ID, "DELETE");
    }

    public void testEncodedSlashIsLimitedToSourceResourceParameters() throws Exception {
        assertUnlisted("app-state/view%2Fmode", "GET");
        assertUnlisted("history/sources/" + ID + "/items", "GET");
        assertUnlisted("user-state/group%2Fname/example", "PUT");
        assertUnlisted("activity/sources/" + ID, "POST");
    }

    public void testOpaqueSourceIdNamesKeepTheirSingleParameter() throws Exception {
        for (String id : new String[]{"news..archive", "family//news"}) {
            String encoded = android.net.Uri.encode(id);
            for (String method : new String[]{"GET", "PUT"}) {
                HttpUrl url = request("sources/" + encoded, method);
                assertEquals(ORIGIN + "/api/v1/sources/" + encoded, url.toString());
                assertEquals(java.util.Arrays.asList("api", "v1", "sources", id), url.pathSegments());
            }
            assertUnlisted("sources/" + encoded, "POST");
        }
        assertUnlisted("app-state/layout..preset", "GET");
        for (String method : new String[]{"GET", "PUT"})
            assertEquals(ORIGIN + "/api/v1/app-state/layout", request("app-state/layout", method).toString());
    }

    private HttpUrl request(String path, String method) throws Exception {
        JSONObject input = new JSONObject().put("path", "/api/v1/" + path).put("method", method);
        return session.call(input, "example-token", EMPTY).request().url();
    }

    private void assertResource(String path, String method) throws Exception {
        HttpUrl url = request(path, method);
        assertEquals(ORIGIN + "/api/v1/" + path, url.toString());
        assertTrue(url.pathSegments().contains("family/news"));
    }

    private void assertUnlisted(String path, String method) throws Exception {
        try {
            request(path, method);
            fail("Unexpected route: " + path);
        } catch (IOException expected) {
            assertEquals("Unsupported hosted request", expected.getMessage());
        }
    }
}
