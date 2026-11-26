package org.tvshell.iptvnator.ui;

import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.webkit.WebViewCompat;
import fi.iki.elonen.NanoHTTPD;
import java.util.Collections;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;
import junit.framework.TestCase;
import org.tvshell.iptvnator.Prefs;
import org.tvshell.iptvnator.R;

/** Keep Angular's splash until the test releases it so the real ready bridge stays pending. */
public class LibraryStartupWatchdogTest extends TestCase {
    private final CountDownLatch remoteOpened = new CountDownLatch(1);
    private Instrumentation instrumentation;
    private MainActivity main;
    private WebView view;
    private NanoHTTPD host;
    private String origin;
    private PairedCredentialStore credentials;
    private Prefs prefs;
    private String previousOrigin;
    private boolean previousNas;

    @Override protected void setUp() throws Exception {
        instrumentation = InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        prefs = new Prefs(context);
        credentials = new PairedCredentialStore(context);
        previousOrigin = prefs.hostedOrigin();
        previousNas = prefs.usesNasLibrary();
        host = new NanoHTTPD("127.0.0.1", 0) {
            @Override public Response serve(IHTTPSession request) {
                if ("/api/v1/instance".equals(request.getUri()))
                    return newFixedLengthResponse(Response.Status.OK, "application/json",
                        "{\"service\":\"iptvnator\",\"apiVersion\":1,\"storage\":\"server\","
                        + "\"instanceId\":\"synthetic-watchdog\",\"auth\":\"none\",\"capabilities\":[\"sources-v1\"]}");
                if ("/api/v1/sources".equals(request.getUri()))
                    return newFixedLengthResponse(Response.Status.OK, "application/json", "{\"entries\":[]}");
                remoteOpened.countDown();
                return newFixedLengthResponse(Response.Status.OK, "text/html",
                    "<!doctype html><div id='initial-splash'>Synthetic startup</div>");
            }
        };
        host.start();
        origin = "http://127.0.0.1:" + host.getListeningPort();
        prefs.setHostedOrigin("");
        main = (MainActivity) instrumentation.startActivitySync(new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        instrumentation.runOnMainSync(() -> view = (WebView) ((ViewGroup) main.findViewById(R.id.root)).getChildAt(0));
        awaitUi("Local WebView did not become ready", 30000, this::ready);
    }

    @Override protected void tearDown() {
        try {
            if (main != null) instrumentation.runOnMainSync(main::finish);
            if (previousNas) prefs.setNasLibrary(previousOrigin);
            else prefs.setHostedOrigin(previousOrigin);
            credentials.remove(NasLibrarySession.storageKey(origin));
        } finally { host.stop(); }
    }

    public void testSlowPackagedNasBecomesReadyOnItsSelectedOrigin() throws Exception {
        NasLibrarySession nas = NasLibrarySession.connect(credentials, origin + "/api", "", () -> true);
        nas.save(credentials);
        CountDownLatch held = new CountDownLatch(1);
        instrumentation.runOnMainSync(() -> {
            WebViewCompat.addWebMessageListener(view, "TestStartup", Collections.singleton(nas.uiOrigin),
                (v, message, source, mainFrame, reply) -> {
                    if (mainFrame && "held".equals(message.getData())) held.countDown();
                });
            WebViewCompat.addDocumentStartJavaScript(view,
                "const removeSplash = Element.prototype.remove; Element.prototype.remove = function() {"
                + "if (this.id !== 'initial-splash') return removeSplash.call(this);"
                + "window.releaseTestSplash = () => removeSplash.call(this); TestStartup.postMessage('held'); };",
                Collections.singleton(nas.uiOrigin));
            prefs.setNasLibrary(origin);
            main.reloadPairedLibrary();
        });
        assertTrue("Angular did not reach its first paint", held.await(25, TimeUnit.SECONDS));
        SystemClock.sleep(9500); // Cross the ordinary hosted document's 8-second deadline.
        instrumentation.runOnMainSync(() -> {
            assertTrue("Packaged NAS was replaced by the offline local library before ready",
                HostedOrigin.sameOrigin(nas.uiOrigin, view.getUrl()));
            assertEquals(View.VISIBLE, main.findViewById(R.id.splash).getVisibility());
            view.evaluateJavascript("window.releaseTestSplash()", null);
        });
        awaitUi("NAS did not finish on the selected origin", 8000,
            () -> HostedOrigin.sameOrigin(nas.uiOrigin, view.getUrl()) && ready());
        assertTrue(prefs.usesNasLibrary());
        assertEquals(origin, prefs.hostedOrigin());
    }

    public void testUnreadyRemoteDocumentFallsBackToTheLocalLibrary() throws Exception {
        long loading = SystemClock.elapsedRealtime();
        instrumentation.runOnMainSync(() -> {
            prefs.setHostedOrigin(origin);
            main.reloadPairedLibrary();
        });
        assertTrue("Remote document did not open", remoteOpened.await(10, TimeUnit.SECONDS));
        awaitUi("Remote document did not commit", 5000, () -> HostedOrigin.sameOrigin(origin, view.getUrl()));
        awaitUi("Unready remote document did not fall back within the hosted startup budget", 16000,
            () -> view.getUrl() != null && view.getUrl().startsWith("http://127.0.0.1:")
                && !HostedOrigin.sameOrigin(origin, view.getUrl()));
        assertTrue("Remote document was abandoned before the hosted startup budget", SystemClock.elapsedRealtime() - loading >= 7500);
        assertEquals("Keep the saved address for reconnect", origin, prefs.hostedOrigin());
    }

    private boolean ready() {
        return main.findViewById(R.id.splash).getVisibility() == View.GONE
            && main.findViewById(R.id.error_panel).getVisibility() == View.GONE;
    }

    private void awaitUi(String failure, int timeout, BooleanSupplier check) {
        long deadline = SystemClock.elapsedRealtime() + timeout;
        AtomicBoolean satisfied = new AtomicBoolean();
        do {
            instrumentation.runOnMainSync(() -> satisfied.set(check.getAsBoolean()));
            if (satisfied.get()) return;
            SystemClock.sleep(100);
        } while (SystemClock.elapsedRealtime() < deadline);
        fail(failure);
    }
}
