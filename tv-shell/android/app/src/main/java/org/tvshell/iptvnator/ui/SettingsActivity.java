package org.tvshell.iptvnator.ui;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.CompoundButton;
import android.widget.EditText;

import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.TextView;
import android.widget.Toast;

import org.tvshell.iptvnator.LayoutPolicy;
import org.tvshell.iptvnator.Prefs;
import org.tvshell.iptvnator.R;
import org.tvshell.iptvnator.ShellApp;
import org.tvshell.iptvnator.server.TvShellServer;

import java.util.List;

/** The shell's settings: layout width, external player, data reset, diagnostics. D-pad friendly. */
public class SettingsActivity extends Activity {

    static final String EXTRA_PHONE_SECTION = "org.tvshell.iptvnator.PHONE_SETTINGS_SECTION";

    enum PhoneSection {
        SERVER("server", R.string.connection_title, R.id.phone_connection_card, R.id.phone_connection_heading),
        PLAYBACK("playback", R.string.phone_playback, R.id.phone_playback_card, R.id.phone_playback_heading),
        DEVICE("device", R.string.device_settings_shortcut, R.id.phone_advanced_card, R.id.advanced_options);

        final String key;
        final int title;
        final int card;
        final int heading;

        PhoneSection(String key, int title, int card, int heading) {
            this.key = key;
            this.title = title;
            this.card = card;
            this.heading = heading;
        }

        static PhoneSection fromKey(String key) {
            for (PhoneSection section : values()) {
                if (section.key.equals(key)) return section;
            }
            return null;
        }
    }

    /** Set when the web app data was wiped, so the main screen reloads. */
    static boolean dataCleared;
    static boolean connectionPaired;

    private Prefs prefs;
    private HostedPairingFlow pairing;
    private LibraryQrScanner scanner;
    private boolean tvDevice;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = new Prefs(this);
        tvDevice = Prefs.isTvDevice(this);
        setContentView(tvDevice ? R.layout.activity_settings : R.layout.activity_settings_phone);
        if (!tvDevice) {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
            new TouchWindowInsets(this, findViewById(R.id.settings_root)).setActive(true);
            setupDisclosure(R.id.connection_options, R.id.connection_details);
            setupDisclosure(R.id.advanced_options, R.id.advanced_details);
            setupDisclosure(R.id.diagnostics_toggle, R.id.diagnostics);
            applyPhoneSection(getIntent());
        }

        RadioGroup modeGroup = findViewById(R.id.layout_mode_group);
        switch (prefs.layoutMode()) {
            case TOUCH: modeGroup.check(R.id.layout_touch); break;
            case TV: modeGroup.check(R.id.layout_tv); break;
            default: modeGroup.check(R.id.layout_auto); break;
        }
        modeGroup.setOnCheckedChangeListener((group, checkedId) -> {
            Prefs.LayoutMode mode = checkedId == R.id.layout_touch ? Prefs.LayoutMode.TOUCH
                : checkedId == R.id.layout_tv ? Prefs.LayoutMode.TV : Prefs.LayoutMode.AUTO;
            prefs.setLayoutMode(mode);
            updateLayoutSettings();
        });
        updateLayoutSettings();

        EditText address = findViewById(R.id.host_address);
        address.setText(prefs.hostedOrigin());
        TextView status = findViewById(R.id.connection_status);
        status.setText(prefs.hostedOrigin().isEmpty() ? R.string.connection_local : R.string.connection_hosted);
        Button connect = findViewById(R.id.connect_host);
        Button local = findViewById(R.id.local_library);
        pairing = new HostedPairingFlow(this);
        scanner = new LibraryQrScanner(this, prefs, pairing);
        View scan = findViewById(R.id.scan_tv);
        scan.setVisibility(LibraryQrScanner.available(this) ? View.VISIBLE : View.GONE);
        scan.setOnClickListener(v -> scanner.open());
        EditText approvalAddress = findViewById(R.id.approval_address);
        approvalAddress.setText(prefs.approvalOrigin());
        View pair = findViewById(R.id.pair_host);
        pair.setOnClickListener(v -> {
            scanner.cancel();
            final String trusted;
            try { trusted = HostedConnection.approvalOrigin(approvalAddress.getText().toString()); }
            catch (IllegalArgumentException e) { status.setText(R.string.approval_address_invalid); return; }
            approvalAddress.setText(trusted);
            prefs.setApprovalOrigin(trusted);
            pairing.start(address.getText().toString(), trusted);
        });
        local.setOnClickListener(v -> {
            scanner.cancel();
            prefs.setHostedOrigin("");
            address.setText("");
            status.setText(R.string.connection_local);
            updateConnectionActions();
        });
        connect.setOnClickListener(v -> {
            scanner.cancel();
            final String origin;
            try { origin = HostedOrigin.normalize(address.getText().toString()); }
            catch (IllegalArgumentException e) { status.setText(R.string.connection_invalid); return; }
            connect.setEnabled(false);
            local.setEnabled(false);
            if (!tvDevice) {
                pair.setEnabled(false);
                scan.setEnabled(false);
            }
            status.setText(R.string.connection_checking);
            new Thread(() -> {
                int result = HostedConnection.probeSavedLibrary(this, origin);
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    connect.setEnabled(true);
                    local.setEnabled(true);
                    if (!tvDevice) {
                        pair.setEnabled(true);
                        scan.setEnabled(true);
                    }
                    if (result == 0) {
                        scanner.cancel();
                        prefs.setHostedOrigin(origin);
                        address.setText(origin);
                        status.setText(R.string.connection_hosted);
                        updateConnectionActions();
                    } else {
                        status.setText(result);
                        if (result == R.string.connection_access) HostedConnection.offerAccessQr(this, null);
                    }
                });
            }).start();
        });

        // Layout width
        RadioGroup widthGroup = findViewById(R.id.width_group);
        int width = prefs.layoutWidth();
        ((RadioButton) findViewById(width == 960 ? R.id.width_960 : width == 1600 ? R.id.width_1600 : R.id.width_1280)).setChecked(true);
        widthGroup.setOnCheckedChangeListener(new RadioGroup.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(RadioGroup group, int checkedId) {
                prefs.setLayoutWidth(checkedId == R.id.width_960 ? 960 : checkedId == R.id.width_1600 ? 1600 : 1280);
            }
        });

        CompoundButton nativePlayback = findViewById(R.id.native_playback);
        nativePlayback.setChecked(prefs.nativePlayback());
        nativePlayback.setOnCheckedChangeListener((button, checked) -> prefs.setNativePlayback(checked));

        // External player on playback error
        CompoundButton prompt = findViewById(R.id.prompt_external);
        prompt.setChecked(prefs.promptExternalOnError());
        prompt.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(CompoundButton buttonView, boolean isChecked) {
                prefs.setPromptExternalOnError(isChecked);
            }
        });

        // Preferred external player
        List<ExternalPlayer.Candidate> players = ExternalPlayer.installedPlayers(this);
        if (tvDevice) setupTvPlayers(players);
        else setupPhonePlayers(players);

        // Remote debugging
        CompoundButton debug = findViewById(R.id.web_debug);
        debug.setChecked(prefs.webDebug());
        debug.setOnCheckedChangeListener((buttonView, isChecked) -> {
            prefs.setWebDebug(isChecked);
            try {
                WebView.setWebContentsDebuggingEnabled(isChecked);
            } catch (RuntimeException e) {
                // The system WebView is missing or being updated: applied at the next start.
            }
        });

        // Reset
        Button reset = findViewById(R.id.reset_data);
        reset.setOnClickListener(v -> confirmReset());

        Button done = findViewById(R.id.done);
        done.setOnClickListener(v -> finish());

        ((TextView) findViewById(R.id.diagnostics)).setText(diagnostics());
        updateConnectionActions();
        if (tvDevice) done.requestFocus();
        pairing.open(getIntent());
    }

    private void applyPhoneSection(Intent intent) {
        // An external pairing link always opens the full settings screen.
        if (Intent.ACTION_VIEW.equals(intent.getAction())) return;
        PhoneSection selected = PhoneSection.fromKey(intent.getStringExtra(EXTRA_PHONE_SECTION));
        if (selected == null) return;

        ((TextView) findViewById(R.id.phone_settings_title)).setText(selected.title);
        for (PhoneSection section : PhoneSection.values()) {
            findViewById(section.card).setVisibility(section == selected ? View.VISIBLE : View.GONE);
        }
        findViewById(selected.heading).setVisibility(View.GONE);
        if (selected == PhoneSection.DEVICE) {
            findViewById(R.id.advanced_details).setVisibility(View.VISIBLE);
        }
    }

    private void setupTvPlayers(List<ExternalPlayer.Candidate> players) {
        final RadioGroup playerGroup = findViewById(R.id.player_group);
        RadioButton chooser = new RadioButton(this);
        chooser.setText(R.string.player_system_chooser);
        chooser.setTag("");
        playerGroup.addView(chooser);
        String preferred = prefs.externalPlayerPackage();
        boolean matched = false;
        for (ExternalPlayer.Candidate candidate : players) {
            RadioButton button = new RadioButton(this);
            button.setText(candidate.label + "  (" + candidate.packageName + ")");
            button.setTag(candidate.packageName);
            playerGroup.addView(button);
            if (candidate.packageName.equals(preferred)) {
                button.setChecked(true);
                matched = true;
            }
        }
        if (!matched) chooser.setChecked(true);
        if (players.isEmpty()) {
            findViewById(R.id.player_hint).setVisibility(View.VISIBLE);
        }
        playerGroup.setOnCheckedChangeListener(new RadioGroup.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(RadioGroup group, int checkedId) {
                View checked = group.findViewById(checkedId);
                prefs.setExternalPlayerPackage(checked == null ? null : (String) checked.getTag());
            }
        });

    }

    private void setupPhonePlayers(List<ExternalPlayer.Candidate> players) {
        Button picker = findViewById(R.id.phone_player_picker);
        picker.setVisibility(players.isEmpty() ? View.GONE : View.VISIBLE);
        findViewById(R.id.player_hint).setVisibility(players.isEmpty() ? View.VISIBLE : View.GONE);
        if (players.isEmpty()) return;
        String[] labels = new String[players.size() + 1];
        labels[0] = getString(R.string.phone_player_ask);
        int selected = 0;
        for (int i = 0; i < players.size(); i++) {
            labels[i + 1] = players.get(i).label;
            if (players.get(i).packageName.equals(prefs.externalPlayerPackage())) selected = i + 1;
        }
        picker.setText(getString(R.string.phone_preferred_player_value, labels[selected]));
        picker.setOnClickListener(v -> {
            int current = 0;
            for (int i = 0; i < players.size(); i++) {
                if (players.get(i).packageName.equals(prefs.externalPlayerPackage())) current = i + 1;
            }
            new AlertDialog.Builder(this).setTitle(R.string.phone_preferred_player)
                .setSingleChoiceItems(labels, current, (dialog, which) -> {
                    prefs.setExternalPlayerPackage(which == 0 ? "" : players.get(which - 1).packageName);
                    picker.setText(getString(R.string.phone_preferred_player_value, labels[which]));
                    dialog.dismiss();
                }).setNegativeButton(R.string.external_prompt_cancel, null).show();
        });
    }

    private void setupDisclosure(int buttonId, int detailsId) {
        TextView button = findViewById(buttonId);
        View details = findViewById(detailsId);
        Runnable refresh = () -> {
            boolean expanded = details.getVisibility() == View.VISIBLE;
            button.setActivated(expanded);
            button.setContentDescription(getString(expanded ? R.string.settings_collapse : R.string.settings_expand, button.getText()));
        };
        refresh.run();
        button.setOnClickListener(v -> {
            details.setVisibility(details.getVisibility() == View.VISIBLE ? View.GONE : View.VISIBLE);
            refresh.run();
        });
    }

    private void updateConnectionActions() {
        if (tvDevice) return;
        String origin = prefs.hostedOrigin();
        findViewById(R.id.local_library).setVisibility(origin.isEmpty() ? View.GONE : View.VISIBLE);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (prefs != null) updateConnectionActions();
    }

    private void updateLayoutSettings() {
        boolean tv = prefs.useTvLayout(this);
        if (!tvDevice) {
            boolean supportsLayout = LayoutPolicy.useTvLayout("TV", false, getResources().getConfiguration().screenWidthDp);
            findViewById(R.id.phone_layout_group).setVisibility(supportsLayout ? View.VISIBLE : View.GONE);
        }
        int visibility = tv ? View.VISIBLE : View.GONE;
        findViewById(R.id.width_heading).setVisibility(visibility);
        findViewById(R.id.width_hint).setVisibility(visibility);
        RadioGroup width = findViewById(R.id.width_group);
        width.setVisibility(visibility);
        width.setOrientation(!tvDevice || getResources().getConfiguration().screenWidthDp < 600
            ? RadioGroup.VERTICAL : RadioGroup.HORIZONTAL);
        if (tvDevice) {
            int padding = Math.round((tv ? 40 : 16) * getResources().getDisplayMetrics().density);
            findViewById(R.id.settings_content).setPadding(padding, padding, padding, padding);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (!scanner.onActivityResult(requestCode, resultCode, data)) {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    @Override
    protected void onStop() {
        scanner.cancel();
        if (pairing != null) pairing.cancel();
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        if (pairing != null) pairing.cancel();
        super.onDestroy();
    }

    private void confirmReset() {
        new AlertDialog.Builder(this)
            .setTitle(R.string.reset_title)
            .setMessage(R.string.reset_message)
            .setPositiveButton(R.string.reset_confirm, new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface dialog, int which) {
                    try {
                        WebStorage.getInstance().deleteAllData();
                        CookieManager.getInstance().removeAllCookies(null);
                        CookieManager.getInstance().flush();
                    } catch (RuntimeException e) { // the system WebView is missing or being updated
                        Toast.makeText(SettingsActivity.this, R.string.webview_unavailable, Toast.LENGTH_LONG).show();
                        return;
                    }
                    new NativePlaybackCheckpoints(SettingsActivity.this).clear();
                    dataCleared = true;
                    new PairedCredentialStore(SettingsActivity.this).clear();
                    updateConnectionActions();
                    Toast.makeText(SettingsActivity.this, R.string.reset_done, Toast.LENGTH_SHORT).show();
                }
            })
            .setNegativeButton(R.string.external_prompt_cancel, null)
            .show();
    }

    private String diagnostics() {
        String ua = "";
        String chrome = "?";
        String webViewPackage = "";
        try {
            ua = WebSettings.getDefaultUserAgent(this);
            int at = ua.indexOf("Chrome/");
            if (at >= 0) {
                int end = ua.indexOf(' ', at);
                chrome = ua.substring(at + 7, end > 0 ? end : ua.length());
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                android.content.pm.PackageInfo info = WebView.getCurrentWebViewPackage();
                if (info != null) webViewPackage = info.packageName + " " + info.versionName;
            }
        } catch (RuntimeException e) {
            // The system WebView is missing, disabled or being updated: the rest still helps.
            webViewPackage = "unavailable (" + e.getClass().getSimpleName() + ")";
        }
        TvShellServer server = ShellApp.currentServer();
        String port = server == null ? "-" : String.valueOf(server.port());
        if (server != null && ShellApp.onFallbackPort()) port += " (temporary, saved data on " + prefs.serverPort() + ")";
        return getString(R.string.diagnostics, chrome, webViewPackage, Build.MODEL, Build.VERSION.RELEASE,
            port, MainActivity.screenInfo(this) + ", layout "
                + (prefs.useTvLayout(this) ? "TV (" + prefs.layoutWidth() + ")" : "Touch")) + "\n" + ua;
    }
}
