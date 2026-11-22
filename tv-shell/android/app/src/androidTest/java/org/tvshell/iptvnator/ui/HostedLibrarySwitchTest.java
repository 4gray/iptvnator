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

    private static final String STALE_TOKEN = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefg";
    private enum Pairing { VALID, NEW, REVOKED, UNAVAILABLE, CANCELLED }

    public void testHostedOriginChecksAnotherPairedLibraryOnlyWithConsent() throws Exception {
        switchLibrary(Pairing.VALID);
    }

    public void testHostedOriginPairsWithANewLibrary() throws Exception {
        switchLibrary(Pairing.NEW);
    }

    public void testRevokedDestinationRequiresFreshApproval() throws Exception {
        switchLibrary(Pairing.REVOKED);
    }

    public void testUnavailableDestinationKeepsCurrentLibrary() throws Exception {
        switchLibrary(Pairing.UNAVAILABLE);
    }

    public void testCancellingRejectedCredentialCheckDoesNotStartPairing() throws Exception {
        switchLibrary(Pairing.CANCELLED);
    }

    private void switchLibrary(Pairing pairing) throws Exception {
        String savedCredential = pairing == Pairing.REVOKED || pairing == Pairing.CANCELLED ? STALE_TOKEN : TOKEN_B;
        CountDownLatch checking = new CountDownLatch(1), releaseCheck = new CountDownLatch(1);
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
                if ("/api/v1/sources".equals(request.getUri())) {
                    if (!("Bearer " + savedCredential).equals(request.getHeaders().get("authorization"))
                        || !"synthetic-b".equals(request.getHeaders().get("x-iptvnator-instance-id")))
                        return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "Wrong credential scope");
                    checking.countDown();
                    if (pairing == Pairing.CANCELLED) {
                        try { releaseCheck.await(15, TimeUnit.SECONDS); }
                        catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                    }
                    Response.Status status = pairing == Pairing.REVOKED ? Response.Status.UNAUTHORIZED
                        : pairing == Pairing.CANCELLED ? Response.Status.FORBIDDEN
                        : pairing == Pairing.UNAVAILABLE ? Response.Status.SERVICE_UNAVAILABLE : Response.Status.OK;
                    return newFixedLengthResponse(status, "application/json", "{\"entries\":[]}");
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
            if (pairing != Pairing.NEW) store.saveOrdinaryPairing(target, "synthetic-b", savedCredential);
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
            if (pairing != Pairing.NEW)
                assertTrue("The saved credential was not checked", checking.await(8, TimeUnit.SECONDS));
            if (pairing == Pairing.UNAVAILABLE || pairing == Pairing.CANCELLED) {
                if (pairing == Pairing.CANCELLED) {
                    Thread worker = Thread.getAllStackTraces().keySet().stream()
                        .filter(thread -> "hosted-device-start".equals(thread.getName())).findFirst().get();
                    tapDialog(instrumentation, context.getString(R.string.connection_checking),
                        context.getString(R.string.external_prompt_cancel));
                    instrumentation.waitForIdleSync();
                    releaseCheck.countDown();
                    worker.join(8000);
                    assertFalse("Cancelled verification did not finish", worker.isAlive());
                } else {
                    tapDialog(instrumentation, context.getString(R.string.pairing_tv_failed), context.getString(android.R.string.ok));
                }
                assertEquals("A failed or cancelled verification switched libraries", origin, prefs.hostedOrigin());
                assertEquals(0, starts.get());
                assertEquals(savedCredential, store.read(target, "synthetic-b"));
                return;
            }
            int expectedClaims = pairing == Pairing.VALID ? 0 : 1;
            boolean loaded = opened.await(10, TimeUnit.SECONDS);
            assertEquals("Pairing starts", expectedClaims, starts.get());
            assertEquals("Approved pairing completions", expectedClaims, completions.get());
            assertTrue("The destination document did not open", loaded);
            assertEquals(target, prefs.hostedOrigin());
            assertEquals(TOKEN_A, store.read(origin, "synthetic-a"));
            assertEquals(TOKEN_B, store.read(target, "synthetic-b"));
        } finally {
            releaseCheck.countDown();
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
