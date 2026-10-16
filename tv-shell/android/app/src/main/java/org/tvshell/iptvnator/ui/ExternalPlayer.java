package org.tvshell.iptvnator.ui;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.widget.Toast;

import org.tvshell.iptvnator.R;

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

    private static Intent viewIntent(String url, String title) {
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

    /** @return true when a player was launched. */
    public static boolean open(Context context, String url, String title, String preferredPackage) {
        Intent intent = viewIntent(url, title == null ? "" : title);
        if (preferredPackage != null && !preferredPackage.isEmpty()) intent.setPackage(preferredPackage);
        try {
            context.startActivity(intent);
            return true;
        } catch (ActivityNotFoundException e) {
            if (preferredPackage != null && !preferredPackage.isEmpty()) {
                // The preferred app is gone: fall back to the system chooser.
                intent.setPackage(null);
                try {
                    context.startActivity(intent);
                    return true;
                } catch (ActivityNotFoundException ignored) {
                    // handled below
                }
            }
            Toast.makeText(context, R.string.no_external_player, Toast.LENGTH_LONG).show();
            return false;
        }
    }
}
