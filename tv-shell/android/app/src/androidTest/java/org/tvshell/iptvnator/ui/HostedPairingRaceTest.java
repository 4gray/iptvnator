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

    public void testRefreshFinishingAfterRemovalCannotRestorePairing() throws Exception {
        checkRefresh(true);
    }

    public void testIndependentSessionCanUseANewerRefreshOfTheSamePairing() throws Exception {
        checkRefresh(false);
    }

    private void checkRefresh(boolean removeWhileRefreshing) throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String origin = "https://library.example";
        String key = HostedAccessSession.storageKey(origin);
        PairedCredentialStore store = new PairedCredentialStore(context);
        CountDownLatch requested = new CountDownLatch(1);
        CountDownLatch respond = new CountDownLatch(1);
        NanoHTTPD server = new NanoHTTPD("127.0.0.1", 0) {
            @Override public Response serve(IHTTPSession request) {
                requested.countDown();
                try {
                    if (!respond.await(10, TimeUnit.SECONDS)) throw new AssertionError("Refresh not released");
                } catch (InterruptedException e) { throw new AssertionError(e); }
                return newFixedLengthResponse(Response.Status.OK, "application/json",
                    "{\"access_token\":\"synthetic-renewed\",\"expires_in\":900}");
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
            if (removeWhileRefreshing) assertTrue(new PairedCredentialStore(context).remove(key));
            respond.countDown();
            assertEquals(!removeWhileRefreshing, refreshed.get(10, TimeUnit.SECONDS).booleanValue());
            assertEquals(!removeWhileRefreshing, store.contains(key));
            if (!removeWhileRefreshing) assertEquals("synthetic-renewed", probe.accessToken(null));
        } finally {
            respond.countDown();
            server.stop();
            store.remove(key);
        }
    }
}
