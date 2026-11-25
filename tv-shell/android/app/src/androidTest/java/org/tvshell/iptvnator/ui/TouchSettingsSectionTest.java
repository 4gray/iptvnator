package org.tvshell.iptvnator.ui;

import android.app.Instrumentation;
import android.content.Intent;
import android.view.View;
import android.widget.RadioButton;
import androidx.test.platform.app.InstrumentationRegistry;
import junit.framework.TestCase;
import org.tvshell.iptvnator.Prefs;
import org.tvshell.iptvnator.R;

public class TouchSettingsSectionTest extends TestCase {
    public void testServerSection() { checkSection(SettingsActivity.PhoneSection.SERVER); }
    public void testPlaybackSection() { checkSection(SettingsActivity.PhoneSection.PLAYBACK); }
    public void testDeviceSection() { checkSection(SettingsActivity.PhoneSection.DEVICE); }

    private void checkSection(SettingsActivity.PhoneSection section) {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        Prefs prefs = new Prefs(instrumentation.getTargetContext());
        Prefs.LayoutMode previous = prefs.layoutMode();
        prefs.setLayoutMode(Prefs.LayoutMode.TOUCH);
        MainActivity main = (MainActivity) instrumentation.startActivitySync(
            new Intent(instrumentation.getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        Instrumentation.ActivityMonitor monitor = instrumentation.addMonitor(SettingsActivity.class.getName(), null, false);
        try {
            assertFalse(prefs.useTvLayout(main));
            TvShellBridge bridge = new TvShellBridge(main);
            instrumentation.runOnMainSync(() -> bridge.receive("[\"openSettings\",\"unknown\"]"));
            assertEquals("An unknown section opened native settings", 0, monitor.getHits());

            instrumentation.runOnMainSync(() -> bridge.receive("[\"openSettings\",\"" + section.key + "\"]"));
            SettingsActivity settings = (SettingsActivity) monitor.waitForActivityWithTimeout(5000);
            assertNotNull("Touch shortcut did not open " + section.key, settings);
            try {
                instrumentation.waitForIdleSync();
                if (Prefs.isTvDevice(main)) {
                    assertNull(settings.findViewById(R.id.phone_settings_title));
                    assertTrue(((RadioButton) settings.findViewById(R.id.layout_touch)).isChecked());
                    assertTrue(settings.findViewById(R.id.native_playback).isShown());
                } else {
                    for (SettingsActivity.PhoneSection card : SettingsActivity.PhoneSection.values()) {
                        assertEquals(card == section ? View.VISIBLE : View.GONE,
                            settings.findViewById(card.card).getVisibility());
                    }
                }
            } finally {
                instrumentation.runOnMainSync(settings::finish);
                instrumentation.waitForIdleSync();
            }
        } finally {
            instrumentation.removeMonitor(monitor);
            instrumentation.runOnMainSync(main::finish);
            prefs.setLayoutMode(previous);
        }
    }
}
