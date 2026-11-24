package org.tvshell.iptvnator.ui;

import android.app.Instrumentation;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.test.platform.app.InstrumentationRegistry;
import junit.framework.TestCase;
import org.json.JSONObject;

public class HostedAccessCallbackTest extends TestCase {
    private static final String PENDING = HostedAccessOAuth.PENDING_KEY;
    private static final String STATE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
    private static final String VERIFIER = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq";
    private Instrumentation instrumentation;
    private Context context;
    private PairedCredentialStore store;

    @Override protected void setUp() {
        instrumentation = InstrumentationRegistry.getInstrumentation();
        context = instrumentation.getTargetContext();
        store = new PairedCredentialStore(context);
    }

    @Override protected void tearDown() { store.remove(PENDING); }

    private void prepare(String state, long expiresAt) throws Exception {
        store.saveRecord(PENDING, new JSONObject().put("origin", "https://library.example.test")
            .put("instance", "example-instance").put("invite", "").put("tokenEndpoint", "https://library.example.test/token")
            .put("client", "example-client").put("state", state).put("verifier", VERIFIER).put("expiresAt", expiresAt));
    }

    private Intent callback(String state) {
        return new Intent(Intent.ACTION_VIEW, Uri.parse(HostedAccessOAuth.CALLBACK
            + "?state=" + state + "&error=access_denied"), context, MainActivity.class);
    }

    public void testColdStartConsumesOnlyMatchingPendingCallback() throws Exception {
        prepare(STATE, System.currentTimeMillis() + 120_000);
        MainActivity activity = launch(callback(STATE));
        try {
            assertFalse("Cold-start callback left the authorization attempt unused", store.contains(PENDING));
        } finally { instrumentation.runOnMainSync(activity::finish); }
    }

    private MainActivity launch(Intent intent) {
        return (MainActivity) instrumentation.startActivitySync(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }

    public void testRecreationKeepsPendingCallbackAndIgnoresOlderState() throws Exception {
        prepare(STATE, System.currentTimeMillis() + 120_000);
        MainActivity initial = launch(new Intent(context, MainActivity.class));
        Instrumentation.ActivityMonitor monitor = instrumentation.addMonitor(MainActivity.class.getName(), null, false);
        instrumentation.runOnMainSync(initial::recreate);
        MainActivity recreated = (MainActivity) instrumentation.waitForMonitorWithTimeout(monitor, 10_000);
        assertNotNull(recreated);
        try {
            instrumentation.runOnMainSync(() -> recreated.onNewIntent(callback(VERIFIER)));
            assertTrue("Different callback removed the current sign-in", store.contains(PENDING));
            instrumentation.runOnMainSync(() -> recreated.onNewIntent(callback(STATE)));
            assertFalse("Recreated Activity lost its authorization state", store.contains(PENDING));
        } finally { instrumentation.runOnMainSync(recreated::finish); }
    }

    public void testAuthTabResultDeliveredAfterRecreatingItsCaller() throws Exception {
        prepare(STATE, System.currentTimeMillis() + 120_000);
        String launcher = HostedAccessOAuth.restorePending(store).launcherKey();
        MainActivity initial = launch(new Intent(context, MainActivity.class));
        Instrumentation.ActivityMonitor tab = instrumentation.addMonitor(SettingsActivity.class.getName(), null, false);
        instrumentation.runOnMainSync(() -> initial.getActivityResultRegistry().register(launcher,
            new ActivityResultContracts.StartActivityForResult(), ignored -> {}).launch(new Intent(context, SettingsActivity.class)));
        Activity browser = instrumentation.waitForMonitorWithTimeout(tab, 10_000);
        assertNotNull(browser);
        Instrumentation.ActivityMonitor caller = instrumentation.addMonitor(MainActivity.class.getName(), null, false);
        instrumentation.runOnMainSync(initial::recreate);
        instrumentation.runOnMainSync(() -> {
            browser.setResult(Activity.RESULT_OK, callback(STATE));
            browser.finish();
        });
        MainActivity recreated = (MainActivity) instrumentation.waitForMonitorWithTimeout(caller, 10_000);
        assertNotNull(recreated);
        try {
            instrumentation.waitForIdleSync();
            assertFalse("Restored activity-result launcher did not claim its callback", store.contains(PENDING));
        } finally { instrumentation.runOnMainSync(recreated::finish); }
    }

    public void testEncryptedAttemptRestoresPkceAndCanOnlyBeConsumedOnce() throws Exception {
        prepare(STATE, System.currentTimeMillis() + 120_000);
        HostedAccessOAuth first = HostedAccessOAuth.restorePending(store);
        HostedAccessOAuth duplicate = HostedAccessOAuth.restorePending(new PairedCredentialStore(context));
        assertEquals(first.launcherKey(), duplicate.launcherKey());
        assertFalse(first.launcherKey().contains(STATE));
        first.savePending(store);
        assertEquals(VERIFIER, store.readRecord(PENDING).getString("verifier"));
        assertFalse(store.encryptedRecord(PENDING).contains(VERIFIER));
        assertFalse(duplicate.discardPending(store));
        assertTrue(first.discardPending(store));
        assertFalse(first.discardPending(store));
        assertNull(HostedAccessOAuth.restorePending(store));
    }

    public void testExpiredAndSupersededAttemptsAreDiscarded() throws Exception {
        prepare(STATE, System.currentTimeMillis() - 1);
        assertNull(HostedAccessOAuth.restorePending(store));
        assertFalse(store.contains(PENDING));
        prepare(STATE, System.currentTimeMillis() + 120_000);
        HostedAccessOAuth old = HostedAccessOAuth.restorePending(store);
        prepare(VERIFIER, System.currentTimeMillis() + 120_000);
        assertFalse(old.discardPending(store));
        HostedAccessOAuth replacement = HostedAccessOAuth.restorePending(store);
        assertFalse(replacement.matches(callback(STATE).getData()));
        assertTrue(replacement.matches(callback(VERIFIER).getData()));
        MainActivity activity = launch(new Intent(context, MainActivity.class));
        try {
            instrumentation.runOnMainSync(() -> HostedPairingFlow.cancelAccessSignIn(activity));
            assertFalse(store.contains(PENDING));
            assertFalse(replacement.discardPending(store));
        } finally { instrumentation.runOnMainSync(activity::finish); }
    }

    public void testCancelledBrowserOnlyLeavesItsBriefFallbackWindow() throws Exception {
        prepare(STATE, System.currentTimeMillis() + 120_000);
        HostedAccessOAuth oauth = HostedAccessOAuth.restorePending(store);
        String launcher = oauth.launcherKey();
        oauth.awaitFallbackLink(store);
        assertTrue(store.readRecord(PENDING).getLong("expiresAt") <= System.currentTimeMillis() + 700);
        HostedAccessOAuth restored = HostedAccessOAuth.restorePending(store);
        if (restored != null) assertEquals(launcher, restored.launcherKey());
        android.os.SystemClock.sleep(oauth.remainingMillis() + 1);
        assertNull(HostedAccessOAuth.restorePending(store));
        assertFalse(store.contains(PENDING));
    }
}
