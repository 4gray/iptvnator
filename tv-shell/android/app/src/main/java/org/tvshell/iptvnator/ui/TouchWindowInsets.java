package org.tvshell.iptvnator.ui;

import android.app.Activity;
import android.graphics.Insets;
import android.os.Build;
import android.view.View;
import android.view.WindowInsets;

/** Keeps handheld controls clear of system UI while the window draws edge to edge. */
final class TouchWindowInsets {
    private final Activity activity;
    private final View content;
    private boolean active;

    TouchWindowInsets(Activity activity, View content) {
        this.activity = activity;
        this.content = content;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            content.setOnApplyWindowInsetsListener((view, windowInsets) -> {
                Insets safe = active ? windowInsets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime()) : Insets.NONE;
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
                return windowInsets;
            });
        }
    }

    void setActive(boolean active) {
        if (this.active == active) return;
        this.active = active;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            activity.getWindow().setDecorFitsSystemWindows(!active);
            if (!active) content.setPadding(0, 0, 0, 0);
            content.requestApplyInsets();
        }
    }
}
