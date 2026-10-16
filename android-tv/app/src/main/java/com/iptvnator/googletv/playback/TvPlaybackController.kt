@file:androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])

package com.iptvnator.googletv.playback

import android.net.Uri
import android.util.Base64
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import android.content.Context
import androidx.media3.common.Player
import androidx.media3.common.PlaybackException
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.ExoPlaybackException
import androidx.media3.session.MediaSession
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.drm.DefaultDrmSessionManager
import androidx.media3.exoplayer.drm.DrmSessionManager
import androidx.media3.exoplayer.drm.FrameworkMediaDrm
import androidx.media3.exoplayer.drm.MediaDrmCallback
import androidx.media3.exoplayer.drm.ExoMediaDrm
import androidx.media3.exoplayer.drm.HttpMediaDrmCallback
import com.iptvnator.googletv.TvDrmConfig
import org.json.JSONArray
import org.json.JSONObject
import okhttp3.OkHttpClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.io.File
import java.nio.charset.StandardCharsets
import java.util.concurrent.TimeUnit
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException

enum class TvPlaybackPhase { IDLE, LOADING, BUFFERING, PLAYING, ENDED, ERROR }

data class TvPlaybackState(
    val phase: TvPlaybackPhase = TvPlaybackPhase.IDLE,
    val message: String? = null,
)

data class TvPlaybackStreamInfo(
    val sourceHost: String?,
    val sourceFormat: String?,
    val video: String?,
    val videoCodec: String?,
    val videoBitrate: String?,
    val audio: String?,
    val audioCodec: String?,
    val audioBitrate: String?,
    val position: String,
    val duration: String,
    val buffered: String,
    val renderedFrames: Int? = null,
    val droppedFrames: Int? = null,
)

/** Support details deliberately contain no stream URL, query string or credentials. */
data class TvPlaybackDiagnostics(
    val report: String,
)

internal fun createTvNetworkDrmConfiguration(drm: TvDrmConfig): MediaItem.DrmConfiguration? {
    if (!drm.supported || drm.clearKeys.isNotEmpty()) return null
    val uuid = when (drm.licenseType) {
        "com.widevine.alpha", "widevine" -> C.WIDEVINE_UUID
        "com.microsoft.playready", "playready" -> C.PLAYREADY_UUID
        else -> return null
    }
    val configuration = MediaItem.DrmConfiguration.Builder(uuid)
        .setLicenseRequestHeaders(drm.licenseHeaders)
    drm.licenseUrl?.let { configuration.setLicenseUri(Uri.parse(it)) }
    return configuration.build()
}

internal fun createTvLicenseCallback(
    defaultLicenseUrl: String?,
    licenseRequestHeaders: Map<String, String>,
    dataSourceFactory: DataSource.Factory,
): HttpMediaDrmCallback = HttpMediaDrmCallback(defaultLicenseUrl, dataSourceFactory).apply {
    licenseRequestHeaders.forEach { (name, value) -> setKeyRequestProperty(name, value) }
}

/** Owns the native TV player and translates IPTV request metadata to Media3. */
class TvPlaybackController(private val context: Context) : Player.Listener, AutoCloseable {
    private val httpClient = createTvStreamingHttpClient(createTvStreamingHostnameVerifier())
    // DRM licenses may be hosted on a different origin from the IPTV stream.
    // Keep playlist/channel headers on the media factory only; the license
    // callback receives its own factory and only its KODIPROP license headers.
    private val drmDataSourceFactory = createTvDrmDataSourceFactory(httpClient)
    private val trackSelector = DefaultTrackSelector(context)
    private val player = ExoPlayer.Builder(context)
        .setTrackSelector(trackSelector)
        .build()
    private val mediaSession = MediaSession.Builder(context, player).build()
    private val playbackPreferences = context.getSharedPreferences("iptvnator-playback", Context.MODE_PRIVATE)
    private val _state = MutableStateFlow(TvPlaybackState())
    val state: StateFlow<TvPlaybackState> = _state.asStateFlow()
    private val reconnectScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var lastRequest: TvPlaybackRequest? = null
    private var externalSubtitle: MediaItem.SubtitleConfiguration? = null
    private var externalSubtitleText: String? = null
    private var externalSubtitleFile: File? = null
    private var subtitleDelayMs = 0L
    private var lastAutoPlay = true
    private var lastPlaybackSpeed = 1f
    private var lastAutoReconnectLive = true
    private var lastAudibleVolume = 1f
    private var lastErrorMessage: String? = null
    private var playbackHasStarted = false
    private var reconnectArmed = false
    private var reconnectAttempts = 0
    private var reconnectJob: Job? = null
    private var stablePlaybackJob: Job? = null
    private var playbackGeneration = 0
    private var isClosed = false
    private var subtitleStyle = loadTvSubtitleStyle(context)

    init {
        val restoredVolume = runCatching {
            normalizeTvPlayerVolume(playbackPreferences.getFloat(TV_PLAYER_VOLUME_PREFERENCE_KEY, 1f))
        }.getOrDefault(1f)
        player.volume = restoredVolume
        lastAudibleVolume = restoredVolume.takeIf { it > 0f } ?: 1f
        player.addListener(this)
    }

    fun setCaptionsEnabled(enabled: Boolean) {
        trackSelector.parameters = trackSelector.buildUponParameters()
            .setRendererDisabled(C.TRACK_TYPE_TEXT, !enabled)
            .build()
    }

    fun subtitleStyle(): TvSubtitleStyle = subtitleStyle

    fun cycleSubtitleSize(): TvSubtitleStyle {
        subtitleStyle = subtitleStyle.nextSize()
        saveTvSubtitleStyle(context, subtitleStyle)
        return subtitleStyle
    }

    fun cycleSubtitleColor(): TvSubtitleStyle {
        subtitleStyle = subtitleStyle.nextColor()
        saveTvSubtitleStyle(context, subtitleStyle)
        return subtitleStyle
    }

    fun player(): ExoPlayer = player

    fun play(
        request: TvPlaybackRequest,
        autoPlay: Boolean = true,
        playbackSpeed: Float = 1f,
        autoReconnectLive: Boolean = true,
    ) {
        cancelReconnect(resetAttempts = true)
        stablePlaybackJob?.cancel()
        stablePlaybackJob = null
        playbackGeneration++
        playbackHasStarted = false
        reconnectArmed = autoPlay && request.isLive
        lastAutoReconnectLive = autoReconnectLive
        loadPlayback(request, autoPlay, playbackSpeed)
    }

    private fun loadPlayback(request: TvPlaybackRequest, autoPlay: Boolean, playbackSpeed: Float) {
        if (lastRequest?.uri != request.uri || lastRequest?.title != request.title) {
            externalSubtitle = null
            externalSubtitleText = null
            externalSubtitleFile?.delete()
            externalSubtitleFile = null
            subtitleDelayMs = 0L
        }
        lastRequest = request
        lastErrorMessage = null
        lastAutoPlay = autoPlay
        lastPlaybackSpeed = playbackSpeed.coerceIn(0.25f, 3f)
        if (request.drm != null && !request.drm.supported) {
            _state.value = TvPlaybackState(
                TvPlaybackPhase.ERROR,
                "Este canal usa DRM ${request.drm.licenseType.ifBlank { "no compatible" }} y Android TV no puede reproducirlo.",
            )
            return
        }
        _state.value = TvPlaybackState(TvPlaybackPhase.LOADING)

        val mediaItem = MediaItem.Builder()
            .setUri(request.uri)
            .setMediaId(request.title)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(request.title)
                    .setArtist(if (request.isAudio) "IPTVnator · Radio" else "IPTVnator · TV")
                    .setIsPlayable(true)
                    .build(),
            )
            .apply {
                request.mimeType?.let(::setMimeType)
                externalSubtitle?.let { setSubtitleConfigurations(listOf(it)) }
                request.drm?.takeIf { it.supported }?.let { drm ->
                    if (drm.clearKeys.isNotEmpty()) {
                        val payload = JSONObject().apply {
                        put("keys", JSONArray().apply {
                            drm.clearKeys.forEach { (kid, key) ->
                                put(JSONObject().put("kty", "oct").put("kid", hexToBase64Url(kid)).put("k", hexToBase64Url(key)))
                            }
                        })
                        put("type", "temporary")
                        }
                        val encoded = Base64.encodeToString(payload.toString().toByteArray(Charsets.UTF_8), Base64.URL_SAFE or Base64.NO_WRAP)
                        setDrmConfiguration(
                            MediaItem.DrmConfiguration.Builder(C.CLEARKEY_UUID)
                                .setLicenseUri(Uri.parse("clearkey://$encoded"))
                                .build()
                        )
                    } else {
                        createTvNetworkDrmConfiguration(drm)?.let(::setDrmConfiguration)
                    }
                }
            }
            .build()

        // Request properties belong to this source, not the controller:
        // channel changes can overlap while Media3 is cancelling old reads.
        // A per-item factory prevents the next channel's credentials from
        // changing requests still in flight for the previous item.
        val playbackDataSourceFactory = createTvPlaybackHttpDataSourceFactory(
            httpClient,
            request.headers,
            request.userAgent ?: "IPTVnator-GoogleTV",
        )
        val playbackMediaSourceFactory = DefaultMediaSourceFactory(
            DefaultDataSource.Factory(context, playbackDataSourceFactory),
        ).setDrmSessionManagerProvider { item -> createDrmSessionManager(item) }
        player.setMediaSource(
            playbackMediaSourceFactory.createMediaSource(mediaItem),
            request.startPositionMs,
        )
        player.setPlaybackSpeed(if (request.isLive) 1f else lastPlaybackSpeed)
        player.prepare()
        player.playWhenReady = autoPlay
    }

    /**
     * Rebuilds the current Media3 item with a user-selected subtitle file.
     * The original desktop client supports external subtitle files; Android TV
     * uses the system document picker and keeps the current playback position.
     */
    fun addExternalSubtitle(uri: Uri, mimeType: String? = null): Boolean {
        val request = lastRequest ?: return false
        if (uri == Uri.EMPTY || player.currentMediaItem == null) return false
        val text = runCatching {
            context.contentResolver.openInputStream(uri)?.use { it.readBytes().toString(StandardCharsets.UTF_8) }
        }.getOrNull()?.takeIf { it.contains("-->") } ?: return false
        externalSubtitleText = text
        subtitleDelayMs = 0L
        val configuration = MediaItem.SubtitleConfiguration.Builder(writeExternalSubtitle(text, uri.toString(), 0L))
            .setMimeType(mimeType ?: subtitleMimeType(uri.toString()))
            .setSelectionFlags(C.SELECTION_FLAG_DEFAULT)
            .build()
        externalSubtitle = configuration
        val positionMs = currentPositionMs()
        val playWhenReady = player.playWhenReady
        play(request.copy(startPositionMs = positionMs), playWhenReady, lastPlaybackSpeed)
        return true
    }

    fun subtitleDelaySeconds(): Float = subtitleDelayMs / 1_000f

    fun hasExternalSubtitle(): Boolean = externalSubtitleText != null

    fun adjustSubtitleDelay(deltaSeconds: Float): Float {
        if (externalSubtitleText == null) return subtitleDelaySeconds()
        subtitleDelayMs = (subtitleDelayMs + (deltaSeconds * 1_000f).toLong()).coerceIn(-60_000L, 60_000L)
        reloadExternalSubtitle()
        return subtitleDelaySeconds()
    }

    fun resetSubtitleDelay(): Float {
        if (externalSubtitleText == null) return subtitleDelaySeconds()
        subtitleDelayMs = 0L
        reloadExternalSubtitle()
        return subtitleDelaySeconds()
    }

    fun retry() {
        lastRequest?.let { request ->
            // A transient stream failure should not throw the viewer back to the
            // beginning of a VOD or catch-up item.
            play(
                if (request.isLive) request else request.copy(startPositionMs = currentPositionMs()),
                lastAutoPlay,
                lastPlaybackSpeed,
                lastAutoReconnectLive,
            )
        }
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
        _state.value = when (playbackState) {
            Player.STATE_BUFFERING -> TvPlaybackState(TvPlaybackPhase.BUFFERING)
            Player.STATE_READY -> TvPlaybackState(TvPlaybackPhase.PLAYING)
            Player.STATE_ENDED -> {
                if (!scheduleAutomaticReconnect(null)) TvPlaybackState(TvPlaybackPhase.ENDED)
                else _state.value
            }
            else -> _state.value
        }
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
        if (isPlaying) {
            playbackHasStarted = true
            reconnectArmed = lastRequest?.isLive == true
            reconnectJob?.cancel()
            reconnectJob = null
            if (reconnectAttempts > 0 && stablePlaybackJob == null) {
                stablePlaybackJob = reconnectScope.launch {
                    delay(TV_PLAYBACK_RECONNECT_STABLE_PLAYBACK_MS)
                    if (player.isPlaying) reconnectAttempts = 0
                    stablePlaybackJob = null
                }
            }
        } else {
            stablePlaybackJob?.cancel()
            stablePlaybackJob = null
        }
    }

    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
        if (reason != Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST) return
        if (!playWhenReady) {
            reconnectArmed = false
            val pending = reconnectJob
            cancelReconnect(resetAttempts = false)
            if (pending != null && playbackHasStarted) {
                _state.value = TvPlaybackState(
                    TvPlaybackPhase.ERROR,
                    "Reconexión automática cancelada. Pulsa Reintentar para volver a reproducir.",
                )
            }
        } else if (playbackHasStarted && lastRequest?.isLive == true) {
            reconnectArmed = true
        }
    }

    override fun onPlayerError(error: PlaybackException) {
        val message = describePlaybackError(error)
        lastErrorMessage = message
        if (scheduleAutomaticReconnect(error)) return
        _state.value = TvPlaybackState(
            TvPlaybackPhase.ERROR,
            if (reconnectAttempts >= TV_PLAYBACK_RECONNECT_MAX_ATTEMPTS && lastRequest?.isLive == true) {
                "$message Se agotaron los $TV_PLAYBACK_RECONNECT_MAX_ATTEMPTS intentos de reconexión automática."
            } else message,
        )
    }

    private fun scheduleAutomaticReconnect(error: PlaybackException?): Boolean {
        val request = lastRequest ?: return false
        if (isClosed || !lastAutoReconnectLive || !request.isLive || !playbackHasStarted ||
            !reconnectArmed || reconnectJob?.isActive == true
        ) {
            return false
        }
        if (error != null && !isRetryablePlaybackError(error)) return false
        if (reconnectAttempts >= TV_PLAYBACK_RECONNECT_MAX_ATTEMPTS) return false

        val attempt = ++reconnectAttempts
        val generation = playbackGeneration
        val waitMs = tvPlaybackReconnectDelayMs(attempt)
        _state.value = TvPlaybackState(
            phase = TvPlaybackPhase.BUFFERING,
            message = "Señal interrumpida. Reconectando (${attempt}/$TV_PLAYBACK_RECONNECT_MAX_ATTEMPTS)…",
        )
        reconnectJob = reconnectScope.launch {
            delay(waitMs)
            if (isClosed || generation != playbackGeneration || !reconnectArmed) {
                reconnectJob = null
                return@launch
            }
            reconnectJob = null
            loadPlayback(request.copy(startPositionMs = 0L), autoPlay = true, playbackSpeed = lastPlaybackSpeed)
        }
        return true
    }

    private fun isRetryablePlaybackError(error: PlaybackException): Boolean {
        return error is ExoPlaybackException && isRetryableTvPlaybackErrorType(error.type)
    }

    private fun cancelReconnect(resetAttempts: Boolean) {
        reconnectJob?.cancel()
        reconnectJob = null
        if (resetAttempts) reconnectAttempts = 0
    }

    /**
     * Generates the same kind of useful support report as IPTVnator's player,
     * but intentionally omits the complete URL: Xtream URLs can contain the
     * account username and password in their path or query.
     */
    fun diagnostics(): TvPlaybackDiagnostics {
        val request = lastRequest
        val uri = request?.uri?.let { runCatching { Uri.parse(it) }.getOrNull() }
        val video = player.videoFormat
        val audio = player.audioFormat
        val lines = buildList {
            add("IPTVnator Google TV - diagnóstico de reproducción")
            add("Título: ${request?.title ?: "desconocido"}")
            add("Origen: ${uri?.scheme ?: "desconocido"}://${uri?.host ?: "desconocido"}")
            add("Tipo: ${if (request?.isAudio == true) "radio" else if (request?.isLive == true) "directo" else "vídeo"}")
            add("Estado: ${_state.value.phase}")
            lastErrorMessage?.let { add("Error: $it") }
            request?.drm?.let { drm ->
                add("DRM: ${drm.licenseType.ifBlank { "desconocido" }} (${if (drm.supported) "compatible" else "no compatible"})")
            }
            video?.let { format ->
                add("Vídeo: ${format.width}x${format.height}, códec=${format.codecs ?: "desconocido"}, bitrate=${format.bitrate}")
            }
            audio?.let { format ->
                add("Audio: ${format.sampleRate} Hz, canales=${format.channelCount}, códec=${format.codecs ?: "desconocido"}, bitrate=${format.bitrate}")
            }
            player.videoDecoderCounters?.also { it.ensureUpdated() }?.let { counters ->
                add("Frames: renderizados=${counters.renderedOutputBufferCount}, descartados=${counters.droppedBufferCount}")
            }
            add("Posición: ${player.currentPosition} ms")
            add("Duración: ${player.duration} ms")
            add("Buffer: ${player.bufferedPosition} ms")
        }
        return TvPlaybackDiagnostics(lines.joinToString("\n"))
    }

    fun pause() {
        player.pause()
    }

    fun resume() {
        player.play()
    }

    fun togglePlayPause() {
        // isPlaying is false during buffering even when playback is requested.
        // Toggle playWhenReady so the remote can pause/resume in that state too.
        player.playWhenReady = !player.playWhenReady
    }

    fun seekBy(deltaMs: Long) {
        if (!player.isCurrentMediaItemLive) {
            player.seekTo((player.currentPosition + deltaMs).coerceAtLeast(0L))
        }
    }

    fun currentPositionMs(): Long = player.currentPosition.coerceAtLeast(0L)

    fun durationMs(): Long = player.duration.takeIf { it > 0L } ?: 0L

    fun streamInfo(): TvPlaybackStreamInfo {
        val request = lastRequest
        val uri = request?.uri?.let { runCatching { Uri.parse(it) }.getOrNull() }
        val video = player.videoFormat
        val audio = player.audioFormat
        val videoCounters = player.videoDecoderCounters?.also { it.ensureUpdated() }
        fun bitrate(value: Int): String? = value.takeIf { it > 0 }?.let { "%.1f Mbps".format(it / 1_000_000.0) }
        fun seconds(value: Long): String {
            val total = (value.coerceAtLeast(0L) / 1_000L)
            return "%02d:%02d".format(total / 60, total % 60)
        }
        return TvPlaybackStreamInfo(
            sourceHost = uri?.host,
            sourceFormat = video?.containerMimeType ?: audio?.containerMimeType ?: request?.mimeType,
            video = video?.let { format ->
                if (format.width > 0 && format.height > 0) {
                    "${format.width}×${format.height}" + format.frameRate.takeIf { it > 0f }?.let { " · %.2f fps".format(it) }.orEmpty()
                } else null
            },
            videoCodec = video?.codecs,
            videoBitrate = video?.let { bitrate(it.bitrate) },
            audio = audio?.let { format ->
                format.sampleRate.takeIf { it > 0 }?.let { rate ->
                    "${rate} Hz" + format.channelCount.takeIf { it > 0 }?.let { " · $it ch" }.orEmpty()
                }
            },
            audioCodec = audio?.codecs,
            audioBitrate = audio?.let { bitrate(it.bitrate) },
            position = seconds(player.currentPosition),
            duration = player.duration.takeIf { it > 0L }?.let(::seconds) ?: "En directo",
            buffered = seconds(player.bufferedPosition),
            renderedFrames = videoCounters?.renderedOutputBufferCount,
            droppedFrames = videoCounters?.droppedBufferCount,
        )
    }

    fun setVolume(volume: Float) {
        val normalized = normalizeTvPlayerVolume(volume)
        player.volume = normalized
        playbackPreferences.edit().putFloat(TV_PLAYER_VOLUME_PREFERENCE_KEY, normalized).apply()
        if (normalized > 0f) lastAudibleVolume = normalized
    }

    fun setPlaybackSpeed(speed: Float) {
        lastPlaybackSpeed = speed.coerceIn(0.25f, 3f)
        if (!player.isCurrentMediaItemLive) player.setPlaybackSpeed(lastPlaybackSpeed)
    }

    fun adjustVolume(delta: Float) {
        setVolume(player.volume + delta)
    }

    fun toggleMute() {
        if (player.volume > 0f) {
            lastAudibleVolume = player.volume
            setVolume(0f)
        } else {
            setVolume(lastAudibleVolume.coerceIn(0.05f, 1f))
        }
    }

    override fun close() {
        isClosed = true
        playbackGeneration++
        cancelReconnect(resetAttempts = true)
        stablePlaybackJob?.cancel()
        stablePlaybackJob = null
        reconnectScope.cancel()
        player.removeListener(this)
        mediaSession.release()
        player.release()
    }

    private fun describePlaybackError(error: PlaybackException): String {
        var cause: Throwable? = error
        while (cause != null) {
            when (cause) {
                is HttpDataSource.InvalidResponseCodeException -> {
                    val code = cause.responseCode
                    return when (code) {
                        401, 403 -> "El servidor ha rechazado el acceso (HTTP $code). Comprueba las credenciales o los permisos del canal."
                        404 -> "Este canal no está disponible (HTTP 404). Puede que el proveedor haya cambiado o retirado la URL."
                        in 500..599 -> "El servidor del canal no responde correctamente (HTTP $code). Inténtalo de nuevo más tarde."
                        else -> "El servidor del canal respondió HTTP $code."
                    }
                }
                is UnknownHostException -> return "No se encuentra el servidor del canal. Comprueba la conexión de red."
                is SocketTimeoutException -> return "El servidor del canal tardó demasiado en responder."
                is ConnectException -> return "No se pudo conectar con el servidor del canal."
                is SSLPeerUnverifiedException, is SSLHandshakeException ->
                    return "La conexión segura del canal no pudo verificarse."
            }
            cause = cause.cause
        }
        return "No se pudo reproducir el canal. (${error.errorCodeName})"
    }

    private fun createTvStreamingHostnameVerifier(): HostnameVerifier {
        val defaultVerifier = HostnameVerifier { hostname, session ->
            javax.net.ssl.HttpsURLConnection.getDefaultHostnameVerifier().verify(hostname, session)
        }
        return HostnameVerifier { hostname, session ->
            if (defaultVerifier.verify(hostname, session)) return@HostnameVerifier true
            val alias = if (hostname.startsWith("www.", ignoreCase = true)) {
                hostname.removePrefix("www.")
            } else {
                "www.$hostname"
            }
            // Some IPTV endpoints serve a certificate for only one side of a
            // www/non-www pair. Keep normal certificate-chain validation and
            // allow only that exact, narrowly-scoped hostname alias.
            defaultVerifier.verify(alias, session)
        }
    }

    private fun createDrmSessionManager(item: MediaItem): DrmSessionManager {
        val drmConfiguration = item.localConfiguration?.drmConfiguration
        val uri = drmConfiguration?.licenseUri
        if (uri?.scheme != "clearkey") {
            val uuid = item.localConfiguration?.drmConfiguration?.scheme?.let {
                when {
                    it == C.WIDEVINE_UUID -> C.WIDEVINE_UUID
                    it == C.PLAYREADY_UUID -> C.PLAYREADY_UUID
                    else -> null
                }
            }
            return if (uuid != null) {
                DefaultDrmSessionManager.Builder()
                    .setUuidAndExoMediaDrmProvider(uuid, FrameworkMediaDrm.DEFAULT_PROVIDER)
                    .build(
                        createTvLicenseCallback(
                            uri?.toString(),
                            drmConfiguration?.licenseRequestHeaders.orEmpty(),
                            drmDataSourceFactory,
                        ),
                    )
            } else DrmSessionManager.DRM_UNSUPPORTED
        }
        val response = runCatching {
            Base64.decode(uri.schemeSpecificPart, Base64.URL_SAFE or Base64.NO_WRAP)
        }.getOrNull() ?: return DrmSessionManager.DRM_UNSUPPORTED
        return DefaultDrmSessionManager.Builder()
            .setUuidAndExoMediaDrmProvider(C.CLEARKEY_UUID, FrameworkMediaDrm.DEFAULT_PROVIDER)
            .setPlayClearSamplesWithoutKeys(false)
            .build(object : MediaDrmCallback {
                override fun executeProvisionRequest(
                    uuid: java.util.UUID,
                    request: ExoMediaDrm.ProvisionRequest,
                ): MediaDrmCallback.Response = MediaDrmCallback.Response(ByteArray(0))

                override fun executeKeyRequest(
                    uuid: java.util.UUID,
                    request: ExoMediaDrm.KeyRequest,
                ): MediaDrmCallback.Response = MediaDrmCallback.Response(response)
            })
    }

    private fun hexToBase64Url(hex: String): String {
        val bytes = hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    }

    private fun reloadExternalSubtitle() {
        val request = lastRequest ?: return
        val text = externalSubtitleText ?: return
        val currentPosition = currentPositionMs()
        val playing = player.playWhenReady
        externalSubtitle = MediaItem.SubtitleConfiguration.Builder(
            writeExternalSubtitle(text, request.uri, subtitleDelayMs),
        ).setMimeType(subtitleMimeType(request.uri)).setSelectionFlags(C.SELECTION_FLAG_DEFAULT).build()
        play(request.copy(startPositionMs = currentPosition), playing, lastPlaybackSpeed)
    }

    private fun writeExternalSubtitle(text: String, source: String, delayMs: Long): Uri {
        externalSubtitleFile?.delete()
        val suffix = if (source.substringBefore('?').endsWith(".vtt", true)) ".vtt" else ".srt"
        val file = File.createTempFile("iptvnator-subtitle-", suffix, context.cacheDir)
        file.writeText(shiftTvSubtitleCues(text, delayMs), StandardCharsets.UTF_8)
        externalSubtitleFile = file
        return Uri.fromFile(file)
    }
}

/**
 * A live MPEG-TS response can stay open indefinitely, and HLS providers may
 * leave gaps between segments. OkHttp's 10-second default is a per-read idle
 * timeout, not a whole-stream deadline, so it can incorrectly kill a healthy
 * IPTV stream. Keep connection establishment bounded but allow the player to
 * manage read cancellation/recovery itself.
 */
internal fun createTvStreamingHttpClient(hostnameVerifier: HostnameVerifier): OkHttpClient =
    OkHttpClient.Builder()
        .hostnameVerifier(hostnameVerifier)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .callTimeout(0, TimeUnit.MILLISECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

/** A license request must not inherit stream-specific default request properties. */
internal fun createTvDrmDataSourceFactory(client: OkHttpClient): OkHttpDataSource.Factory =
    OkHttpDataSource.Factory(client)

/** Keeps each media item's IPTV authorization and User-Agent on its own factory. */
internal fun createTvPlaybackHttpDataSourceFactory(
    client: OkHttpClient,
    requestHeaders: Map<String, String>,
    userAgent: String,
): OkHttpDataSource.Factory = OkHttpDataSource.Factory(client).apply {
    setDefaultRequestProperties(requestHeaders)
    setUserAgent(userAgent)
}

internal fun subtitleMimeType(uri: String): String = when {
    uri.substringBefore('?').endsWith(".vtt", ignoreCase = true) -> "text/vtt"
    uri.substringBefore('?').endsWith(".ass", ignoreCase = true) ||
        uri.substringBefore('?').endsWith(".ssa", ignoreCase = true) -> "text/x-ssa"
    else -> "application/x-subrip"
}
