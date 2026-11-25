package org.tvshell.iptvnator.ui;

import androidx.test.platform.app.InstrumentationRegistry;
import fi.iki.elonen.NanoHTTPD;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicInteger;
import junit.framework.TestCase;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.json.JSONObject;

public class NasLibrarySessionTest extends TestCase {
    private static final String INVENTORY = "{\"entries\":[{\"source\":{\"id\":\"synthetic-source\",\"kind\":\"m3u-url\"},\"revision\":\"synthetic-revision\"}]}";
    private static final String TOKEN = "synthetic-nas-token";
    private static final RequestBody EMPTY = RequestBody.create(new byte[0], null);
    private final AtomicInteger inventoryReads = new AtomicInteger();
    private final AtomicInteger credentialLeaks = new AtomicInteger();
    private String base;
    private PairedCredentialStore store;
    private NanoHTTPD server;
    private volatile String instance = "synthetic-library";
    private volatile boolean protectedLibrary = true;

    @Override protected void setUp() throws Exception {
        store = new PairedCredentialStore(InstrumentationRegistry.getInstrumentation().getTargetContext());
        server = new NanoHTTPD("127.0.0.1", 0) {
            @Override public Response serve(IHTTPSession request) {
                String bearer = request.getHeaders().get("authorization");
                if (request.getUri().endsWith("/api/v1/instance")) {
                    if (bearer != null || request.getHeaders().containsKey("x-iptvnator-instance-id"))
                        credentialLeaks.incrementAndGet();
                    return newFixedLengthResponse(Response.Status.OK, "application/json",
                        "{\"service\":\"iptvnator\",\"apiVersion\":1,\"storage\":\"server\",\"instanceId\":\"" + instance
                        + "\",\"auth\":\"" + (protectedLibrary ? "token" : "none") + "\",\"capabilities\":[\"sources-v1\"]}");
                }
                if (!request.getUri().equals("/library/nas/api/v1/sources")) {
                    if (bearer != null) credentialLeaks.incrementAndGet();
                    return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "");
                }
                if (protectedLibrary && !("Bearer " + TOKEN).equals(bearer))
                    return newFixedLengthResponse(Response.Status.UNAUTHORIZED, "application/json", "{}");
                if (!protectedLibrary && bearer != null || !instance.equals(request.getHeaders().get("x-iptvnator-instance-id")))
                    credentialLeaks.incrementAndGet();
                inventoryReads.incrementAndGet();
                return newFixedLengthResponse(Response.Status.OK, "application/json", INVENTORY);
            }
        };
        server.start();
        base = "http://127.0.0.1:" + server.getListeningPort() + "/library/nas";
    }

    @Override protected void tearDown() {
        try {
            store.remove(NasLibrarySession.storageKey(base));
            assertEquals("Credential sent outside its verified endpoint", 0, credentialLeaks.get());
        } finally { server.stop(); }
    }

    public void testProtectedLibraryReconnectsAndReadsAfterColdLoad() throws Exception {
        connect(TOKEN).save(store);
        assertEquals(1, inventoryReads.get());
        connect("");
        NasLibrarySession restored = NasLibrarySession.load(store, base);
        assertNotNull(restored);
        try (Response response = inventory(restored)) {
            assertEquals(INVENTORY, response.body().string());
        }
        assertEquals(3, inventoryReads.get());
        // A failed renewal cannot replace a working credential.
        try {
            connect("synthetic-invalid");
            fail("Incorrect token accepted");
        } catch (NasLibrarySession.AuthenticationRequired expected) {}
        connect("");
        instance = "replacement-instance";
        try {
            inventory(NasLibrarySession.load(store, base)).close();
            fail("Sent a saved credential to a replacement library");
        } catch (IOException expected) {}
        try {
            connect("");
            fail("Reused old instance token");
        } catch (NasLibrarySession.AuthenticationRequired expected) {}
        assertEquals(4, inventoryReads.get());
        try {
            NasLibrarySession.connect(store, base + "/other/api", "", () -> true);
            fail("Reused old prefix token");
        } catch (NasLibrarySession.AuthenticationRequired expected) {}
    }

    public void testOpenLibraryIgnoresPreviouslySavedToken() throws Exception {
        NasLibrarySession library = connect(TOKEN);
        library.save(store);
        protectedLibrary = false;
        JSONObject discovery = new JSONObject().put("path", "/api/v1/instance").put("method", "GET");
        try (Response metadata = library.call(discovery, EMPTY).execute()) {
            library.observe(discovery, metadata);
            assertTrue(metadata.body().string().contains("sources-v1"));
        }
        try (Response response = inventory(library)) { assertEquals(200, response.code()); }
        connect("").save(store);
        try (Response response = inventory(NasLibrarySession.load(store, base))) {
            assertEquals(200, response.code());
        }
        assertEquals(4, inventoryReads.get());
    }

    private NasLibrarySession connect(String token) throws Exception {
        return NasLibrarySession.connect(store, base + "/api", token, () -> true);
    }

    private Response inventory(NasLibrarySession library) throws Exception {
        JSONObject request = new JSONObject().put("path", "/api/v1/sources").put("method", "GET");
        return library.call(request, EMPTY).execute();
    }
}
