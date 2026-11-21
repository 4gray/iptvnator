package org.tvshell.iptvnator.ui;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.widget.EditText;
import androidx.test.platform.app.InstrumentationRegistry;
import com.google.zxing.integration.android.IntentIntegrator;
import fi.iki.elonen.NanoHTTPD;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import junit.framework.TestCase;
import org.tvshell.iptvnator.Prefs;
import org.tvshell.iptvnator.R;

public class SettingsConnectionProbeTest extends TestCase {
    public void testPairSupersedesConnect() throws Exception {
        checkProbe(settings -> {
            ((EditText) settings.findViewById(R.id.host_address)).setText("http://127.0.0.1:1");
            settings.findViewById(R.id.pair_host).performClick();
        });
    }

    public void testScanSupersedesConnect() throws Exception {
        checkProbe(settings -> {
            Intent result = new Intent().putExtra("SCAN_RESULT",
                "https://library.example/pair-device#abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ");
            settings.onActivityResult(IntentIntegrator.REQUEST_CODE, Activity.RESULT_OK, result);
        });
    }

    public void testLocalSupersedesConnect() throws Exception {
        checkProbe(settings -> settings.findViewById(R.id.local_library).performClick());
    }

    public void testStoppingSettingsCancelsConnect() throws Exception {
        checkProbe(settings -> InstrumentationRegistry.getInstrumentation().callActivityOnStop(settings));
    }

    public void testCurrentProbeSelectsLibrary() throws Exception {
        checkProbe(null);
    }

    private void checkProbe(Consumer<SettingsActivity> nextAction) throws Exception {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        Prefs prefs = new Prefs(instrumentation.getTargetContext());
        String previous = prefs.hostedOrigin();
        CountDownLatch requested = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        NanoHTTPD server = new NanoHTTPD("127.0.0.1", 0) {
            @Override public Response serve(IHTTPSession request) {
                requested.countDown();
                try {
                    if (!release.await(6, TimeUnit.SECONDS)) throw new AssertionError("Probe not released");
                } catch (InterruptedException e) { throw new AssertionError(e); }
                return newFixedLengthResponse(Response.Status.OK, "application/json",
                    "{\"service\":\"iptvnator\",\"apiVersion\":1,\"storage\":\"server\"," +
                    "\"instanceId\":\"synthetic-instance\",\"auth\":\"none\"}");
            }
        };
        server.start();
        String probed = "http://127.0.0.1:" + server.getListeningPort();
        prefs.setHostedOrigin("https://previous-library.example");
        SettingsActivity settings = (SettingsActivity) instrumentation.startActivitySync(
            new Intent(instrumentation.getTargetContext(), SettingsActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        try {
            EditText address = settings.findViewById(R.id.host_address);
            instrumentation.runOnMainSync(() -> {
                address.setText(probed);
                settings.findViewById(R.id.connect_host).performClick();
            });
            assertTrue("No connection probe", requested.await(5, TimeUnit.SECONDS));
            // Join the worker so its completion is queued before waiting for the UI to become idle.
            Thread worker = Thread.getAllStackTraces().keySet().stream()
                .filter(thread -> thread.getName().equals("settings-library-probe"))
                .findFirst().orElseThrow(() -> new AssertionError("No probe worker"));
            instrumentation.runOnMainSync(() -> {
                assertTrue(settings.findViewById(R.id.pair_host).isEnabled());
                assertTrue(settings.findViewById(R.id.local_library).isEnabled());
                assertTrue(settings.findViewById(R.id.scan_tv).isEnabled());
                if (nextAction != null) nextAction.accept(settings);
            });
            release.countDown();
            worker.join(5000);
            assertFalse("Connection probe did not return", worker.isAlive());
            instrumentation.waitForIdleSync();
            assertEquals("Only the current probe can select its library", nextAction == null,
                probed.equals(prefs.hostedOrigin()));
            assertTrue("Connect remained disabled", settings.findViewById(R.id.connect_host).isEnabled());
        } finally {
            release.countDown();
            server.stop();
            instrumentation.runOnMainSync(settings::finish);
            prefs.setHostedOrigin(previous);
        }
    }
}
