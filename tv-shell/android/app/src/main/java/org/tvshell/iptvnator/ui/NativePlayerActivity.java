package org.tvshell.iptvnator.ui;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.widget.ImageButton;

import androidx.annotation.OptIn;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.ForwardingPlayer;
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
import androidx.media3.exoplayer.DefaultBufferSettings;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.analytics.PlaybackStats;
import androidx.media3.exoplayer.analytics.PlaybackStatsListener;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.source.UnrecognizedInputFormatException;
import androidx.media3.session.MediaSession;
import androidx.media3.session.SessionCommands;

import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;

import org.tvshell.iptvnator.R;

import java.util.UUID;

import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;

@OptIn(markerClass = UnstableApi.class)
public final class NativePlayerActivity extends Activity {
    private static String checkpointId;
    private static Intent pausedCheckpoint;
    private ExoPlayer player;
    private MediaSession mediaSession;
    private NativePlayerView view;
    private NativePlayerControls controls;
    private ImageButton muteButton;
    private float nativeVolume;
    private float audibleVolume;
    private PlaybackStatsListener stats;
    private HttpUrl stream;
    private OkHttpClient httpClient;
    private boolean live;
    private boolean hls;
    private boolean autoplay = true;
    private boolean failed;
    private boolean ended;
    private boolean started;
    private boolean positionVerified;
    private boolean canSnapshotCurrentPlayer;
    private boolean preserveSavedPosition;
    private long position;
    private long duration;
    private long played;
    private long initialSeek;
    private boolean seedCaptions;
    private TrackSelectionParameters trackPreferences;
    private String requestId;
    private final Handler checkpointHandler = new Handler(Looper.getMainLooper());
    private final Runnable cacheCheckpoint = new Runnable() {
        @Override
        public void run() {
            if (player == null || isFinishing() || !ownsCheckpoint()) return;
            pausedCheckpoint = playbackResult();
            checkpointHandler.postDelayed(this, 1000);
        }
    };

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
        if (savedState != null) view.setPictureMode(savedState.getInt("pictureMode"));
        controls = new NativePlayerControls(this, view);
        muteButton = findViewById(R.id.native_mute);
        nativeVolume = getIntent().getFloatExtra("volume", 1f);
        audibleVolume = nativeVolume > 0f ? nativeVolume : getIntent().getFloatExtra("audibleVolume", 0.5f);
        if (audibleVolume == 0f) audibleVolume = 0.5f;
        live = getIntent().getBooleanExtra("live", false);
        hls = getIntent().getBooleanExtra("hls", false);
        seedCaptions = getIntent().getBooleanExtra("captions", false);
        position = live ? 0 : getIntent().getLongExtra("position", 0);
        if (savedState != null) {
            nativeVolume = savedState.getFloat("volume", nativeVolume);
            position = savedState.getLong("position");
            duration = savedState.getLong("duration");
            positionVerified = savedState.getBoolean("positionVerified");
            started = savedState.getBoolean("started");
            played = savedState.getLong("played");
            failed = savedState.getBoolean("failed");
            hls = savedState.getBoolean("hls", hls);
            autoplay = savedState.getBoolean("playWhenReady");
            seedCaptions = savedState.getBoolean("seedCaptions", seedCaptions);
            Bundle tracks = savedState.getBundle("trackPreferences");
            if (tracks != null) trackPreferences = TrackSelectionParameters.fromBundle(tracks);
        }
        muteButton.setOnClickListener(button -> {
            if (player == null) return;
            nativeVolume = nativeVolume == 0f ? audibleVolume : 0f;
            player.setVolume(nativeVolume);
            updateMuteButton();
            view.showController();
        });
        updateMuteButton();
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
        if (httpClient == null) {
            httpClient = (OkHttpClient) getLastNonConfigurationInstance();
            if (httpClient == null) {
                httpClient = NativePlaybackRequest.client(stream, getIntent().getBundleExtra("headers"));
            }
        }
        OkHttpDataSource.Factory dataSource = new OkHttpDataSource.Factory(httpClient);
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(this)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON);
        player = new ExoPlayer.Builder(this, renderers)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(dataSource))
            // Deeper buffers than the ExoPlayer defaults (min 15 s, max 53 s):
            // on a fast link the extra headroom absorbs CDN jitter and provider
            // stalls without raising latency enough to matter for live TV.
            .setBufferSettings(new DefaultBufferSettings(10_000, 90_000, 25_000, 25_000))
            .setSeekBackIncrementMs(15_000)
            .setSeekForwardIncrementMs(30_000)
            .setAudioAttributes(AudioAttributes.DEFAULT, true)
            .setHandleAudioBecomingNoisy(true)
            .setUsePlatformDiagnostics(false)
            .build();
        player.setVolume(nativeVolume);
        if (trackPreferences == null) {
            // The app seeds captions. Android's caption language must not turn them on by itself.
            trackPreferences = player.getTrackSelectionParameters().buildUpon()
                .setPreferredTextLanguages()
                .setIgnoredTextSelectionFlags(~C.SELECTION_FLAG_FORCED).build();
        }
        player.setTrackSelectionParameters(trackPreferences);
        stats = new PlaybackStatsListener(false, null);
        player.addAnalyticsListener(stats);
        player.addListener(new Player.Listener() {
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                started |= isPlaying;
                if (isPlaying) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }

            @Override
            public void onTracksChanged(Tracks tracks) {
                controls.updateTracks(tracks);
                if (hasUnsupportedTrack(tracks, C.TRACK_TYPE_VIDEO)
                    || hasUnsupportedTrack(tracks, C.TRACK_TYPE_AUDIO)) {
                    failed = true;
                    player.stop();
                    showError();
                    return;
                }
                selectInitialCaption(tracks);
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                if (failed) return;
                if (state == Player.STATE_READY) {
                    applyInitialSeek();
                    canSnapshotCurrentPlayer = !preserveSavedPosition;
                    positionVerified |= canSnapshotCurrentPlayer;
                }
                if (state == Player.STATE_ENDED && player.getPlaybackState() == Player.STATE_ENDED
                    && !isFinishing()) {
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
        view.setPlayer(live ? new ForwardingPlayer(player) {
            @Override
            public Player.Commands getAvailableCommands() {
                return super.getAvailableCommands().buildUpon().removeAll(
                    Player.COMMAND_SEEK_TO_DEFAULT_POSITION, Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
                    Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM, Player.COMMAND_SEEK_TO_PREVIOUS,
                    Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM, Player.COMMAND_SEEK_TO_NEXT,
                    Player.COMMAND_SEEK_TO_MEDIA_ITEM, Player.COMMAND_SEEK_BACK, Player.COMMAND_SEEK_FORWARD
                ).build();
            }

            @Override
            public boolean isCommandAvailable(int command) {
                return getAvailableCommands().contains(command);
            }
        } : player);
        prepareStream();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (player != null && !failed && !isFinishing()) {
            openMediaSession();
            player.setPlayWhenReady(autoplay);
        }
        checkpointHandler.post(cacheCheckpoint);
    }

    private void openMediaSession() {
        Player sessionPlayer = new ForwardingSimpleBasePlayer(player) {
            @Override
            protected State getState() {
                State state = super.getState();
                // Media3 errors can carry provider URLs, which the system session does not need.
                return state.buildUpon().setPlayerError(null).build();
            }

            @Override
            protected ListenableFuture<?> handleStop() {
                finish();
                return Futures.immediateVoidFuture();
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
                    Player.Commands.Builder commands = new Player.Commands.Builder()
                        .addAll(Player.COMMAND_PLAY_PAUSE, Player.COMMAND_STOP);
                    if (!live) commands.addAll(Player.COMMAND_SEEK_BACK, Player.COMMAND_SEEK_FORWARD);
                    return Futures.immediateFuture(MediaSession.ConnectionResult.accept(SessionCommands.EMPTY, commands.build()));
                }

                @Override
                public boolean onMediaButtonEvent(MediaSession session, MediaSession.ControllerInfo controller, Intent intent) {
                    KeyEvent event = intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
                    return controller.isTrusted() && event != null
                        && event.getKeyCode() == KeyEvent.KEYCODE_MEDIA_STOP && handleExitKey(event);
                }
            }).build();
    }

    @Override
    public Object onRetainNonConfigurationInstance() {
        return httpClient;
    }

    private void prepareStream() {
        canSnapshotCurrentPlayer = false;
        preserveSavedPosition = false;
        MediaItem.Builder media = new MediaItem.Builder().setUri(stream.toString());
        if (hls) media.setMimeType(MimeTypes.APPLICATION_M3U8);
        initialSeek = live ? 0 : position;
        player.setMediaItem(media.build());
        player.prepare();
    }

    private void applyInitialSeek() {
        long seek = initialSeek;
        initialSeek = 0;
        if (seek <= 0) return;
        // An out-of-range seek during preparation can leave a progressive stream at EOF.
        long length = player.getDuration();
        if (length != C.TIME_UNSET && seek >= length) return;
        preserveSavedPosition = !player.isCurrentMediaItemSeekable();
        if (!preserveSavedPosition) player.seekTo(seek);
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

    private static boolean hasUnsupportedTrack(Tracks tracks, int type) {
        return tracks.containsType(type) && !tracks.isTypeSupported(type, true);
    }

    private void updateMuteButton() {
        boolean muted = nativeVolume == 0f;
        muteButton.setImageResource(muted
            ? android.R.drawable.ic_lock_silent_mode : android.R.drawable.ic_lock_silent_mode_off);
        muteButton.setContentDescription(getString(muted
            ? R.string.native_playback_unmute : R.string.native_playback_mute));
    }

    private void showError() {
        view.setCustomErrorMessage(getString(R.string.native_playback_failed));
        view.setUseController(false);
        controls.showError();
        releaseMediaSession();
    }

    private void releaseMediaSession() {
        if (mediaSession == null) return;
        mediaSession.release();
        mediaSession = null;
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        // Home can be followed by a launcher relaunch before onStop delivers the result.
        if (!isFinishing()) finish();
    }

    @Override
    protected void onPause() {
        checkpointHandler.removeCallbacks(cacheCheckpoint);
        releaseMediaSession();
        if (player != null) {
            autoplay = player.getPlayWhenReady();
            player.pause();
            if (!isFinishing() && ownsCheckpoint()) pausedCheckpoint = playbackResult();
        }
        super.onPause();
    }

    @Override
    protected void onStop() {
        if (controls != null) controls.dismiss();
        if (player != null) {
            snapshot();
            played = playedMs();
            trackPreferences = player.getTrackSelectionParameters();
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
        if (view != null) outState.putInt("pictureMode", view.getPictureMode());
        outState.putFloat("volume", nativeVolume);
        outState.putLong("position", position);
        outState.putLong("duration", duration);
        outState.putBoolean("positionVerified", positionVerified);
        outState.putBoolean("started", started);
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
        if (view != null && findViewById(R.id.native_controls).hasFocus()) view.showController();
        if (controls != null && controls.handleKeyEvent(event)) return true;
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
        if (ownsCheckpoint() && !isFinishing()) {
            pausedCheckpoint = result;
            Bundle content = getIntent().getBundleExtra("checkpointContent");
            if (content != null) {
                new NativePlaybackCheckpoints(this).saveResult(content, requestId, result);
            }
        }
        setResult(RESULT_OK, result);
        // Android can route media buttons to this session until onStop runs.
        releaseMediaSession();
        super.finish();
    }

    static Intent takeCheckpoint(String id) {
        if (!id.equals(checkpointId)) return null;
        Intent result = pausedCheckpoint;
        checkpointId = null;
        pausedCheckpoint = null;
        return result;
    }

    static void revokeCheckpoint(String id) {
        takeCheckpoint(id);
    }

    private boolean ownsCheckpoint() {
        return requestId != null && requestId.equals(checkpointId);
    }

    private Intent playbackResult() {
        snapshot();
        boolean completed = ended && started && !live;
        // At natural EOF, the terminal playhead gives the runtime of a stream
        // that did not advertise its duration. Back and Home keep the resume guard.
        if (completed && player != null) {
            duration = Math.max(1000, Math.max(player.getDuration(), player.getCurrentPosition()));
            position = duration;
        }
        boolean savePosition = positionVerified || completed;
        return new Intent().putExtra("savedAt", System.currentTimeMillis())
            .putExtra("position", savePosition ? position : 0)
            .putExtra("duration", savePosition ? duration : 0)
            .putExtra("played", playedMs()).putExtra("started", started)
            .putExtra("ended", completed || (live && ended)).putExtra("failed", failed);
    }

    private long playedMs() {
        if (player == null) return played;
        PlaybackStats snapshot = stats.getCombinedPlaybackStats();
        return played + snapshot.getTotalPlayTimeMs();
    }

    private void snapshot() {
        if (player == null || live || !canSnapshotCurrentPlayer) return;
        duration = Math.max(0, player.getDuration());
        position = Math.max(0, player.getCurrentPosition());
        if (duration > 0) position = Math.min(duration, position);
    }
}
