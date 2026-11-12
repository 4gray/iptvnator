package org.tvshell.iptvnator.ui;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.WindowManager;

import androidx.annotation.OptIn;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.util.Log;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.analytics.PlaybackStats;
import androidx.media3.exoplayer.analytics.PlaybackStatsListener;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.source.UnrecognizedInputFormatException;
import androidx.media3.ui.PlayerView;

import org.tvshell.iptvnator.R;

import okhttp3.HttpUrl;

@OptIn(markerClass = UnstableApi.class)
public final class NativePlayerActivity extends Activity {
    private ExoPlayer player;
    private PlayerView view;
    private PlaybackStatsListener stats;
    private HttpUrl stream;
    private boolean live;
    private boolean hls;
    private boolean autoplay = true;
    private boolean failed;
    private boolean ended;
    private long position;
    private long duration;
    private long played;

    @Override
    protected void onCreate(Bundle savedState) {
        super.onCreate(savedState);
        String url = getIntent().getStringExtra("url");
        stream = url == null ? null : HttpUrl.parse(url);
        if (stream == null) {
            finish();
            return;
        }
        setContentView(R.layout.activity_native_player);
        view = findViewById(R.id.native_player);
        live = getIntent().getBooleanExtra("live", false);
        hls = getIntent().getBooleanExtra("hls", false);
        position = live ? 0 : getIntent().getLongExtra("position", 0);
        if (savedState != null) {
            position = savedState.getLong("position");
            duration = savedState.getLong("duration");
            played = savedState.getLong("played");
            failed = savedState.getBoolean("failed");
            hls = savedState.getBoolean("hls", hls);
            autoplay = false;
        }
        view.setShowRewindButton(!live);
        view.setShowFastForwardButton(!live);
        view.requestFocus();
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (stream == null || isFinishing()) return;
        if (failed) {
            showError();
            return;
        }
        // Media3's default exception logging can include signed media URLs.
        Log.setLogLevel(Log.LOG_LEVEL_OFF);
        OkHttpDataSource.Factory dataSource = new OkHttpDataSource.Factory(
            NativePlaybackRequest.client(stream, getIntent().getBundleExtra("headers")));
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(this)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON);
        player = new ExoPlayer.Builder(this, renderers)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(dataSource))
            .setAudioAttributes(AudioAttributes.DEFAULT, true)
            .setHandleAudioBecomingNoisy(true)
            .build();
        TrackSelectionParameters.Builder selection = player.getTrackSelectionParameters().buildUpon();
        if (getIntent().getBooleanExtra("captions", false)) {
            selection.setSelectTextByDefault(true);
        } else {
            selection.setIgnoredTextSelectionFlags(C.SELECTION_FLAG_DEFAULT);
        }
        player.setTrackSelectionParameters(selection.build());
        stats = new PlaybackStatsListener(false, null);
        player.addAnalyticsListener(stats);
        player.addListener(new Player.Listener() {
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                if (isPlaying) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_ENDED && !live && !isFinishing()) {
                    ended = true;
                    finish();
                }
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                if (!hls && !isFinishing() && error.getCause() instanceof UnrecognizedInputFormatException) {
                    // A manifest may be served behind an extensionless URL or a redirect.
                    hls = true;
                    prepareStream();
                    return;
                }
                failed = true;
                showError();
            }
        });
        view.setPlayer(player);
        prepareStream();
        player.setPlayWhenReady(autoplay);
        autoplay = false;
    }

    private void prepareStream() {
        MediaItem.Builder media = new MediaItem.Builder().setUri(stream.toString());
        if (hls) media.setMimeType(MimeTypes.APPLICATION_M3U8);
        player.setMediaItem(media.build(), !live && position > 0 ? position : C.TIME_UNSET);
        player.prepare();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            controller.hide(WindowInsetsCompat.Type.systemBars());
        }
    }

    private void showError() {
        view.setCustomErrorMessage(getString(R.string.native_playback_failed));
        view.hideController();
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        // Home can be followed by a launcher relaunch before onStop delivers the result.
        if (!isFinishing()) finish();
    }

    @Override
    protected void onPause() {
        if (player != null) player.pause();
        super.onPause();
    }

    @Override
    protected void onStop() {
        if (player != null) {
            snapshot();
            played = playedMs();
            view.setPlayer(null);
            player.release();
            player = null;
        }
        super.onStop();
        // Other ways of leaving the player may stop it without a user leave hint.
        if (!isFinishing() && !isChangingConfigurations()) finish();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        snapshot();
        outState.putLong("position", position);
        outState.putLong("duration", duration);
        outState.putLong("played", playedMs());
        outState.putBoolean("failed", failed);
        outState.putBoolean("hls", hls);
        super.onSaveInstanceState(outState);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        if (code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_MEDIA_STOP) {
            if (event.getAction() == KeyEvent.ACTION_UP && !event.isCanceled()) finish();
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void finish() {
        snapshot();
        setResult(RESULT_OK, new Intent().putExtra("position", position)
            .putExtra("duration", duration).putExtra("played", playedMs()).putExtra("ended", ended));
        super.finish();
    }

    private long playedMs() {
        if (player == null) return played;
        PlaybackStats snapshot = stats.getCombinedPlaybackStats();
        return played + snapshot.getTotalPlayTimeMs();
    }

    private void snapshot() {
        if (player == null || live || player.getDuration() <= 0) return;
        duration = player.getDuration();
        position = Math.min(duration, player.getCurrentPosition());
    }
}
