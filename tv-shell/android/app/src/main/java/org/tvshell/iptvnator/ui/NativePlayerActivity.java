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
import androidx.media3.common.ForwardingSimpleBasePlayer;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.common.util.Log;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.analytics.PlaybackStats;
import androidx.media3.exoplayer.analytics.PlaybackStatsListener;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.source.UnrecognizedInputFormatException;
import androidx.media3.session.MediaSession;
import androidx.media3.session.SessionCommands;
import androidx.media3.ui.PlayerView;

import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;

import org.tvshell.iptvnator.R;

import java.util.UUID;

import okhttp3.HttpUrl;

@OptIn(markerClass = UnstableApi.class)
public final class NativePlayerActivity extends Activity {
    private static String checkpointId;
    private static Intent pausedCheckpoint;
    private ExoPlayer player;
    private MediaSession mediaSession;
    private PlayerView view;
    private PlaybackStatsListener stats;
    private HttpUrl stream;
    private boolean live;
    private boolean hls;
    private boolean autoplay = true;
    private boolean failed;
    private boolean ended;
    private boolean positionVerified;
    private boolean currentPlayerReady;
    private long position;
    private long duration;
    private long played;
    private long initialSeek;
    private boolean seedCaptions;
    private TrackSelectionParameters trackPreferences;
    private String requestId;

    @Override
    protected void onCreate(Bundle savedState) {
        super.onCreate(savedState);
        requestId = getIntent().getStringExtra("requestId");
        if (requestId == null || !requestId.equals(checkpointId)) pausedCheckpoint = null;
        checkpointId = requestId;
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
        seedCaptions = getIntent().getBooleanExtra("captions", false);
        position = live ? 0 : getIntent().getLongExtra("position", 0);
        if (savedState != null) {
            position = savedState.getLong("position");
            duration = savedState.getLong("duration");
            positionVerified = savedState.getBoolean("positionVerified");
            played = savedState.getLong("played");
            failed = savedState.getBoolean("failed");
            hls = savedState.getBoolean("hls", hls);
            autoplay = savedState.getBoolean("playWhenReady");
            seedCaptions = savedState.getBoolean("seedCaptions", seedCaptions);
            Bundle tracks = savedState.getBundle("trackPreferences");
            if (tracks != null) trackPreferences = TrackSelectionParameters.fromBundle(tracks);
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
            .setUsePlatformDiagnostics(false)
            .build();
        player.setVolume(getIntent().getFloatExtra("volume", 1f));
        if (trackPreferences == null) {
            trackPreferences = player.getTrackSelectionParameters().buildUpon()
                .setIgnoredTextSelectionFlags(~C.SELECTION_FLAG_FORCED).build();
        }
        player.setTrackSelectionParameters(trackPreferences);
        Player sessionPlayer = new ForwardingSimpleBasePlayer(player) {
            @Override
            protected State getState() {
                State state = super.getState();
                // Media3 may embed signed media URLs in exceptions. Only the local view needs the error.
                return getPlayer().getPlayerError() == null
                    ? state : state.buildUpon().setPlayerError(null).build();
            }
        };
        mediaSession = new MediaSession.Builder(this, sessionPlayer)
            .setId(UUID.randomUUID().toString())
            .setCallback(new MediaSession.Callback() {
                @Override
                public ListenableFuture<MediaSession.ConnectionResult> onConnectAsync(
                    MediaSession session, MediaSession.ControllerInfo controller) {
                    if (!controller.isTrusted()) {
                        return Futures.immediateFuture(MediaSession.ConnectionResult.reject());
                    }
                    // Keep provider URLs and media-item replacement out of Android's transport controls.
                    return Futures.immediateFuture(MediaSession.ConnectionResult.accept(SessionCommands.EMPTY,
                        new Player.Commands.Builder().addAll(Player.COMMAND_PLAY_PAUSE, Player.COMMAND_STOP,
                            Player.COMMAND_SEEK_BACK, Player.COMMAND_SEEK_FORWARD).build()));
                }

                @Override
                public boolean onMediaButtonEvent(MediaSession session, MediaSession.ControllerInfo controller, Intent intent) {
                    KeyEvent event = intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
                    return controller.isTrusted() && event != null
                        && event.getKeyCode() == KeyEvent.KEYCODE_MEDIA_STOP && handleExitKey(event);
                }
            }).build();
        stats = new PlaybackStatsListener(false, null);
        player.addAnalyticsListener(stats);
        player.addListener(new Player.Listener() {
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                if (isPlaying) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }

            @Override
            public void onTracksChanged(Tracks tracks) {
                selectInitialCaption(tracks);
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_READY) {
                    applyInitialSeek();
                    currentPlayerReady = true;
                    positionVerified = true;
                }
                if (state == Player.STATE_ENDED && player.getPlaybackState() == Player.STATE_ENDED
                    && !live && !isFinishing()) {
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
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (player != null) player.setPlayWhenReady(autoplay);
    }

    private void prepareStream() {
        currentPlayerReady = false;
        MediaItem.Builder media = new MediaItem.Builder().setUri(stream.toString());
        if (hls) media.setMimeType(MimeTypes.APPLICATION_M3U8);
        initialSeek = live ? 0 : position;
        player.setMediaItem(media.build());
        player.prepare();
    }

    private void applyInitialSeek() {
        long seek = initialSeek;
        initialSeek = 0;
        if (seek <= 0 || !player.isCurrentMediaItemSeekable()) return;
        // An out-of-range seek during preparation can leave a progressive stream at EOF.
        long length = player.getDuration();
        if (length == C.TIME_UNSET || seek < length) player.seekTo(seek);
    }

    private void selectInitialCaption(Tracks tracks) {
        if (!seedCaptions) return;
        for (Tracks.Group group : tracks.getGroups()) {
            if (group.getType() != C.TRACK_TYPE_TEXT) continue;
            for (int index = 0; index < group.length; index++) {
                if (!group.isTrackSupported(index)
                    || (group.getTrackFormat(index).selectionFlags & C.SELECTION_FLAG_FORCED) != 0) continue;
                seedCaptions = false;
                player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                    .setOverrideForType(new TrackSelectionOverride(group.getMediaTrackGroup(), index)).build());
                return;
            }
        }
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
        if (player != null) {
            autoplay = player.getPlayWhenReady();
            player.pause();
            if (!isFinishing() && ownsCheckpoint()) pausedCheckpoint = playbackResult();
        }
        super.onPause();
    }

    @Override
    protected void onStop() {
        if (player != null) {
            snapshot();
            played = playedMs();
            trackPreferences = player.getTrackSelectionParameters();
            view.setPlayer(null);
            mediaSession.release();
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
        outState.putBoolean("positionVerified", positionVerified);
        outState.putLong("played", playedMs());
        outState.putBoolean("failed", failed);
        outState.putBoolean("hls", hls);
        outState.putBoolean("playWhenReady", autoplay);
        outState.putBoolean("seedCaptions", seedCaptions);
        TrackSelectionParameters tracks = player == null ? trackPreferences : player.getTrackSelectionParameters();
        if (tracks != null) outState.putBundle("trackPreferences", tracks.toBundle());
        super.onSaveInstanceState(outState);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        return handleExitKey(event) || super.dispatchKeyEvent(event);
    }

    private boolean handleExitKey(KeyEvent event) {
        int code = event.getKeyCode();
        if (code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_MEDIA_STOP) {
            if (event.getAction() == KeyEvent.ACTION_UP && !event.isCanceled()) finish();
            return true;
        }
        return false;
    }

    @Override
    public void finish() {
        Intent result = playbackResult();
        if (ownsCheckpoint()) pausedCheckpoint = result;
        setResult(RESULT_OK, result);
        super.finish();
    }

    static Intent takeCheckpoint(String id) {
        if (!id.equals(checkpointId)) return null;
        Intent result = pausedCheckpoint;
        checkpointId = null;
        pausedCheckpoint = null;
        return result;
    }

    private boolean ownsCheckpoint() {
        return requestId != null && requestId.equals(checkpointId);
    }

    private Intent playbackResult() {
        snapshot();
        return new Intent().putExtra("position", positionVerified ? position : 0)
            .putExtra("duration", positionVerified ? duration : 0)
            .putExtra("played", playedMs()).putExtra("ended", ended && positionVerified);
    }

    private long playedMs() {
        if (player == null) return played;
        PlaybackStats snapshot = stats.getCombinedPlaybackStats();
        return played + snapshot.getTotalPlayTimeMs();
    }

    private void snapshot() {
        if (player == null || live || !currentPlayerReady) return;
        duration = Math.max(0, player.getDuration());
        position = Math.max(0, player.getCurrentPosition());
        if (duration > 0) position = Math.min(duration, position);
    }
}
