package org.tvshell.iptvnator.ui;

import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.platform.app.InstrumentationRegistry;
import fi.iki.elonen.NanoHTTPD;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import junit.framework.TestCase;
import org.json.JSONObject;
import org.tvshell.iptvnator.Prefs;
import org.tvshell.iptvnator.R;

public class HostedLibrarySwitchTest extends TestCase {
    private static final String CLAIM_ID = "synthetic_claim_identifier_1234567890abcdef";
    private static final String CLAIM_SECRET = "synthetic_claim_secret_1234567890abcdefghij";
    private static final String TOKEN_A = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
    private static final String TOKEN_B = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq";

    public void testHostedOriginChecksAnotherPairedLibraryOnlyWithConsent() throws Exception {
        switchLibrary(true);
    }

    public void testHostedOriginPairsWithANewLibrary() throws Exception {
        switchLibrary(false);
    }

    private void switchLibrary(boolean previouslyPaired) throws Exception {
        AtomicInteger probes = new AtomicInteger(), starts = new AtomicInteger(), completions = new AtomicInteger();
        CountDownLatch opened = new CountDownLatch(1), declined = new CountDownLatch(1), pairedKind = new CountDownLatch(1);
        NanoHTTPD destination = new NanoHTTPD("127.0.0.1", 0) {
            @Override public Response serve(IHTTPSession request) {
                if ("/api/v1/instance".equals(request.getUri())) {
                    probes.incrementAndGet();
                    if (request.getHeaders().containsKey("authorization") || request.getHeaders().containsKey("cookie"))
                        return newFixedLengthResponse(Response.Status.FORBIDDEN, "text/plain", "Unexpected credentials");
                    return newFixedLengthResponse(Response.Status.OK, "application/json",
                        "{\"service\":\"iptvnator\",\"apiVersion\":1,\"storage\":\"server\",\"instanceId\":\"synthetic-b\","
                        + "\"auth\":\"token\",\"capabilities\":[\"sources-v1\",\"browser-pairing-v1\"]}");
                }
                if (request.getMethod() == Method.POST) {
                    // NanoHTTPD leaves unread bodies on the socket between keep-alive requests.
                    Map<String, String> files = new HashMap<>();
                    try {
                        request.parseBody(files);
                        JSONObject body = new JSONObject(files.get("postData"));
                        if ("/api/v1/device-pairing/start".equals(request.getUri()) && body.has("name")) {
                            starts.incrementAndGet();
                            return newFixedLengthResponse(Response.Status.OK, "application/json",
                                new JSONObject().put("claimId", CLAIM_ID).put("claimSecret", CLAIM_SECRET)
                                    .put("confirmationCode", "123456").toString());
                        }
                        if ("/api/v1/device-pairing/complete".equals(request.getUri())
                                && CLAIM_ID.equals(body.optString("claimId")) && CLAIM_SECRET.equals(body.optString("claimSecret"))) {
                            completions.incrementAndGet();
                            return newFixedLengthResponse(Response.Status.OK, "application/json",
                                new JSONObject().put("status", "approved").put("instanceId", "synthetic-b")
                                    .put("token", TOKEN_B).toString());
                        }
                    } catch (Exception invalid) { /* Reject malformed fixture requests. */ }
                    return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "Invalid pairing request");
                }
                if ("/".equals(request.getUri())) opened.countDown();
                return newFixedLengthResponse("Synthetic destination");
            }
        };
        destination.start();
        String target = "http://127.0.0.1:" + destination.getListeningPort();
        NanoHTTPD source = new NanoHTTPD("127.0.0.1", 0) {
            @Override public Response serve(IHTTPSession request) {
                if ("/declined".equals(request.getUri())) declined.countDown();
                if ("/kind/pair".equals(request.getUri())) pairedKind.countDown();
                return newFixedLengthResponse(Response.Status.OK, "text/html",
                    "<!doctype html><title>Synthetic source</title><script>onload=async()=>{"
                    + "const b='" + target + "', inspect=()=>__tvShell.inspectServer(b+'/api');"
                    + "if(await inspect()!=='unknown')return; await fetch('/declined');" // the user declines the first request
                    + "const kind=await inspect(); await fetch('/kind/'+kind);"
                    + "if(kind==='pair')__tvShell.pairLibrary(b,'');};</script>");
            }
        };
        source.start();
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        Prefs prefs = new Prefs(context);
        PairedCredentialStore store = new PairedCredentialStore(context);
        String previous = prefs.hostedOrigin(), origin = "http://127.0.0.1:" + source.getListeningPort();
        boolean previousNas = prefs.usesNasLibrary();
        Prefs.LayoutMode layout = prefs.layoutMode();
        MainActivity main = null;
        try {
            store.saveOrdinaryPairing(origin, "synthetic-a", TOKEN_A);
            if (previouslyPaired) store.saveOrdinaryPairing(target, "synthetic-b", TOKEN_B);
            prefs.setHostedOrigin(origin);
            prefs.setLayoutMode(Prefs.LayoutMode.TOUCH);
            main = (MainActivity) instrumentation.startActivitySync(new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            tapDialog(instrumentation, target, context.getString(android.R.string.cancel));
            assertTrue("Cancellation did not resolve inspection", declined.await(10, TimeUnit.SECONDS));
            tapDialog(instrumentation, target, context.getString(R.string.pairing_continue), () -> {
                assertEquals("The destination was contacted without confirmation", 0, probes.get());
                assertEquals(origin, prefs.hostedOrigin());
            });
            assertTrue("The source did not receive the public pairing capability",
                pairedKind.await(10, TimeUnit.SECONDS));
            assertEquals(origin, prefs.hostedOrigin());
            tapDialog(instrumentation, target, context.getString(R.string.pairing_continue));
            boolean loaded = opened.await(10, TimeUnit.SECONDS);
            assertEquals("Pairing starts", previouslyPaired ? 0 : 1, starts.get());
            assertEquals("Approved pairing completions", previouslyPaired ? 0 : 1, completions.get());
            assertTrue("The destination document did not open", loaded);
            assertEquals(target, prefs.hostedOrigin());
            assertEquals(TOKEN_A, store.read(origin, "synthetic-a"));
            assertEquals(TOKEN_B, store.read(target, "synthetic-b"));
        } finally {
            if (main != null) instrumentation.runOnMainSync(main::finish);
            if (previousNas) prefs.setNasLibrary(previous);
            else prefs.setHostedOrigin(previous);
            prefs.setLayoutMode(layout);
            store.remove(origin, target);
            source.stop();
            destination.stop();
        }
    }

    private void tapDialog(Instrumentation instrumentation, String address, String button) {
        tapDialog(instrumentation, address, button, () -> {});
    }

    private void tapDialog(Instrumentation instrumentation, String address, String button, Runnable beforeTap) {
        long deadline = SystemClock.elapsedRealtime() + 10000;
        while (SystemClock.elapsedRealtime() < deadline) {
            AccessibilityNodeInfo root = instrumentation.getUiAutomation().getRootInActiveWindow();
            if (root != null && !root.findAccessibilityNodeInfosByText(address).isEmpty()) {
                for (AccessibilityNodeInfo node : root.findAccessibilityNodeInfosByText(button)) {
                    if (node.isClickable() && button.equalsIgnoreCase(String.valueOf(node.getText()))) {
                        beforeTap.run();
                        if (node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return;
                    }
                }
            }
            SystemClock.sleep(50);
        }
        fail("Native confirmation missing for the selected destination");
    }
}
