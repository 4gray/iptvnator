package org.tvshell.iptvnator.ui;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.view.KeyEvent;
import android.view.View;
import android.widget.Button;

import androidx.annotation.OptIn;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.media3.common.C;
import androidx.media3.common.Player;
import androidx.media3.common.Tracks;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.ui.PlayerView;
import androidx.media3.ui.TrackSelectionDialogBuilder;

import org.tvshell.iptvnator.R;

/** Touch and remote actions share Media3's track selection and controller timing. */
@OptIn(markerClass = UnstableApi.class)
final class NativePlayerControls {
    private final Activity activity;
    private final NativePlayerView playerView;
    private final View bar;
    private final Button audio;
    private final Button subtitles;
    private final Button quality;
    private final Button picture;
    private Dialog dialog;
    private boolean failed;

    NativePlayerControls(Activity activity, NativePlayerView playerView) {
        this.activity = activity;
        this.playerView = playerView;
        bar = activity.findViewById(R.id.native_controls);
        audio = activity.findViewById(R.id.native_audio);
        subtitles = activity.findViewById(R.id.native_subtitles);
        quality = activity.findViewById(R.id.native_quality);
        picture = activity.findViewById(R.id.native_picture);
        int padding = Math.round(8 * activity.getResources().getDisplayMetrics().density);
        ViewCompat.setOnApplyWindowInsetsListener(bar, (view, insets) -> {
            Insets cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
            view.setPadding(padding + cutout.left, padding + cutout.top, padding + cutout.right, padding);
            return insets;
        });
        activity.findViewById(R.id.native_back).setOnClickListener(button -> activity.finish());
        audio.setOnClickListener(button -> showTracks(C.TRACK_TYPE_AUDIO, R.string.native_playback_audio, audio));
        subtitles.setOnClickListener(button -> showTracks(C.TRACK_TYPE_TEXT, R.string.native_playback_subtitles, subtitles));
        quality.setOnClickListener(button -> showQuality());
        picture.setOnClickListener(button -> showPicture());
        playerView.setControllerVisibilityListener((PlayerView.ControllerVisibilityListener)
            visibility -> bar.setVisibility(failed ? View.VISIBLE : visibility));
        updateTracks(Tracks.EMPTY);
        updatePicture();
    }

    void updateTracks(Tracks tracks) {
        if (failed) return;
        audio.setEnabled(supportedTracks(tracks, C.TRACK_TYPE_AUDIO) > 0);
        subtitles.setEnabled(supportedTracks(tracks, C.TRACK_TYPE_TEXT) > 0);
        boolean captions = tracks.isTypeSelected(C.TRACK_TYPE_TEXT);
        subtitles.setSelected(captions);
        subtitles.setContentDescription(activity.getString(captions
            ? R.string.native_playback_subtitles_on : R.string.native_playback_subtitles_off));
        quality.setEnabled(supportedTracks(tracks, C.TRACK_TYPE_VIDEO) > 0);
    }

    private static int supportedTracks(Tracks tracks, int type) {
        int count = 0;
        for (Tracks.Group group : tracks.getGroups()) {
            if (group.getType() != type) continue;
            for (int index = 0; index < group.length; index++) {
                if (group.isTrackSupported(index)) count++;
            }
        }
        return count;
    }

    private void showTracks(int type, int title, View anchor) {
        Player player = playerView.getPlayer();
        if (player == null) return;
        show(new TrackSelectionDialogBuilder(activity, activity.getString(title), player, type)
            .setIsDisabled(player.getTrackSelectionParameters().disabledTrackTypes.contains(type))
            .setShowDisableOption(type == C.TRACK_TYPE_TEXT).build(), anchor);
    }

    private void showQuality() {
        Player player = playerView.getPlayer();
        if (player == null) return;
        if (supportedTracks(player.getCurrentTracks(), C.TRACK_TYPE_VIDEO) > 1) {
            showTracks(C.TRACK_TYPE_VIDEO, R.string.native_playback_quality, quality);
            return;
        }
        show(new AlertDialog.Builder(activity).setTitle(R.string.native_playback_quality)
            .setSingleChoiceItems(new String[] { activity.getString(R.string.native_playback_original) }, 0,
                (dialog, index) -> dialog.dismiss())
            .setNegativeButton(android.R.string.cancel, null).create(), quality);
    }

    private void showPicture() {
        show(new AlertDialog.Builder(activity).setTitle(R.string.native_playback_picture)
            .setSingleChoiceItems(R.array.native_picture_modes, playerView.getPictureMode(), (dialog, mode) -> {
                playerView.setPictureMode(mode);
                updatePicture();
                dialog.dismiss();
            }).setNegativeButton(android.R.string.cancel, null).create(), picture);
    }

    private void updatePicture() {
        String mode = activity.getResources().getStringArray(R.array.native_picture_modes)[playerView.getPictureMode()];
        picture.setContentDescription(activity.getString(R.string.native_playback_picture_description, mode));
    }

    private void show(Dialog next, View anchor) {
        if (dialog != null) return;
        dialog = next;
        int timeout = playerView.getControllerShowTimeoutMs();
        playerView.setControllerShowTimeoutMs(0);
        playerView.showController();
        next.setOnDismissListener(closed -> {
            dialog = null;
            playerView.setControllerShowTimeoutMs(timeout);
            if (!activity.isFinishing()) {
                playerView.showController();
                anchor.requestFocus();
            }
        });
        next.show();
    }

    void dismiss() {
        if (dialog != null) dialog.dismiss();
    }

    boolean handleKeyEvent(KeyEvent event) {
        if (event.getAction() != KeyEvent.ACTION_DOWN || dialog != null) return false;
        if (event.getKeyCode() == KeyEvent.KEYCODE_DPAD_UP && !bar.hasFocus()) {
            playerView.showController();
            (audio.isEnabled() ? audio : activity.findViewById(R.id.native_back)).requestFocus();
            return true;
        }
        if (event.getKeyCode() == KeyEvent.KEYCODE_DPAD_DOWN && bar.hasFocus() && playerView.getUseController()) {
            playerView.showController();
            playerView.findViewById(androidx.media3.ui.R.id.exo_play_pause).requestFocus();
            return true;
        }
        return false;
    }

    void showError() {
        failed = true;
        dismiss();
        bar.setVisibility(View.VISIBLE);
        audio.setEnabled(false);
        subtitles.setEnabled(false);
        quality.setEnabled(false);
        picture.setEnabled(false);
        activity.findViewById(R.id.native_mute).setEnabled(false);
    }
}
