package org.tvshell.iptvnator.ui;

import android.app.Instrumentation;
import android.content.Intent;
import android.os.SystemClock;
import androidx.test.platform.app.InstrumentationRegistry;
import fi.iki.elonen.NanoHTTPD;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import junit.framework.TestCase;
import org.tvshell.iptvnator.Prefs;

public class HostedLibraryDisconnectTest extends TestCase {
    public void testHostedPageCanDisconnectWithoutRemovingPairing() throws Exception {
        String token = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
        AtomicReference<NanoHTTPD.Response.Status> status = new AtomicReference<>(NanoHTTPD.Response.Status.OK);
        AtomicInteger redirected = new AtomicInteger();
        CountDownLatch opened = new CountDownLatch(1);
        NanoHTTPD host = new NanoHTTPD("127.0.0.1", 0) {
            @Override public Response serve(IHTTPSession request) {
                if ("/api/v1/instance".equals(request.getUri()))
                    return newFixedLengthResponse(Response.Status.OK, "application/json",
                        "{\"service\":\"iptvnator\",\"apiVersion\":1,\"storage\":\"server\"," +
                        "\"instanceId\":\"synthetic-library\",\"auth\":\"token\"}");
                if ("/api/v1/sources".equals(request.getUri())) {
                    boolean paired = ("Bearer " + token).equals(request.getHeaders().get("authorization"))
                        && "synthetic-library".equals(request.getHeaders().get("x-iptvnator-instance-id"));
                    Response response = newFixedLengthResponse(paired ? status.get() : Response.Status.BAD_REQUEST,
                        "application/json", "{}");
                    response.addHeader("Location", "/redirect-target");
                    return response;
                }
                if ("/redirect-target".equals(request.getUri())) redirected.incrementAndGet();
                if ("/".equals(request.getUri())) opened.countDown();
                return newFixedLengthResponse(Response.Status.OK, "text/html",
                    "<!doctype html><title>Synthetic TV library</title><script>" +
                    "onload=()=>window.__tvShell.disconnectLibrary()</script>");
            }
        };
        host.start();
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        Prefs prefs = new Prefs(instrumentation.getTargetContext());
        PairedCredentialStore credentials = new PairedCredentialStore(instrumentation.getTargetContext());
        String previousOrigin = prefs.hostedOrigin();
        Prefs.LayoutMode previousLayout = prefs.layoutMode();
        String origin = "http://127.0.0.1:" + host.getListeningPort();
        String instance = "synthetic-library";
        MainActivity main = null;
        try {
            credentials.saveOrdinaryPairing(origin, instance, token);
            prefs.setHostedOrigin(origin);
            prefs.setLayoutMode(Prefs.LayoutMode.TV);
            main = (MainActivity) instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(),
                MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            assertTrue("The hosted WebView did not open the fixture", opened.await(10, TimeUnit.SECONDS));
            long deadline = SystemClock.elapsedRealtime() + 8000;
            while (!prefs.hostedOrigin().isEmpty() && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(50);
            assertEquals("Disconnect did not select the bundled library", "", prefs.hostedOrigin());
            assertEquals(token, credentials.read(origin, instance));
            assertEquals("The existing pairing should reconnect", 0, HostedConnection.probeSavedLibrary(main, origin, () -> true));
            status.set(NanoHTTPD.Response.Status.FORBIDDEN);
            assertEquals("A denied pairing needs a new claim", HostedConnection.PAIR_AGAIN,
                HostedConnection.probeSavedLibrary(main, origin, () -> true));
            status.set(NanoHTTPD.Response.Status.REDIRECT);
            assertEquals("A verification redirect is a connection failure", org.tvshell.iptvnator.R.string.connection_failed,
                HostedConnection.probeSavedLibrary(main, origin, () -> true));
            assertEquals("Credential verification followed a redirect", 0, redirected.get());
        } finally {
            if (main != null) instrumentation.runOnMainSync(main::finish);
            prefs.setLayoutMode(previousLayout);
            prefs.setHostedOrigin(previousOrigin);
            credentials.remove(origin);
            host.stop();
        }
    }
}
