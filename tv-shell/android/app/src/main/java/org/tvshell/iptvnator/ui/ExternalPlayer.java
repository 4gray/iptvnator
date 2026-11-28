package org.tvshell.iptvnator.ui;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import android.widget.Toast;

import org.tvshell.iptvnator.R;
import org.tvshell.iptvnator.ShellApp;
import org.tvshell.iptvnator.backend.DiagnosticRedactor;

import java.util.ArrayList;
import java.util.List;

/** Hands a stream URL to an installed video player (VLC, Kodi, MX Player, ...). */
public final class ExternalPlayer {

    public static final class Candidate {
        public final String packageName;
        public final String label;

        Candidate(String packageName, String label) {
            this.packageName = packageName;
            this.label = label;
        }
    }

    private ExternalPlayer() {
    }

    /** Intent extras travel through a binder transaction with a hard size limit. */
    private static final int MAX_TITLE_LENGTH = 256;

    private static Intent viewIntent(String url, String title) {
        if (title != null && title.length() > MAX_TITLE_LENGTH) title = title.substring(0, MAX_TITLE_LENGTH);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(Uri.parse(url), "video/*");
        intent.putExtra(Intent.EXTRA_TITLE, title);
        intent.putExtra("title", title);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return intent;
    }

    /** Installed apps able to play a network video stream. */
    public static List<Candidate> installedPlayers(Context context) {
        List<Candidate> out = new ArrayList<Candidate>();
        PackageManager pm = context.getPackageManager();
        Intent probe = viewIntent("http://example.com/stream.m3u8", "probe");
        List<ResolveInfo> infos = pm.queryIntentActivities(probe, 0);
        for (ResolveInfo info : infos) {
            if (info.activityInfo == null) continue;
            String pkg = info.activityInfo.packageName;
            if (pkg.equals(context.getPackageName())) continue;
            boolean seen = false;
            for (Candidate c : out) {
                if (c.packageName.equals(pkg)) {
                    seen = true;
                    break;
                }
            }
            if (seen) continue;
            CharSequence label = info.loadLabel(pm);
            out.add(new Candidate(pkg, label == null ? pkg : label.toString()));
        }
        return out;
    }

    private static Intent recoveryIntent(String url, String title) {
        Uri uri = Uri.parse(url);
        if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))
            || uri.getHost() == null || uri.getHost().isEmpty() || uri.getUserInfo() != null) return null;
        return viewIntent(url, title);
    }

    private static boolean hasHandler(Context context, Intent intent) {
        if (intent == null) return false;
        return context.getPackageManager().queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
            .stream().anyMatch(info -> info.activityInfo != null && info.activityInfo.exported
                && !context.getPackageName().equals(info.activityInfo.packageName));
    }

    static boolean canChoose(Context context, String url) {
        return hasHandler(context, recoveryIntent(url, null));
    }

    static void choose(Context context, String url, String title) {
        Intent intent = recoveryIntent(url, title);
        try {
            if (hasHandler(context, intent)) {
                Intent chooser = Intent.createChooser(intent, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    chooser.putExtra(Intent.EXTRA_AUTO_LAUNCH_SINGLE_CHOICE, false);
                }
                context.startActivity(chooser);
                return;
            }
        } catch (RuntimeException ignored) {
            Log.w(ShellApp.TAG, "external player chooser launch failed");
        }
        Toast.makeText(context, R.string.no_external_player, Toast.LENGTH_LONG).show();
    }

    /** @return true when a player was launched. */
    public static boolean open(Context context, String url, String title, String preferredPackage) {
        Intent intent = viewIntent(url, title == null ? "" : title);
        if (preferredPackage != null && !preferredPackage.isEmpty()) intent.setPackage(preferredPackage);
        try {
            context.startActivity(intent);
            return true;
        } catch (RuntimeException e) {
            // ActivityNotFoundException, but also SecurityException (the player's activity is no
            // longer exported) or a too-large transaction: none of them may take the shell down.
            Log.w(ShellApp.TAG, "external player launch failed: " + DiagnosticRedactor.redact(e.toString()));
            if (preferredPackage != null && !preferredPackage.isEmpty()) {
                // The preferred app is gone or refuses: fall back to the system chooser.
                intent.setPackage(null);
                try {
                    context.startActivity(intent);
                    return true;
                } catch (RuntimeException ignored) {
                    // handled below
                }
            }
            Toast.makeText(context, R.string.no_external_player, Toast.LENGTH_LONG).show();
            return false;
        }
    }
}
