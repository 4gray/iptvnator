package org.tvshell.iptvnator.ui;

import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import androidx.test.platform.app.InstrumentationRegistry;
import fi.iki.elonen.NanoHTTPD;
import java.io.IOException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import junit.framework.TestCase;
import org.json.JSONObject;

public class HostedPairingRaceTest extends TestCase {
    public void testOrdinaryPairingSupersedesAnAccessAttemptAcrossActivities() {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        Intent intent = new Intent(instrumentation.getTargetContext(), SettingsActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        SettingsActivity settings = (SettingsActivity) instrumentation.startActivitySync(intent);
        PairingAttempts access = new PairingAttempts();
        HostedPairingFlow.AccessSignIn signIn = access::cancel;
        instrumentation.runOnMainSync(() -> {
            HostedPairingFlow ordinary = new HostedPairingFlow(settings);
            HostedPairingFlow.registerAccessSignIn(signIn);
            try {
                String origin = "http://127.0.0.1:1";
                long manual = access.begin();
                ordinary.start(origin, "", () -> {});
                assertFalse("Manual confirmation left the old sign-in active", access.active(manual));
                long tv = access.begin();
                ordinary.start(origin, "");
                assertFalse("TV pairing left the old sign-in active", access.active(tv));
                long scanned = access.begin();
                ordinary.confirmInvite(PairingLink.scannedInvite(origin + "/pair-device#"
                    + "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ"));
                assertFalse("Scanned invitation left the old sign-in active", access.active(scanned));
            } finally {
                ordinary.cancel();
                signIn.cancel();
                HostedPairingFlow.registerAccessSignIn(null);
                settings.finish();
            }
        });
    }

    public void testRemovedSessionCannotUseCachedTokenOrForgetReplacement() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String origin = "https://library.example";
        String key = HostedAccessSession.storageKey(origin);
        PairedCredentialStore store = new PairedCredentialStore(context);
        JSONObject record = new JSONObject().put("instanceId", "synthetic-instance")
            .put("accessToken", "synthetic-original").put("expiresAt", Long.MAX_VALUE);
        try {
            store.saveRecord(key, record);
            HostedAccessSession old = HostedAccessSession.load(context, origin);
            assertEquals("synthetic-original", old.accessToken(null));
            assertTrue(store.remove(key));
            store.saveRecord(key, record.put("accessToken", "synthetic-replacement"));
            try {
                old.accessToken(null);
                fail("Removed session returned cached credentials");
            } catch (IOException expected) { }
            assertFalse("Stale revocation removed new credentials", old.forget());
            assertEquals("synthetic-replacement", HostedAccessSession.load(context, origin).accessToken(null));
        } finally {
            store.remove(key);
        }
    }

    public void testApprovedOrdinaryPairingReplacesOnlyTheSameOriginsAccessSession() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        PairedCredentialStore store = new PairedCredentialStore(context);
        String origin = "https://switch.example.test";
        String accessKey = HostedAccessSession.storageKey(origin);
        String otherKey = HostedAccessSession.storageKey("https://other.example.test");
        String instance = "synthetic-library";
        String token = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
        JSONObject previous = new JSONObject().put("instanceId", instance)
            .put("accessToken", "synthetic-access").put("expiresAt", Long.MAX_VALUE);
        try {
            String deviceKey = store.accessDeviceKey(origin);
            String oldRecord = store.saveRecord(accessKey, previous);
            String otherRecord = store.saveRecord(otherKey, previous);
            HostedAccessSession oldSession = HostedAccessSession.load(context, origin);
            try {
                store.saveOrdinaryPairing(origin, instance, "invalid");
                fail("An invalid ordinary credential was accepted");
            } catch (IllegalArgumentException expected) { }
            assertEquals("synthetic-access", oldSession.accessToken(null));

            store.saveOrdinaryPairing(origin, instance, token);
            assertNull("Opening the library still selects Cloudflare", HostedAccessSession.load(context, origin));
            assertEquals(token, store.read(origin, instance));
            assertEquals(otherRecord, store.encryptedRecord(otherKey));
            assertEquals(deviceKey, store.accessDeviceKey(origin));
            assertFalse("Old revocation affected the new pairing", oldSession.forget());
            try {
                store.replaceRecord(accessKey, oldRecord, previous);
                fail("A stale refresh restored the superseded Access session");
            } catch (IOException expected) { }
            assertEquals(token, store.read(origin, instance));
        } finally {
            store.remove(origin, accessKey, otherKey, "cloudflare-device:" + origin);
        }
    }

    public void testRefreshFinishingAfterRemovalCannotRestorePairing() throws Exception {
        checkRefresh(true);
    }

    public void testIndependentSessionsShareOneRefreshOfTheSamePairing() throws Exception {
        checkRefresh(false);
    }

    private void checkRefresh(boolean removeWhileRefreshing) throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String origin = "https://library.example";
        String key = HostedAccessSession.storageKey(origin);
        PairedCredentialStore store = new PairedCredentialStore(context);
        CountDownLatch requested = new CountDownLatch(1);
        CountDownLatch respond = new CountDownLatch(1);
        AtomicInteger renewals = new AtomicInteger();
        CountDownLatch duplicate = new CountDownLatch(1);
        NanoHTTPD server = new NanoHTTPD("127.0.0.1", 0) {
            @Override public Response serve(IHTTPSession request) {
                if (renewals.incrementAndGet() > 1) duplicate.countDown();
                requested.countDown();
                try {
                    if (!respond.await(10, TimeUnit.SECONDS)) throw new AssertionError("Refresh not released");
                } catch (InterruptedException e) { throw new AssertionError(e); }
                return newFixedLengthResponse(Response.Status.OK, "application/json",
                    "{\"access_token\":\"synthetic-renewed\",\"refresh_token\":\"synthetic-rotated\",\"expires_in\":900}");
            }
        };
        server.start();
        try {
            store.saveRecord(key, new JSONObject().put("instanceId", "synthetic-instance")
                .put("accessToken", "synthetic-expired").put("refreshToken", "synthetic-refresh")
                .put("expiresAt", 0).put("clientId", "synthetic-client").put("resource", origin)
                .put("tokenEndpoint", "http://127.0.0.1:" + server.getListeningPort() + "/token"));
            HostedAccessSession session = HostedAccessSession.load(context, origin);
            HostedAccessSession probe = HostedAccessSession.load(context, origin);
            FutureTask<Boolean> refreshed = new FutureTask<>(() -> {
                try { session.accessToken(null); return true; }
                catch (IOException changed) { return false; }
            });
            new Thread(refreshed).start();
            assertTrue("Refresh did not start", requested.await(10, TimeUnit.SECONDS));
            CountDownLatch probing = new CountDownLatch(1);
            FutureTask<String> probed = new FutureTask<>(() -> {
                probing.countDown();
                return probe.accessToken("synthetic-expired");
            });
            if (removeWhileRefreshing) {
                assertTrue(new PairedCredentialStore(context).remove(key));
            } else {
                new Thread(probed).start();
                assertTrue(probing.await(10, TimeUnit.SECONDS));
                assertFalse("Both sessions sent the same refresh token", duplicate.await(1, TimeUnit.SECONDS));
            }
            respond.countDown();
            assertEquals(!removeWhileRefreshing, refreshed.get(10, TimeUnit.SECONDS).booleanValue());
            assertEquals(!removeWhileRefreshing, store.contains(key));
            if (!removeWhileRefreshing) {
                assertEquals("synthetic-renewed", probed.get(10, TimeUnit.SECONDS));
                assertEquals("synthetic-rotated", store.readRecord(key).getString("refreshToken"));
                assertEquals(1, renewals.get());
            }
        } finally {
            respond.countDown();
            server.stop();
            store.remove(key);
        }
    }
}
