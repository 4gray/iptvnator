package org.tvshell.iptvnator.ui;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Process;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.widget.Toast;

import org.tvshell.iptvnator.R;

/** Connects HTML file inputs to Android's document picker, without storage permissions. */
final class WebFileChooser {
    private static final int REQUEST_CODE = 1201;
    private final Activity activity;
    private ValueCallback<Uri[]> pending;
    private boolean multiple;

    WebFileChooser(Activity activity) {
        this.activity = activity;
    }

    boolean show(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (pending != null) {
            callback.onReceiveValue(null);
            return true;
        }
        pending = callback;
        multiple = params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE;
        // HTML accepts extensions (.m3u/.json), not necessarily Android MIME types.
        // Let the shared playlist/backup parsers validate the chosen document.
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*")
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple);
        try {
            activity.startActivityForResult(intent, REQUEST_CODE);
        } catch (ActivityNotFoundException | SecurityException e) {
            cancel();
            Toast.makeText(activity, R.string.file_picker_unavailable, Toast.LENGTH_LONG).show();
        }
        return true;
    }

    boolean onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQUEST_CODE) return false;
        if (pending == null) return true;
        Uri[] selected = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        if (selected != null) {
            for (Uri uri : selected) {
                // A picker is untrusted: never expose file:// app-private files to the page.
                if (uri == null || !"content".equals(uri.getScheme())
                    || activity.checkUriPermission(uri, Process.myPid(), Process.myUid(),
                        Intent.FLAG_GRANT_READ_URI_PERMISSION) != PackageManager.PERMISSION_GRANTED) {
                    selected = null;
                    break;
                }
            }
            if (selected != null && !multiple && selected.length > 1) selected = new Uri[] { selected[0] };
        }
        ValueCallback<Uri[]> callback = pending;
        pending = null;
        callback.onReceiveValue(selected);
        return true;
    }

    void cancel() {
        ValueCallback<Uri[]> callback = pending;
        pending = null;
        if (callback != null) callback.onReceiveValue(null);
    }
}
