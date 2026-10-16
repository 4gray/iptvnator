package org.tvshell.iptvnator.ui;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.CompoundButton;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.TextView;
import android.widget.Toast;

import org.tvshell.iptvnator.Prefs;
import org.tvshell.iptvnator.R;
import org.tvshell.iptvnator.ShellApp;
import org.tvshell.iptvnator.server.TvShellServer;

import java.util.List;

/** The shell's settings: layout width, external player, data reset, diagnostics. D-pad friendly. */
public class SettingsActivity extends Activity {

    /** Set when the web app data was wiped, so the main screen reloads. */
    static boolean dataCleared;

    private Prefs prefs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = new Prefs(this);
        setContentView(R.layout.activity_settings);

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

        // External player on playback error
        CheckBox prompt = findViewById(R.id.prompt_external);
        prompt.setChecked(prefs.promptExternalOnError());
        prompt.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(CompoundButton buttonView, boolean isChecked) {
                prefs.setPromptExternalOnError(isChecked);
            }
        });

        // Preferred external player
        final RadioGroup playerGroup = findViewById(R.id.player_group);
        RadioButton chooser = new RadioButton(this);
        chooser.setText(R.string.player_system_chooser);
        chooser.setTag("");
        playerGroup.addView(chooser);
        String preferred = prefs.externalPlayerPackage();
        boolean matched = false;
        List<ExternalPlayer.Candidate> players = ExternalPlayer.installedPlayers(this);
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

        // Remote debugging
        CheckBox debug = findViewById(R.id.web_debug);
        debug.setChecked(prefs.webDebug());
        debug.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(CompoundButton buttonView, boolean isChecked) {
                prefs.setWebDebug(isChecked);
                WebView.setWebContentsDebuggingEnabled(isChecked);
            }
        });

        // Reset
        Button reset = findViewById(R.id.reset_data);
        reset.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                confirmReset();
            }
        });

        Button done = findViewById(R.id.done);
        done.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });

        ((TextView) findViewById(R.id.diagnostics)).setText(diagnostics());
        done.requestFocus();
    }

    private void confirmReset() {
        new AlertDialog.Builder(this)
            .setTitle(R.string.reset_title)
            .setMessage(R.string.reset_message)
            .setPositiveButton(R.string.reset_confirm, new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface dialog, int which) {
                    WebStorage.getInstance().deleteAllData();
                    CookieManager.getInstance().removeAllCookies(null);
                    CookieManager.getInstance().flush();
                    dataCleared = true;
                    Toast.makeText(SettingsActivity.this, R.string.reset_done, Toast.LENGTH_SHORT).show();
                }
            })
            .setNegativeButton(R.string.external_prompt_cancel, null)
            .show();
    }

    private String diagnostics() {
        String ua = WebSettings.getDefaultUserAgent(this);
        String chrome = "?";
        int at = ua.indexOf("Chrome/");
        if (at >= 0) {
            int end = ua.indexOf(' ', at);
            chrome = ua.substring(at + 7, end > 0 ? end : ua.length());
        }
        String webViewPackage = "";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            android.content.pm.PackageInfo info = WebView.getCurrentWebViewPackage();
            if (info != null) webViewPackage = info.packageName + " " + info.versionName;
        }
        TvShellServer server = ShellApp.currentServer();
        return getString(R.string.diagnostics, chrome, webViewPackage, Build.MODEL, Build.VERSION.RELEASE,
            server == null ? "-" : String.valueOf(server.port()), MainActivity.screenInfo(this) + ", layout " + prefs.layoutWidth()) + "\n" + ua;
    }
}
