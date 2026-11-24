package org.tvshell.iptvnator.ui;

import android.content.Context;
import android.util.AttributeSet;

import androidx.annotation.OptIn;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;

/** Keeps the chosen picture shape when Media3 changes video size or quality. */
@OptIn(markerClass = UnstableApi.class)
public final class NativePlayerView extends PlayerView {
    private int pictureMode;
    private float sourceAspectRatio;

    public NativePlayerView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    public int getPictureMode() {
        return pictureMode;
    }

    public void setPictureMode(int mode) {
        pictureMode = mode >= 0 && mode < 5 ? mode : 0;
        int resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT;
        if (pictureMode == 1) resizeMode = AspectRatioFrameLayout.RESIZE_MODE_ZOOM;
        if (pictureMode == 2) resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FILL;
        setResizeMode(resizeMode);
        onContentAspectRatioChanged(findViewById(androidx.media3.ui.R.id.exo_content_frame), sourceAspectRatio);
    }

    @Override
    protected void onContentAspectRatioChanged(AspectRatioFrameLayout frame, float aspectRatio) {
        sourceAspectRatio = aspectRatio;
        if (pictureMode == 3) aspectRatio = 16f / 9f;
        if (pictureMode == 4) aspectRatio = 4f / 3f;
        super.onContentAspectRatioChanged(frame, aspectRatio);
    }
}
