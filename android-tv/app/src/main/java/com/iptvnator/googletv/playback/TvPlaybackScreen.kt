@file:androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])

package com.iptvnator.googletv.playback

import android.view.ViewGroup
import android.view.View
import android.content.ContentUris
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.provider.MediaStore
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Text
import androidx.compose.material3.ButtonDefaults
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.viewinterop.AndroidView
import coil.compose.AsyncImage
import androidx.media3.ui.PlayerView
import androidx.media3.ui.TrackSelectionDialogBuilder
import androidx.media3.common.C
import kotlinx.coroutines.delay
import com.iptvnator.googletv.tvDpadFocus
import com.iptvnator.googletv.MainActivity
import com.iptvnator.googletv.appendTvChannelNumberDigit
import com.iptvnator.googletv.TV_CHANNEL_NUMBER_INPUT_TIMEOUT_MS
import com.iptvnator.googletv.tvColor
import com.iptvnator.googletv.tvTone
import com.iptvnator.googletv.TvTone
import com.iptvnator.googletv.TvButton
import com.iptvnator.googletv.TvCard
import com.iptvnator.googletv.TvTextButton
import com.iptvnator.googletv.TvAlertDialog
import com.iptvnator.googletv.TvOutlinedTextField
import com.iptvnator.googletv.TvType
import com.iptvnator.googletv.TvEyebrow
import com.iptvnator.googletv.TvLiveBadge
import com.iptvnator.googletv.LocalTvFocusRadius
import androidx.compose.ui.graphics.Brush
import com.iptvnator.googletv.epg.TvEpgEntry
import kotlinx.coroutines.withContext
import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope
import com.iptvnator.googletv.recording.TvLiveRecordingManager
import com.iptvnator.googletv.recording.TvRecordingStatus

data class TvPlaybackGuide(
    val channelName: String,
    val current: TvEpgEntry?,
    val next: TvEpgEntry?,
    val providerClockOffsetMs: Long = 0L,
    val sourceName: String? = null,
)

data class TvPlaybackChannelOption(
    val key: String,
    val title: String,
    val group: String? = null,
    val logoUrl: String? = null,
    val currentProgram: String? = null,
    val catchupAvailable: Boolean = false,
)

data class TvPlaybackEpisodeOption(
    val key: Int,
    val season: Int,
    val number: Int,
    val title: String,
    val plot: String? = null,
    val duration: String? = null,
    val coverUrl: String? = null,
    val completed: Boolean = false,
    val progressLabel: String? = null,
)

internal val TV_PLAYBACK_SPEED_OPTIONS = listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 2f)

internal fun nextTvPlaybackSpeed(current: Float): Float {
    val index = TV_PLAYBACK_SPEED_OPTIONS.indexOfFirst { kotlin.math.abs(it - current) < 0.01f }
        .coerceAtLeast(0)
    return TV_PLAYBACK_SPEED_OPTIONS[(index + 1) % TV_PLAYBACK_SPEED_OPTIONS.size]
}

internal fun playbackSpeedLabel(speed: Float): String = when (speed) {
    0.5f -> "0,5"
    0.75f -> "0,75"
    1f -> "1"
    1.25f -> "1,25"
    1.5f -> "1,5"
    2f -> "2"
    else -> speed.toString().replace('.', ',')
}

private fun subtitleDelayLabel(seconds: Float): String {
    if (kotlin.math.abs(seconds) < 0.001f) return "0 s"
    val sign = if (seconds > 0f) "+" else "−"
    return "$sign${kotlin.math.abs(seconds).toString().replace('.', ',')} s"
}

private class TvPlayerView(
    context: android.content.Context,
    var onChannelChange: ((Int) -> Unit)?,
    var onPlaybackShortcut: ((Int) -> Boolean)?,
    var isOverlayActionFocused: (() -> Boolean)?,
    var onRemoteActivity: (() -> Unit)?,
    var onControllerVisibilityChanged: ((Boolean) -> Unit)?,
) : PlayerView(context) {
    init {
        // Nocturno accent on the native transport so the scrub position
        // matches the rest of the TV surface instead of stock white.
        findViewById<androidx.media3.ui.DefaultTimeBar>(androidx.media3.ui.R.id.exo_progress)?.apply {
            setPlayedColor(0xFFFFB547.toInt())
            setScrubberColor(0xFFFFD493.toInt())
            setBufferedColor(0x66F4EFE6)
            setUnplayedColor(0x33F4EFE6)
        }
        setControllerVisibilityListener(
            PlayerView.ControllerVisibilityListener { visibility ->
                onControllerVisibilityChanged?.invoke(visibility == View.VISIBLE)
            },
        )
    }

    override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
        if (event.action == android.view.KeyEvent.ACTION_DOWN &&
            isTvControllerWakeKey(event.keyCode)
        ) {
            onRemoteActivity?.invoke()
            // Native-focused keys also wake Media3; onRemoteActivity resets
            // the shared Compose inactivity timer for the action row.
            showController()
        }
        // Compose owns the subtitle/audio buttons layered above this PlayerView.
        // Let those buttons receive navigation and OK; otherwise Media3 would
        // turn the same keys into seek/playback commands before Compose sees them.
        if (event.action == android.view.KeyEvent.ACTION_DOWN &&
            isOverlayActionFocused?.invoke() == true &&
            isTvOverlayNavigationKey(event.keyCode)
        ) {
            // Returning false bubbles the event to the Compose host, where the
            // focused overlay button can perform focus navigation or click.
            return false
        }
        if (event.action == android.view.KeyEvent.ACTION_DOWN &&
            isTvPlaybackShortcutKey(event.keyCode) &&
            (!isTvPlaybackToggleKey(event.keyCode) || event.repeatCount == 0) &&
            onPlaybackShortcut?.invoke(event.keyCode) == true
        ) {
            return true
        }
        val channelChange = onChannelChange
        if (event.action == android.view.KeyEvent.ACTION_DOWN && channelChange != null) {
            val delta = when (event.keyCode) {
                // Match IPTVnator's remote navigation: "up" is the previous
                // item in the provider's channel order, "down" the next.
                android.view.KeyEvent.KEYCODE_CHANNEL_UP -> -1
                android.view.KeyEvent.KEYCODE_CHANNEL_DOWN -> 1
                android.view.KeyEvent.KEYCODE_PAGE_UP -> -1
                android.view.KeyEvent.KEYCODE_PAGE_DOWN -> 1
                else -> null
            }
            if (delta != null) {
                channelChange(delta)
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onDetachedFromWindow() {
        keepScreenOn = false
        super.onDetachedFromWindow()
    }
}

private data class TvSubtitleFile(
    val uri: android.net.Uri,
    val name: String,
    val location: String,
)

@Composable
private fun TvSubtitlePickerDialog(
    onDismiss: () -> Unit,
    onSelect: (android.net.Uri, String?) -> Unit,
) {
    val context = LocalContext.current
    var files by remember { androidx.compose.runtime.mutableStateOf<List<TvSubtitleFile>>(emptyList()) }
    var loading by remember { androidx.compose.runtime.mutableStateOf(true) }
    LaunchedEffect(Unit) {
        files = withContext(kotlinx.coroutines.Dispatchers.IO) { queryTvSubtitleFiles(context) }
        loading = false
    }
    TvAlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Elegir subtítulos") },
        text = {
            if (loading) {
                Text("Buscando archivos…")
            } else if (files.isEmpty()) {
                Text("No hay archivos SRT, VTT, SSA o ASS en Descargas.", color = Color.Gray)
            } else {
                Column(
                    modifier = Modifier.verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    files.forEach { file ->
                        TvButton(
                            onClick = { onSelect(file.uri, context.contentResolver.getType(file.uri)) },
                            modifier = Modifier.fillMaxWidth().tvDpadFocus(),
                        ) {
                            Column {
                                Text(file.name)
                                Text(file.location, fontSize = 11.sp, color = Color.LightGray)
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TvTextButton(onClick = onDismiss, modifier = Modifier.tvDpadFocus()) { Text("Cancelar") }
        },
    )
}

@Composable
private fun TvSubtitleOptionsDialog(
    onDismiss: () -> Unit,
    onEmbeddedTracks: () -> Unit,
    onExternalFile: () -> Unit,
    onDisable: () -> Unit,
    subtitleStyle: TvSubtitleStyle,
    onCycleSubtitleSize: () -> Unit,
    onCycleSubtitleColor: () -> Unit,
    subtitleDelaySeconds: Float,
    onDecreaseSubtitleDelay: () -> Unit,
    onIncreaseSubtitleDelay: () -> Unit,
    onResetSubtitleDelay: () -> Unit,
    hasExternalSubtitle: Boolean,
) {
    TvAlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Subtítulos") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                TvButton(
                    onClick = onEmbeddedTracks,
                    modifier = Modifier.fillMaxWidth().tvDpadFocus(),
                ) { Text("Pista integrada") }
                TvButton(
                    onClick = onExternalFile,
                    modifier = Modifier.fillMaxWidth().tvDpadFocus(),
                ) { Text("Cargar archivo SRT/VTT") }
                TvButton(
                    onClick = onDisable,
                    modifier = Modifier.fillMaxWidth().tvDpadFocus(),
                ) { Text("Desactivar") }
                TvButton(
                    onClick = onCycleSubtitleSize,
                    modifier = Modifier.fillMaxWidth().tvDpadFocus(),
                ) { Text("Tamaño: ${subtitleStyle.sizeLabel()}") }
                TvButton(
                    onClick = onCycleSubtitleColor,
                    modifier = Modifier.fillMaxWidth().tvDpadFocus(),
                ) { Text("Color: ${subtitleStyle.colorLabel()}") }
                if (hasExternalSubtitle) {
                    TvButton(
                        onClick = onDecreaseSubtitleDelay,
                        modifier = Modifier.fillMaxWidth().tvDpadFocus(),
                    ) { Text("Retraso −0,5 s  (${subtitleDelayLabel(subtitleDelaySeconds)})") }
                    TvButton(
                        onClick = onIncreaseSubtitleDelay,
                        modifier = Modifier.fillMaxWidth().tvDpadFocus(),
                    ) { Text("Retraso +0,5 s  (${subtitleDelayLabel(subtitleDelaySeconds)})") }
                    TvButton(
                        onClick = onResetSubtitleDelay,
                        modifier = Modifier.fillMaxWidth().tvDpadFocus(),
                    ) { Text("Restablecer retraso") }
                }
            }
        },
        confirmButton = {
            TvTextButton(onClick = onDismiss, modifier = Modifier.tvDpadFocus()) {
                Text("Cancelar")
            }
        },
    )
}

@Composable
private fun TvPlaybackInfoDialog(
    info: TvPlaybackStreamInfo,
    onDismiss: () -> Unit,
) {
    TvAlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Detalles técnicos") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                info.sourceHost?.let { Text("Servidor: $it") }
                info.sourceFormat?.let { Text("Formato: $it") }
                info.video?.let { Text("Vídeo: $it") }
                info.videoCodec?.let { Text("Códec de vídeo: $it") }
                info.videoBitrate?.let { Text("Bitrate de vídeo: $it") }
                info.audio?.let { Text("Audio: $it") }
                info.audioCodec?.let { Text("Códec de audio: $it") }
                info.audioBitrate?.let { Text("Bitrate de audio: $it") }
                Text("Posición: ${info.position} · Duración: ${info.duration}")
                Text("Buffer: ${info.buffered}")
                info.renderedFrames?.let { rendered ->
                    Text("Frames renderizados: $rendered")
                }
                info.droppedFrames?.let { dropped ->
                    Text("Frames descartados: $dropped")
                }
            }
        },
        confirmButton = {
            TvTextButton(onClick = onDismiss, modifier = Modifier.tvDpadFocus()) { Text("Cerrar") }
        },
    )
}

@Composable
private fun TvPlaybackDiagnosticsDialog(
    diagnostics: TvPlaybackDiagnostics,
    onDismiss: () -> Unit,
    onCopy: () -> Unit,
) {
    TvAlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Diagnóstico de reproducción") },
        text = {
            Text(
                diagnostics.report,
                modifier = Modifier.verticalScroll(rememberScrollState()),
                color = tvColor(Color(0xFFE7E9F0)),
            )
        },
        confirmButton = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TvTextButton(onClick = onCopy, modifier = Modifier.tvDpadFocus()) {
                    Text("Copiar informe")
                }
                TvTextButton(onClick = onDismiss, modifier = Modifier.tvDpadFocus()) {
                    Text("Cerrar")
                }
            }
        },
    )
}

@Composable
private fun TvPlaybackEpisodeDialog(
    episodes: List<TvPlaybackEpisodeOption>,
    currentKey: Int?,
    onSelect: (TvPlaybackEpisodeOption) -> Unit,
    onDismiss: () -> Unit,
) {
    val seasons = remember(episodes) { episodes.map { it.season }.distinct().sorted() }
    var selectedSeason by remember(episodes) { mutableStateOf(episodes.firstOrNull { it.key == currentKey }?.season ?: seasons.firstOrNull()) }
    val visible = episodes.filter { selectedSeason == null || it.season == selectedSeason }
    val firstEpisodeFocusRequester = remember(visible) { FocusRequester() }
    LaunchedEffect(visible, selectedSeason) {
        repeat(6) {
            delay(100)
            runCatching { firstEpisodeFocusRequester.requestFocus() }
        }
    }
    TvAlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Episodios") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (seasons.size > 1) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        seasons.forEach { season ->
                            TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                                onClick = { selectedSeason = season },
                                modifier = Modifier.height(30.dp).weight(1f).tvDpadFocus(),
                                colors = androidx.tv.material3.CardDefaults.colors(
                                    containerColor = if (selectedSeason == season) tvColor(Color(0xFF263A5A)) else tvColor(Color(0xFF202532)),
                                    focusedContainerColor = tvColor(Color(0xFF536A9F)),
                                ),
                            ) {
                                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                    Text("T$season", color = Color.White)
                                }
                            }
                        }
                    }
                }
                LazyColumn(
                    modifier = Modifier.fillMaxWidth().heightIn(max = 280.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    itemsIndexed(visible, key = { _, episode -> episode.key }) { index, episode ->
                        TvCard(
                            onClick = { onSelect(episode) },
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = 40.dp)
                                .then(if (index == 0) Modifier.focusRequester(firstEpisodeFocusRequester) else Modifier)
                                .tvDpadFocus(),
                            colors = androidx.tv.material3.CardDefaults.colors(
                                containerColor = if (episode.key == currentKey) tvColor(Color(0xFF2C3445)) else tvColor(Color(0xFF202532)),
                                focusedContainerColor = tvColor(Color(0xFF536A9F)),
                            ),
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 5.dp),
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                episode.coverUrl?.takeIf(String::isNotBlank)?.let { cover ->
                                    AsyncImage(
                                        model = cover,
                                        contentDescription = null,
                                        modifier = Modifier.size(width = 48.dp, height = 28.dp).clip(RoundedCornerShape(5.dp)),
                                        contentScale = ContentScale.Crop,
                                    )
                                }
                                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    Text(
                                        "${if (episode.completed) "✓ " else ""}${episode.number}. ${episode.title}",
                                        color = Color.White,
                                        fontSize = 12.sp,
                                        maxLines = 1,
                                    )
                                    listOfNotNull(episode.progressLabel, episode.duration).takeIf { it.isNotEmpty() }?.let {
                                        Text(it.joinToString(" · "), color = tvColor(Color(0xFFADB2C0)), fontSize = 9.sp)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TvTextButton(onClick = onDismiss, modifier = Modifier.tvDpadFocus()) { Text("Cerrar") }
        },
    )
}

private fun queryTvSubtitleFiles(context: Context): List<TvSubtitleFile> {
    val suffixes = listOf("srt", "vtt", "ass", "ssa")
    val collection = MediaStore.Files.getContentUri("external")
    val projection = arrayOf(
        MediaStore.Files.FileColumns._ID,
        MediaStore.Files.FileColumns.DISPLAY_NAME,
        MediaStore.Files.FileColumns.RELATIVE_PATH,
    )
    return buildList {
        context.contentResolver.query(
            collection,
            projection,
            null,
            null,
            "${MediaStore.Files.FileColumns.DISPLAY_NAME} ASC",
        )?.use { cursor ->
            val idIndex = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
            val nameIndex = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DISPLAY_NAME)
            val pathIndex = cursor.getColumnIndex(MediaStore.Files.FileColumns.RELATIVE_PATH)
            while (cursor.moveToNext()) {
                val name = cursor.getString(nameIndex)
                if (name.substringAfterLast('.', "").lowercase() !in suffixes) continue
                val path = if (pathIndex >= 0) cursor.getString(pathIndex).orEmpty() else ""
                add(TvSubtitleFile(ContentUris.withAppendedId(collection, cursor.getLong(idIndex)), name, path))
            }
        }
        context.getExternalFilesDir(null)?.walkTopDown()?.filter { file ->
            file.isFile && file.extension.lowercase() in suffixes
        }?.forEach { file ->
            add(TvSubtitleFile(android.net.Uri.fromFile(file), file.name, file.parentFile?.name.orEmpty()))
        }
    }.distinctBy { it.uri.toString() }
}

internal fun isTvPlaybackShortcutKey(keyCode: Int): Boolean = keyCode == android.view.KeyEvent.KEYCODE_DPAD_LEFT ||
    keyCode == android.view.KeyEvent.KEYCODE_DPAD_RIGHT ||
    keyCode == android.view.KeyEvent.KEYCODE_DPAD_CENTER ||
    keyCode == android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE ||
    keyCode == android.view.KeyEvent.KEYCODE_DPAD_UP ||
    keyCode == android.view.KeyEvent.KEYCODE_DPAD_DOWN ||
    keyCode == android.view.KeyEvent.KEYCODE_MUTE

internal fun isTvPlaybackToggleKey(keyCode: Int): Boolean =
    keyCode == android.view.KeyEvent.KEYCODE_DPAD_CENTER ||
        keyCode == android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE

/** Keep all DPAD directions available to Compose while an overlay button is focused. */
internal fun isTvOverlayNavigationKey(keyCode: Int): Boolean = when (keyCode) {
    android.view.KeyEvent.KEYCODE_DPAD_LEFT,
    android.view.KeyEvent.KEYCODE_DPAD_RIGHT,
    android.view.KeyEvent.KEYCODE_DPAD_UP,
    android.view.KeyEvent.KEYCODE_DPAD_DOWN,
    android.view.KeyEvent.KEYCODE_DPAD_CENTER,
    android.view.KeyEvent.KEYCODE_ENTER -> true
    else -> false
}

internal fun isTvControllerWakeKey(keyCode: Int): Boolean =
    isTvOverlayNavigationKey(keyCode) ||
        isTvPlaybackShortcutKey(keyCode) ||
        when (keyCode) {
            android.view.KeyEvent.KEYCODE_CHANNEL_UP,
            android.view.KeyEvent.KEYCODE_CHANNEL_DOWN,
            android.view.KeyEvent.KEYCODE_PAGE_UP,
            android.view.KeyEvent.KEYCODE_PAGE_DOWN -> true
            else -> false
        }

internal fun isTvChannelDigitKey(keyCode: Int): Boolean =
    keyCode in android.view.KeyEvent.KEYCODE_0..android.view.KeyEvent.KEYCODE_9 ||
        keyCode in android.view.KeyEvent.KEYCODE_NUMPAD_0..android.view.KeyEvent.KEYCODE_NUMPAD_9

internal fun tvChannelDigit(keyCode: Int): Char? = when {
    keyCode in android.view.KeyEvent.KEYCODE_0..android.view.KeyEvent.KEYCODE_9 ->
        ('0'.code + keyCode - android.view.KeyEvent.KEYCODE_0).toChar()
    keyCode in android.view.KeyEvent.KEYCODE_NUMPAD_0..android.view.KeyEvent.KEYCODE_NUMPAD_9 ->
        ('0'.code + keyCode - android.view.KeyEvent.KEYCODE_NUMPAD_0).toChar()
    else -> null
}

@Composable
fun TvPlaybackScreen(
    request: TvPlaybackRequest,
    recordingManager: TvLiveRecordingManager,
    onExit: () -> Unit,
    onPositionChanged: (positionMs: Long, durationMs: Long) -> Unit = { _, _ -> },
    onChannelChange: ((delta: Int) -> Unit)? = null,
    onChannelNumber: ((number: Int) -> Unit)? = null,
    channelOptions: List<TvPlaybackChannelOption> = emptyList(),
    favoriteChannelOptions: List<TvPlaybackChannelOption> = emptyList(),
    recentChannelOptions: List<TvPlaybackChannelOption> = emptyList(),
    onChannelOptionSelected: ((TvPlaybackChannelOption) -> Unit)? = null,
    onChannelPickerOpened: (() -> Unit)? = null,
    onChannelPickerGroupingChanged: ((Boolean) -> Unit)? = null,
    channelPickerLoading: Boolean = false,
    channelPickerHasMore: Boolean = false,
    onLoadMoreChannels: (() -> Unit)? = null,
    onChannelPickerSearch: ((String) -> Unit)? = null,
    captionsEnabled: Boolean = true,
    autoPlayEnabled: Boolean = true,
    autoReconnectLiveEnabled: Boolean = true,
    playbackSpeed: Float = 1f,
    onPlaybackSpeedChange: ((Float) -> Unit)? = null,
    guide: TvPlaybackGuide? = null,
    onPreviousEpisode: (() -> Unit)? = null,
    onNextEpisode: (() -> Unit)? = null,
    onPlaybackEnded: (() -> Unit)? = null,
    canPreviousEpisode: Boolean = false,
    canNextEpisode: Boolean = false,
    episodeOptions: List<TvPlaybackEpisodeOption> = emptyList(),
    currentEpisodeKey: Int? = null,
    onEpisodeOptionSelected: ((TvPlaybackEpisodeOption) -> Unit)? = null,
    onPlaybackError: (positionMs: Long) -> Unit = {},
    playbackNotice: String? = null,
    onEnterPictureInPicture: (() -> Boolean)? = null,
) {
    val context = LocalContext.current
    val playbackActionColors = ButtonDefaults.buttonColors(
        containerColor = Color(0xB3121317),
        contentColor = Color(0xFFF4EFE6),
        disabledContainerColor = Color(0x66121317),
        disabledContentColor = Color(0xFFF4EFE6).copy(alpha = 0.4f),
    )
    val softwareKeyboardController = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    val controller = remember(context) { TvPlaybackController(context) }
    val state by controller.state.collectAsState()
    val activeRecording by recordingManager.active.collectAsState()
    val recordingScope = rememberCoroutineScope()
    val latestRequest by rememberUpdatedState(request)
    val latestChannelNumberCallback by rememberUpdatedState(onChannelNumber)
    val latestPositionChanged by rememberUpdatedState(onPositionChanged)
    val latestAutoPlayEnabled by rememberUpdatedState(autoPlayEnabled)
    val latestPlaybackEnded by rememberUpdatedState(onPlaybackEnded)
    val latestCanNextEpisode by rememberUpdatedState(canNextEpisode)
    val playbackSurfaceFocusRequester = remember { FocusRequester() }
    val retryFocusRequester = remember { FocusRequester() }
    val subtitleFocusRequester = remember { FocusRequester() }
    val audioFocusRequester = remember { FocusRequester() }
    val qualityFocusRequester = remember { FocusRequester() }
    val aspectFocusRequester = remember { FocusRequester() }
    val pictureInPictureFocusRequester = remember { FocusRequester() }
    val infoFocusRequester = remember { FocusRequester() }
    val episodeFocusRequester = remember { FocusRequester() }
    val speedFocusRequester = remember { FocusRequester() }
    val recordingFocusRequester = remember { FocusRequester() }
    val channelFocusRequester = remember { FocusRequester() }
    val previousEpisodeFocusRequester = remember { FocusRequester() }
    val nextEpisodeFocusRequester = remember { FocusRequester() }
    var guideNowMs by remember { androidx.compose.runtime.mutableStateOf(System.currentTimeMillis()) }
    var channelNumberInput by remember { androidx.compose.runtime.mutableStateOf("") }
    var subtitleNotice by remember { androidx.compose.runtime.mutableStateOf<String?>(null) }
    var showSubtitlePicker by remember { androidx.compose.runtime.mutableStateOf(false) }
    var showSubtitleOptions by remember { androidx.compose.runtime.mutableStateOf(false) }
    var subtitleStyle by remember(controller) { androidx.compose.runtime.mutableStateOf(controller.subtitleStyle()) }
    var subtitleDelaySeconds by remember(controller) { androidx.compose.runtime.mutableStateOf(controller.subtitleDelaySeconds()) }
    var playbackOverlayActionFocused by remember { androidx.compose.runtime.mutableStateOf(false) }
    var playbackControlsVisible by remember { androidx.compose.runtime.mutableStateOf(true) }
    var controlsActivitySequence by remember { androidx.compose.runtime.mutableIntStateOf(0) }
    var playerView by remember { androidx.compose.runtime.mutableStateOf<TvPlayerView?>(null) }
    var recordingNotice by remember { androidx.compose.runtime.mutableStateOf<String?>(null) }
    fun markPlaybackOverlayActivity() {
        controlsActivitySequence++
        playbackControlsVisible = true
        playerView?.showController()
    }
    fun performPlaybackAction(action: () -> Unit) {
        markPlaybackOverlayActivity()
        action()
    }
    LaunchedEffect(activeRecording?.startedAtMs, activeRecording?.status) {
        val finished = activeRecording?.takeIf { it.status != TvRecordingStatus.RECORDING } ?: return@LaunchedEffect
        recordingNotice = when (finished.status) {
            TvRecordingStatus.FAILED -> "No se pudo grabar: ${finished.error ?: "el formato no está disponible"}"
            TvRecordingStatus.INTERRUPTED -> "Grabación interrumpida"
            TvRecordingStatus.COMPLETED -> "Grabación guardada: ${finished.file.name}"
            TvRecordingStatus.RECORDING -> null
        }
    }
    var showChannelPicker by remember { androidx.compose.runtime.mutableStateOf(false) }
    var channelPickerView by remember { androidx.compose.runtime.mutableStateOf("all") }
    var channelPickerSearch by remember { androidx.compose.runtime.mutableStateOf("") }
    var focusedChannelKey by remember { androidx.compose.runtime.mutableStateOf<String?>(null) }
    val channelSearchFocusRequester = remember { FocusRequester() }
    val firstChannelItemFocusRequester = remember { FocusRequester() }
    val channelTabFocusRequesters = remember { List(4) { FocusRequester() } }
    fun openChannelPicker() {
        channelPickerSearch = ""
        channelPickerView = "all"
        focusedChannelKey = null
        showChannelPicker = true
        onChannelPickerOpened?.invoke()
    }
    val filteredChannelOptions by produceState(
        initialValue = emptyList<TvPlaybackChannelOption>(),
        channelPickerView,
        channelOptions,
        favoriteChannelOptions,
        recentChannelOptions,
        channelPickerSearch,
    ) {
        // Xtream queues can contain tens of thousands of channels. Sorting the
        // Groups tab and filtering each search keystroke on Compose's main
        // dispatcher can stall both DPAD focus and the on-screen keyboard.
        value = withContext(kotlinx.coroutines.Dispatchers.Default) {
            val options = when (channelPickerView) {
                "favorites" -> favoriteChannelOptions
                "recent" -> recentChannelOptions
                // Grouped channel pages are ordered in SQLite before LIMIT/OFFSET;
                // sorting this partial window here would break ordering at page boundaries.
                "groups" -> channelOptions
                else -> channelOptions
            }
            if (channelPickerSearch.isBlank()) {
                options
            } else {
                options.filter { option ->
                    option.title.contains(channelPickerSearch, ignoreCase = true) ||
                        option.group?.contains(channelPickerSearch, ignoreCase = true) == true ||
                        option.currentProgram?.contains(channelPickerSearch, ignoreCase = true) == true
                }
            }
        }
    }
    val latestFilteredChannelOptions by rememberUpdatedState(filteredChannelOptions)
    var streamInfo by remember { androidx.compose.runtime.mutableStateOf<TvPlaybackStreamInfo?>(null) }
    var diagnostics by remember { androidx.compose.runtime.mutableStateOf<TvPlaybackDiagnostics?>(null) }
    var diagnosticsNotice by remember { androidx.compose.runtime.mutableStateOf<String?>(null) }
    var showEpisodePicker by remember { androidx.compose.runtime.mutableStateOf(false) }
    val playbackActivity = context as? MainActivity
    SideEffect {
        playbackActivity?.playbackRemoteKeyListener = { keyCode ->
            if (isTvControllerWakeKey(keyCode) && state.phase != TvPlaybackPhase.ERROR &&
                !showChannelPicker && !showSubtitlePicker && !showSubtitleOptions &&
                !showEpisodePicker && streamInfo == null && diagnostics == null
            ) {
                markPlaybackOverlayActivity()
            }
        }
    }
    DisposableEffect(playbackActivity) {
        onDispose { playbackActivity?.playbackRemoteKeyListener = null }
    }
    DisposableEffect(playerView, playbackActivity, request.isAudio, state.phase) {
        val surface = playerView
        val activity = playbackActivity
        if (surface == null || activity == null) {
            activity?.updateTvPictureInPicture(null, autoEnterEnabled = false)
            onDispose { }
        } else {
            val autoEnterEnabled = !request.isAudio && state.phase in setOf(
                TvPlaybackPhase.PLAYING,
                TvPlaybackPhase.BUFFERING,
            )
            val layoutListener = View.OnLayoutChangeListener { view, _, _, _, _, _, _, _, _ ->
                activity.updateTvPictureInPicture(view, autoEnterEnabled)
            }
            surface.addOnLayoutChangeListener(layoutListener)
            surface.post { activity.updateTvPictureInPicture(surface, autoEnterEnabled) }
            onDispose {
                surface.removeOnLayoutChangeListener(layoutListener)
                activity.updateTvPictureInPicture(null, autoEnterEnabled = false)
            }
        }
    }
    var activePlaybackSpeed by remember(request.uri) { androidx.compose.runtime.mutableStateOf(playbackSpeed) }
    var videoResizeMode by remember(context) {
        androidx.compose.runtime.mutableStateOf(TvVideoResizeMode.load(context))
    }
    val hasDocumentPicker = remember(context) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
            .setType("*/*")
            .addCategory(Intent.CATEGORY_OPENABLE)
        context.packageManager.queryIntentActivities(
            intent,
            android.content.pm.PackageManager.MATCH_DEFAULT_ONLY,
        ).any { info ->
            // Some TV images return the generic ResolverActivity even though
            // no document provider can actually service the request.
            info.activityInfo.packageName.contains("documentsui", ignoreCase = true) &&
                !info.activityInfo.name.contains("ResolverActivity") &&
                !info.activityInfo.name.contains("ChooserActivity")
        }
    }
    val subtitlePickerLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        runCatching {
            context.contentResolver.takePersistableUriPermission(
                uri,
                android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION,
            )
        }
        val mimeType = context.contentResolver.getType(uri)
        subtitleNotice = if (controller.addExternalSubtitle(uri, mimeType)) {
            "Subtítulos cargados"
        } else {
            "No se pudieron cargar los subtítulos"
        }
    }

    LaunchedEffect(controller, captionsEnabled) {
        controller.setCaptionsEnabled(captionsEnabled)
    }

    BackHandler {
        if (activeRecording?.status == TvRecordingStatus.RECORDING) {
            recordingScope.launch {
                recordingManager.stop()
                onExit()
            }
        } else {
            onExit()
        }
    }
    // The player belongs to the screen, not to an individual media item.
    // Releasing it when `request` changes makes channel/content switching
    // reuse a dead ExoPlayer instance on the next composition.
    DisposableEffect(controller) {
        onDispose {
            if (!latestRequest.isLive) {
                latestPositionChanged(controller.currentPositionMs(), controller.durationMs())
            }
            controller.close()
        }
    }

    LaunchedEffect(controller, request, autoReconnectLiveEnabled) {
        if (activeRecording?.sourceUri != null && activeRecording?.sourceUri != request.uri) {
            recordingManager.stop()
        }
        controller.play(
            request,
            autoPlay = autoPlayEnabled,
            playbackSpeed = playbackSpeed,
            autoReconnectLive = autoReconnectLiveEnabled,
        )
        if (!request.isLive) {
            while (true) {
                delay(5_000)
                latestPositionChanged(controller.currentPositionMs(), controller.durationMs())
            }
        }
    }

    LaunchedEffect(channelNumberInput) {
        if (channelNumberInput.isBlank()) return@LaunchedEffect
        delay(TV_CHANNEL_NUMBER_INPUT_TIMEOUT_MS)
        val number = channelNumberInput.toIntOrNull()?.takeIf { it > 0 }
        channelNumberInput = ""
        number?.let { latestChannelNumberCallback?.invoke(it) }
    }

    LaunchedEffect(controlsActivitySequence, playbackControlsVisible, state.phase,
        showChannelPicker, showSubtitlePicker, showSubtitleOptions, showEpisodePicker,
        streamInfo, diagnostics,
    ) {
        if (!playbackControlsVisible || state.phase == TvPlaybackPhase.ERROR ||
            showChannelPicker || showSubtitlePicker || showSubtitleOptions ||
            showEpisodePicker || streamInfo != null || diagnostics != null
        ) return@LaunchedEffect
        // Media3 does not always start its timeout while a Compose action owns
        // TV focus. Keep both layers on one inactivity clock in that case.
        val activityAtStart = controlsActivitySequence
        delay(4_000)
        if (controlsActivitySequence != activityAtStart || !playbackControlsVisible) return@LaunchedEffect
        playbackControlsVisible = false
        playbackOverlayActionFocused = false
        playerView?.hideController()
    }

    LaunchedEffect(
        playbackControlsVisible,
        state.phase,
        showChannelPicker,
        showSubtitlePicker,
        showSubtitleOptions,
        showEpisodePicker,
        streamInfo,
        diagnostics,
    ) {
        val playbackModalOpen = showChannelPicker || showSubtitlePicker ||
            showSubtitleOptions || showEpisodePicker || streamInfo != null || diagnostics != null
        if (playbackModalOpen || state.phase == TvPlaybackPhase.ERROR) return@LaunchedEffect
        if (!playbackControlsVisible) {
            // Keep a neutral TV focus target after hiding both control layers;
            // otherwise the next DPAD press can be lost with the disposed row.
            runCatching { playbackSurfaceFocusRequester.requestFocus() }
            return@LaunchedEffect
        }
        // Give the Compose action row focus at playback start and whenever
        // the common overlay wakes, so D-pad input can reach it.
        delay(250)
        if (!playbackControlsVisible || playbackModalOpen) return@LaunchedEffect
        when {
            request.isAudio -> audioFocusRequester.requestFocus()
            request.isLive && !request.isAudio && onChannelOptionSelected != null -> channelFocusRequester.requestFocus()
            else -> subtitleFocusRequester.requestFocus()
        }
    }

    LaunchedEffect(showChannelPicker) {
        if (showChannelPicker) {
            // AlertDialog creates a separate window. Wait for it to become
            // focusable, then establish initial focus only once. When the
            // catalogue is still loading, focus the tabs rather than search
            // (which would raise the TV keyboard); later pages must not steal
            // focus from whichever control the user is navigating.
            delay(250)
            if (showChannelPicker) {
                runCatching {
                    if (latestFilteredChannelOptions.isNotEmpty()) {
                        firstChannelItemFocusRequester.requestFocus()
                    } else {
                        softwareKeyboardController?.hide()
                        channelTabFocusRequesters.first().requestFocus()
                    }
                }
            }
        } else {
            focusedChannelKey = null
        }
    }

    LaunchedEffect(guide) {
        while (guide != null) {
            guideNowMs = System.currentTimeMillis() - (guide?.providerClockOffsetMs ?: 0L)
            delay(30_000)
        }
    }

    LaunchedEffect(state.phase) {
        if (state.phase == TvPlaybackPhase.ERROR) {
            retryFocusRequester.requestFocus()
            onPlaybackError(controller.currentPositionMs())
        } else if (
            state.phase == TvPlaybackPhase.ENDED &&
            shouldAutoAdvanceEpisode(
                autoPlayEnabled = latestAutoPlayEnabled,
                isLive = latestRequest.isLive,
                isAudio = latestRequest.isAudio,
                hasNextEpisode = latestCanNextEpisode && latestPlaybackEnded != null,
            )
        ) {
            latestPlaybackEnded?.invoke()
        }
    }

    fun handlePlaybackShortcut(keyCode: Int): Boolean = when (keyCode) {
        android.view.KeyEvent.KEYCODE_DPAD_LEFT -> {
            if (request.isLive) false else controller.seekBy(-5_000L).let { true }
        }
        android.view.KeyEvent.KEYCODE_DPAD_RIGHT -> {
            if (request.isLive) false else controller.seekBy(5_000L).let { true }
        }
        android.view.KeyEvent.KEYCODE_DPAD_CENTER,
        android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
            controller.togglePlayPause()
            true
        }
        android.view.KeyEvent.KEYCODE_DPAD_UP -> {
            controller.adjustVolume(0.05f)
            true
        }
        android.view.KeyEvent.KEYCODE_DPAD_DOWN -> {
            controller.adjustVolume(-0.05f)
            true
        }
        android.view.KeyEvent.KEYCODE_MUTE -> {
            controller.toggleMute()
            true
        }
        else -> false
    }

    Box(
        modifier = Modifier
        .fillMaxSize()
        .background(Color.Black)
        .focusRequester(playbackSurfaceFocusRequester)
        .focusable()
        .onPreviewKeyEvent { event ->
            val native = event.nativeKeyEvent
            val playbackModalOpen = showChannelPicker || showSubtitlePicker ||
                showSubtitleOptions || showEpisodePicker || streamInfo != null || diagnostics != null
            val wakeController = native.action == android.view.KeyEvent.ACTION_DOWN &&
                !playbackModalOpen && state.phase != TvPlaybackPhase.ERROR &&
                isTvControllerWakeKey(native.keyCode)
            if (wakeController) {
                // Wake Media3 from the stable screen focus target as well as
                // PlayerView so transport and Compose controls stay together.
                markPlaybackOverlayActivity()
            }
            val delta = when (native.keyCode) {
                android.view.KeyEvent.KEYCODE_CHANNEL_UP,
                android.view.KeyEvent.KEYCODE_PAGE_UP -> -1
                android.view.KeyEvent.KEYCODE_CHANNEL_DOWN,
                android.view.KeyEvent.KEYCODE_PAGE_DOWN -> 1
                else -> null
            }
            when {
                native.action == android.view.KeyEvent.ACTION_DOWN &&
                    request.isLive && !playbackModalOpen &&
                    delta != null && onChannelChange != null -> {
                    onChannelChange(delta)
                    true
                }
                native.action == android.view.KeyEvent.ACTION_DOWN &&
                    request.isLive && !playbackModalOpen && isTvChannelDigitKey(native.keyCode) -> {
                    // Capture digits at the Compose player surface as well as
                    // the focused overlay graph; PlayerView is not always the
                    // remote's focused child on Android TV.
                    if (native.repeatCount == 0) {
                        tvChannelDigit(native.keyCode)?.let { digit ->
                            channelNumberInput = appendTvChannelNumberDigit(channelNumberInput, digit)
                        }
                    }
                    true
                }
                wakeController && !playbackControlsVisible -> {
                    // The first key after auto-hide restores the common overlay
                    // and still honours transport/volume shortcuts.
                    if (isTvPlaybackShortcutKey(native.keyCode)) {
                        handlePlaybackShortcut(native.keyCode)
                    }
                    true
                }
                else -> false
            }
        },
    ) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
                factory = { viewContext ->
                    TvPlayerView(
                        viewContext,
                        onChannelChange,
                        ::handlePlaybackShortcut,
                        { playbackOverlayActionFocused },
                        ::markPlaybackOverlayActivity,
                        { visible -> playbackControlsVisible = visible },
                    ).apply {
                        playerView = this
                        // Match IPTVnator's playback wake-lock behavior for long
                        // live/VOD sessions; this flag is scoped to the player view.
                        keepScreenOn = true
                        useController = true
                        // Compose's shared idle timer hides both the native
                        // transport controls and the Compose action row in one
                        // state transition. Disable Media3's independent
                        // timeout so the two layers can never disappear apart.
                        controllerShowTimeoutMs = 0
                        controllerAutoShow = true
                        setShowSubtitleButton(!request.isAudio)
                        applyTvSubtitleStyle(subtitleStyle)
                        setResizeMode(videoResizeMode.media3Mode)
                        // Explicit idle hide + remote wake must not race the
                        // native controller's alpha animation on Google TV.
                        setControllerAnimationEnabled(false)
                        layoutParams = ViewGroup.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT,
                        )
                        player = controller.player()
                    }
                },
                update = {
                    it.onChannelChange = onChannelChange
                    it.onPlaybackShortcut = ::handlePlaybackShortcut
                    it.isOverlayActionFocused = { playbackOverlayActionFocused }
                    it.onRemoteActivity = ::markPlaybackOverlayActivity
                    it.onControllerVisibilityChanged = { visible ->
                        playbackControlsVisible = visible
                    }
                    it.setShowSubtitleButton(!request.isAudio)
                    it.applyTvSubtitleStyle(subtitleStyle)
                    it.setResizeMode(videoResizeMode.media3Mode)
                    it.player = controller.player()
                },
        )
        if (playbackControlsVisible) {
            // Cinematic scrims: keep the top actions and the bottom info
            // banner legible over bright video without a boxed panel.
            Box(
                Modifier
                    .align(Alignment.TopCenter)
                    .fillMaxWidth()
                    .height(150.dp)
                    .background(Brush.verticalGradient(listOf(Color(0xCC000000), Color.Transparent))),
            )
            Box(
                Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 96.dp)
                    .fillMaxWidth()
                    .height(210.dp)
                    .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xE6000000)))),
            )
        }
        if (request.isAudio) {
            Column(
                modifier = Modifier
                    .align(Alignment.Center)
                    .background(
                        Brush.verticalGradient(listOf(Color(0xE61E2129), Color(0xE609090C))),
                        RoundedCornerShape(24.dp),
                    )
                    .padding(horizontal = 72.dp, vertical = 42.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("♫", color = tvTone(TvTone.Accent), fontSize = 64.sp)
                TvEyebrow("Radio")
                Text(request.title, color = Color(0xFFF4EFE6), fontFamily = TvType.Display, fontSize = 24.sp)
            }
        }
        // Compose the action row from the same visibility state as Media3's
        // pause/timeline controller. Conditional composition removes every
        // button in that frame, with no separate exit animation to lag behind.
        if (playbackControlsVisible) androidx.compose.runtime.CompositionLocalProvider(LocalTvFocusRadius provides 999.dp) {
            Row(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(top = 24.dp, end = 28.dp, start = 28.dp)
                    .onPreviewKeyEvent { event ->
                        if (event.nativeKeyEvent.action == android.view.KeyEvent.ACTION_DOWN &&
                            isTvOverlayNavigationKey(event.nativeKeyEvent.keyCode)
                        ) {
                            // DPAD navigation within these Compose actions is
                            // real remote activity too. Restart the same idle
                            // clock used by Media3 so the whole overlay remains
                            // visible while the user is choosing a button.
                            markPlaybackOverlayActivity()
                        }
                        false
                    },
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
            if (onPreviousEpisode != null || onNextEpisode != null) {
                TvButton(
                    onClick = { performPlaybackAction { onPreviousEpisode?.invoke() } },
                    enabled = onPreviousEpisode != null && canPreviousEpisode,
                    colors = playbackActionColors,
                    modifier = Modifier
                        .focusRequester(previousEpisodeFocusRequester)
                        .focusProperties { right = nextEpisodeFocusRequester }
                        .onFocusChanged { playbackOverlayActionFocused = it.hasFocus }
                        .tvDpadFocus(),
                ) { Text("Anterior") }
                TvButton(
                    onClick = { performPlaybackAction { onNextEpisode?.invoke() } },
                    enabled = onNextEpisode != null && canNextEpisode,
                    colors = playbackActionColors,
                    modifier = Modifier
                        .focusRequester(nextEpisodeFocusRequester)
                        .focusProperties {
                            left = previousEpisodeFocusRequester
                            right = if (episodeOptions.isNotEmpty() && onEpisodeOptionSelected != null) episodeFocusRequester else subtitleFocusRequester
                        }
                        .onFocusChanged { playbackOverlayActionFocused = it.hasFocus }
                        .tvDpadFocus(),
                ) { Text("Siguiente") }
            }
            if (episodeOptions.isNotEmpty() && onEpisodeOptionSelected != null) {
                TvButton(
                    onClick = { performPlaybackAction { showEpisodePicker = true } },
                    colors = playbackActionColors,
                    modifier = Modifier
                        .focusRequester(episodeFocusRequester)
                        .focusProperties {
                            left = when {
                                onPreviousEpisode != null || onNextEpisode != null -> nextEpisodeFocusRequester
                                else -> infoFocusRequester
                            }
                            right = subtitleFocusRequester
                        }
                        .onFocusChanged { playbackOverlayActionFocused = it.hasFocus }
                        .tvDpadFocus(),
                ) { Text("Episodios") }
            }
        if (request.isLive && !request.isAudio && onChannelOptionSelected != null) {
                TvButton(
                    onClick = { performPlaybackAction { openChannelPicker() } },
                    colors = playbackActionColors,
                    modifier = Modifier
                        .focusRequester(channelFocusRequester)
                        .focusProperties { right = if (!request.isAudio) subtitleFocusRequester else audioFocusRequester }
                        .onFocusChanged { playbackOverlayActionFocused = it.hasFocus }
                        .tvDpadFocus(),
                ) { Text("Canales") }
            }
            if (!request.isAudio) {
                TvButton(
                    onClick = { performPlaybackAction { showSubtitleOptions = true } },
                    colors = playbackActionColors,
                    modifier = Modifier
                        .focusRequester(subtitleFocusRequester)
                        .focusProperties {
                            left = when {
                                request.isLive && !request.isAudio && onChannelOptionSelected != null -> channelFocusRequester
                                episodeOptions.isNotEmpty() && onEpisodeOptionSelected != null -> episodeFocusRequester
                                onPreviousEpisode != null || onNextEpisode != null -> nextEpisodeFocusRequester
                                else -> subtitleFocusRequester
                            }
                            right = audioFocusRequester
                        }
                        .onFocusChanged { playbackOverlayActionFocused = it.hasFocus }
                        .tvDpadFocus(),
                ) { Text("Subtítulos") }
            }
            TvButton(
                onClick = {
                    performPlaybackAction {
                        TrackSelectionDialogBuilder(
                            context,
                            "Pista de audio",
                            controller.player(),
                            C.TRACK_TYPE_AUDIO,
                        ).setShowDisableOption(true).build().show()
                    }
                },
                colors = playbackActionColors,
                modifier = Modifier
                    .focusRequester(audioFocusRequester)
                    .focusProperties {
                        if (!request.isAudio) {
                            left = subtitleFocusRequester
                        }
                        right = if (request.isAudio) infoFocusRequester else qualityFocusRequester
                    }
                    .onFocusChanged { playbackOverlayActionFocused = it.hasFocus }
                    .tvDpadFocus(),
                ) { Text("Audio") }
            if (!request.isAudio) {
                TvButton(
                    onClick = {
                        performPlaybackAction {
                            TrackSelectionDialogBuilder(
                                context,
                                "Calidad de vídeo",
                                controller.player(),
                                C.TRACK_TYPE_VIDEO,
                            ).setShowDisableOption(true).build().show()
                        }
                    },
                    colors = playbackActionColors,
                    modifier = Modifier
                        .focusRequester(qualityFocusRequester)
                        .focusProperties {
                            left = audioFocusRequester
                            right = if (!request.isAudio) aspectFocusRequester else infoFocusRequester
                        }
                        .onFocusChanged { playbackOverlayActionFocused = it.hasFocus }
                        .tvDpadFocus(),
                ) { Text("Calidad") }
            }
            if (!request.isAudio) {
                TvButton(
                    onClick = {
                        performPlaybackAction {
                            videoResizeMode = videoResizeMode.next()
                            TvVideoResizeMode.save(context, videoResizeMode)
                        }
                    },
                    colors = playbackActionColors,
                    modifier = Modifier
                        .focusRequester(aspectFocusRequester)
                        .focusProperties {
                            left = qualityFocusRequester
                            right = if (onEnterPictureInPicture != null) pictureInPictureFocusRequester else infoFocusRequester
                        }
                        .onFocusChanged { playbackOverlayActionFocused = it.hasFocus }
                        .tvDpadFocus(),
                ) { Text("Formato: ${videoResizeMode.label}") }
            }
            if (!request.isAudio && onEnterPictureInPicture != null) {
                TvButton(
                    onClick = { performPlaybackAction { onEnterPictureInPicture() } },
                    colors = playbackActionColors,
                    modifier = Modifier
                        .focusRequester(pictureInPictureFocusRequester)
                        .focusProperties {
                            left = aspectFocusRequester
                            right = infoFocusRequester
                        }
                        .onFocusChanged { playbackOverlayActionFocused = it.hasFocus }
                        .tvDpadFocus(),
                ) { Text("PIP") }
            }
            TvButton(
                onClick = { performPlaybackAction { streamInfo = controller.streamInfo() } },
                colors = playbackActionColors,
                modifier = Modifier
                    .focusRequester(infoFocusRequester)
                    .focusProperties {
                        left = when {
                            request.isAudio -> audioFocusRequester
                            else -> if (onEnterPictureInPicture != null) pictureInPictureFocusRequester else aspectFocusRequester
                        }
                        right = when {
                            request.isLive && !request.isAudio -> recordingFocusRequester
                            !request.isLive && !request.isAudio -> speedFocusRequester
                            else -> infoFocusRequester
                        }
                    }
                    .onFocusChanged { playbackOverlayActionFocused = it.hasFocus }
                    .tvDpadFocus(),
            ) { Text("Info") }
            if (request.isLive && !request.isAudio) {
                TvButton(
                    onClick = {
                        performPlaybackAction {
                            if (activeRecording?.status == TvRecordingStatus.RECORDING) {
                                recordingScope.launch {
                                    val finished = recordingManager.stop()
                                    recordingNotice = finished?.let { "Grabación guardada: ${it.file.name}" }
                                }
                            } else {
                                recordingNotice = when {
                                    !recordingManager.supportsRecording(request) -> "Esta fuente no se puede grabar."
                                    recordingManager.start(request) -> "Grabación iniciada"
                                    else -> "No se pudo iniciar la grabación"
                                }
                            }
                        }
                    },
                    colors = playbackActionColors,
                    modifier = Modifier
                        .focusRequester(recordingFocusRequester)
                        .focusProperties { left = infoFocusRequester }
                        .onFocusChanged { playbackOverlayActionFocused = it.hasFocus }
                        .tvDpadFocus(),
                ) { Text(if (activeRecording?.status == TvRecordingStatus.RECORDING) "⏹ Grabar" else "● Grabar") }
            }
            if (!request.isLive && !request.isAudio) {
                TvButton(
                    onClick = {
                        performPlaybackAction {
                            val next = nextTvPlaybackSpeed(activePlaybackSpeed)
                            activePlaybackSpeed = next
                            controller.setPlaybackSpeed(next)
                            onPlaybackSpeedChange?.invoke(next)
                        }
                    },
                    colors = playbackActionColors,
                    modifier = Modifier
                        .focusRequester(speedFocusRequester)
                        .focusProperties { left = infoFocusRequester }
                        .onFocusChanged { playbackOverlayActionFocused = it.hasFocus }
                        .tvDpadFocus(),
                ) { Text("${playbackSpeedLabel(activePlaybackSpeed)}×") }
            }
            }
        }
        if (playbackControlsVisible) {
            val activeGuide = guide?.takeIf { it.current != null || it.next != null }
            Column(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    // Sit above Media3's timeline/time row, which owns the
                    // bottom ~90dp while the controller is visible.
                    .padding(start = 32.dp, end = 32.dp, bottom = 96.dp)
                    .widthIn(max = 620.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    when {
                        request.isAudio -> TvEyebrow("Radio")
                        request.isLive -> TvLiveBadge()
                        onPreviousEpisode != null || onNextEpisode != null || episodeOptions.isNotEmpty() -> TvEyebrow("Episodio")
                        else -> TvEyebrow("Película")
                    }
                    activeGuide?.sourceName?.takeIf(String::isNotBlank)?.let { source ->
                        Text(
                            source.uppercase(),
                            color = Color(0xFFBDB6AA),
                            fontFamily = TvType.BodyMedium,
                            fontSize = 8.sp,
                            letterSpacing = 1.4.sp,
                            maxLines = 1,
                        )
                    }
                }
                Text(
                    text = request.title,
                    color = Color(0xFFF4EFE6),
                    fontFamily = TvType.Display,
                    fontSize = 28.sp,
                    lineHeight = 30.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                activeGuide?.let { activeGuide ->
                    if (!activeGuide.channelName.equals(request.title, ignoreCase = true)) {
                        Text(activeGuide.channelName, color = tvTone(TvTone.Accent), fontSize = 11.sp, maxLines = 1)
                    }
                    val current = activeGuide.current
                    val progress = current?.let {
                        ((guideNowMs - it.startMs).toFloat() / (it.endMs - it.startMs).toFloat()).coerceIn(0f, 1f)
                    }
                    current?.let {
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                            Text("AHORA", color = tvTone(TvTone.Accent), fontFamily = TvType.BodyMedium, fontSize = 9.sp, letterSpacing = 1.4.sp)
                            Text(it.title, modifier = Modifier.padding(start = 10.dp), color = Color(0xFFF4EFE6), fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        progress?.let { value ->
                            Box(
                                modifier = Modifier
                                    .width(320.dp)
                                    .height(3.dp)
                                    .background(Color(0x33F4EFE6), RoundedCornerShape(2.dp)),
                            ) {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth(value)
                                        .height(3.dp)
                                        .background(tvTone(TvTone.Accent), RoundedCornerShape(2.dp)),
                                )
                            }
                        }
                    }
                    activeGuide.next?.let {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("DESPUÉS", color = Color(0xFF9A948A), fontFamily = TvType.BodyMedium, fontSize = 9.sp, letterSpacing = 1.4.sp)
                            Text(it.title, modifier = Modifier.padding(start = 10.dp), color = Color(0xFFBDB6AA), fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
        }
        if (channelNumberInput.isNotEmpty()) {
            Text(
                text = channelNumberInput,
                color = tvTone(TvTone.Accent),
                fontFamily = TvType.Display,
                fontSize = 48.sp,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    // Media3's live-player actions occupy the top edge. Keep
                    // numeric zapping feedback below that row so the digit
                    // remains fully readable while entering a channel.
                    .padding(top = 132.dp, end = 32.dp)
                    .background(Color(0xE609090C), RoundedCornerShape(16.dp))
                    .padding(horizontal = 24.dp, vertical = 8.dp),
            )
        }
        if (state.phase == TvPlaybackPhase.LOADING || state.phase == TvPlaybackPhase.BUFFERING) {
            Text(
                text = state.message ?: if (state.phase == TvPlaybackPhase.LOADING) "Conectando…" else "Buffering…",
                color = Color.White,
                // Media3 places its transport controls in the visual centre
                // when they are shown. Keep our diagnostic state above that
                // surface so buffering never renders underneath the pause/
                // seek controls on a TV screen.
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 132.dp)
                    .background(Color(0xE609090C), RoundedCornerShape(50))
                    .padding(horizontal = 20.dp, vertical = 9.dp),
            )
        }
        if (state.phase == TvPlaybackPhase.ERROR) {
            Column(
                modifier = Modifier.align(Alignment.Center).padding(32.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text(state.message ?: "No se pudo reproducir la fuente", color = Color.White)
                TvButton(
                    onClick = controller::retry,
                    modifier = Modifier
                        .focusRequester(retryFocusRequester)
                        .tvDpadFocus(),
                ) { Text("Reintentar") }
                TvButton(
                    onClick = { diagnostics = controller.diagnostics() },
                    modifier = Modifier.tvDpadFocus(),
                ) { Text("Ver diagnóstico") }
                TvButton(onClick = onExit, modifier = Modifier.tvDpadFocus()) { Text("Salir") }
            }
        }
        diagnosticsNotice?.let { notice ->
            Text(
                notice,
                color = Color.White,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 34.dp)
                    .background(Color(0xEB17191F), RoundedCornerShape(50))
                    .padding(horizontal = 24.dp, vertical = 12.dp),
            )
        }
        playbackNotice?.let { notice ->
            Text(
                text = notice,
                color = Color.White,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 34.dp)
                    .background(Color(0xEB17191F), RoundedCornerShape(50))
                    .padding(horizontal = 24.dp, vertical = 12.dp),
            )
        }
        subtitleNotice?.let { notice ->
            Text(
                text = notice,
                color = Color.White,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 82.dp)
                    .background(Color(0xEB17191F), RoundedCornerShape(50))
                    .padding(horizontal = 24.dp, vertical = 12.dp),
            )
        }
        recordingNotice?.let { notice ->
            Text(
                text = notice,
                color = Color.White,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 116.dp)
                    .background(Color(0xEB17191F), RoundedCornerShape(50))
                    .padding(horizontal = 24.dp, vertical = 12.dp),
            )
        }
        if (showSubtitlePicker) {
            TvSubtitlePickerDialog(
                onDismiss = { showSubtitlePicker = false },
                onSelect = { uri, mimeType ->
                    showSubtitlePicker = false
                    subtitleNotice = if (controller.addExternalSubtitle(uri, mimeType)) {
                        "Subtítulos cargados"
                    } else {
                        "No se pudieron cargar los subtítulos"
                    }
                },
            )
        }
        if (showChannelPicker && onChannelOptionSelected != null) {
            TvAlertDialog(
                onDismissRequest = { showChannelPicker = false },
                title = { Text("Canales") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        TvOutlinedTextField(
                            value = channelPickerSearch,
                            onValueChange = {
                                channelPickerSearch = it
                                onChannelPickerSearch?.invoke(it)
                            },
                            modifier = Modifier
                                .fillMaxWidth()
                                .focusRequester(channelSearchFocusRequester)
                                .focusProperties { down = channelTabFocusRequesters.first() },
                            singleLine = true,
                            placeholder = { Text("Buscar canal…") },
                        )
                        val views = listOf(
                            "all" to "Todos",
                            "groups" to "Grupos",
                            "favorites" to "Favoritos",
                            "recent" to "Recientes",
                        )
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            views.forEachIndexed { index, (id, label) ->
                                TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                                    onClick = {
                                        channelPickerView = id
                                        if (id == "all" || id == "groups") {
                                            onChannelPickerGroupingChanged?.invoke(id == "groups")
                                        }
                                    },
                                    modifier = Modifier
                                        .weight(1f)
                                        .height(42.dp)
                                        .focusRequester(channelTabFocusRequesters[index])
                                        .focusProperties {
                                            if (index > 0) left = channelTabFocusRequesters[index - 1]
                                            if (index < views.lastIndex) right = channelTabFocusRequesters[index + 1]
                                            if (index == 0) up = channelSearchFocusRequester
                                            if (filteredChannelOptions.isNotEmpty()) down = firstChannelItemFocusRequester
                                        }
                                        .tvDpadFocus(),
                                    colors = androidx.tv.material3.CardDefaults.colors(
                                        containerColor = if (channelPickerView == id) tvColor(Color(0xFF263A5A)) else tvColor(Color(0xFF202532)),
                                        focusedContainerColor = tvColor(Color(0xFF536A9F)),
                                    ),
                                ) {
                                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                        Text(label, color = tvColor(Color(0xFFE7E9F0)), fontSize = 12.sp, maxLines = 1)
                                    }
                                }
                            }
                        }
                        if (channelPickerLoading) {
                            Text("Cargando más canales…", color = tvColor(Color(0xFF9CC1FF)), fontSize = 12.sp)
                        }
                        if (filteredChannelOptions.isEmpty()) {
                            Text(
                                when {
                                    channelPickerSearch.isNotBlank() -> "No hay canales que coincidan"
                                    channelPickerView == "favorites" -> "No hay canales favoritos"
                                    channelPickerView == "recent" -> "No hay canales recientes"
                                    else -> "No hay canales en esta vista"
                                },
                                color = tvColor(Color(0xFF9BA3B7)),
                            )
                        } else {
                            // Keep the complete Xtream catalogue searchable, but do not
                            // compose thousands of rows (or their images) at dialog open.
                            LazyColumn(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .heightIn(max = 420.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                itemsIndexed(
                                    filteredChannelOptions,
                                    key = { _, option -> option.key },
                                ) { index, option ->
                                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                        if (channelPickerView == "groups" &&
                                            (index == 0 || filteredChannelOptions[index - 1].group != option.group)
                                        ) {
                                            Text(
                                                option.group?.ifBlank { "Sin grupo" } ?: "Sin grupo",
                                                color = tvColor(Color(0xFF9BA3B7)),
                                                fontSize = 12.sp,
                                            )
                                        }
                                        TvCard(
                                            onClick = {
                                                showChannelPicker = false
                                                onChannelOptionSelected(option)
                                            },
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .height(54.dp)
                                                .then(if (index == 0) Modifier.focusRequester(firstChannelItemFocusRequester) else Modifier)
                                                .focusProperties {
                                                    if (index == 0) up = channelTabFocusRequesters.first()
                                                }
                                                .onFocusChanged {
                                                    if (it.hasFocus) focusedChannelKey = option.key
                                                    else if (focusedChannelKey == option.key) focusedChannelKey = null
                                                    if (it.hasFocus && channelPickerSearch.isBlank() &&
                                                        channelPickerView in setOf("all", "groups") &&
                                                        channelPickerHasMore && index >= filteredChannelOptions.lastIndex - 12
                                                    ) {
                                                        onLoadMoreChannels?.invoke()
                                                    }
                                                }
                                                .then(
                                                    if (focusedChannelKey == option.key) {
                                                        Modifier.border(
                                                            2.dp,
                                                            tvColor(Color(0xFF9CC1FF)),
                                                            RoundedCornerShape(8.dp),
                                                        )
                                                    } else Modifier
                                                )
                                                .tvDpadFocus(),
                                            colors = androidx.tv.material3.CardDefaults.colors(
                                                containerColor = tvColor(Color(0xFF202532)),
                                                focusedContainerColor = tvColor(Color(0xFF536A9F)),
                                            ),
                                        ) {
                                            Row(
                                                modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp),
                                                verticalAlignment = Alignment.CenterVertically,
                                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                                            ) {
                                                Box(
                                                    modifier = Modifier.size(38.dp).background(tvColor(Color(0xFF29334B))),
                                                    contentAlignment = Alignment.Center,
                                                ) {
                                                    option.logoUrl?.takeIf(String::isNotBlank)?.let { logo ->
                                                        AsyncImage(
                                                            model = logo,
                                                            contentDescription = null,
                                                            modifier = Modifier.size(34.dp),
                                                        )
                                                    } ?: Text("TV", color = tvColor(Color(0xFF8FB8FF)), fontSize = 10.sp)
                                                }
                                                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                                    Text(option.title, color = tvColor(Color(0xFFE7E9F0)), maxLines = 1)
                                            option.currentProgram?.let { programme ->
                                                Text(programme, color = tvColor(Color(0xFF9BA3B7)), fontSize = 11.sp, maxLines = 1)
                                            }
                                            if (option.catchupAvailable) {
                                                Text("Catch-up", color = tvColor(Color(0xFFFFB4AB)), fontSize = 10.sp, maxLines = 1)
                                            }
                                        }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                confirmButton = {
                    TvTextButton(
                        onClick = { showChannelPicker = false },
                        modifier = Modifier.tvDpadFocus(),
                    ) { Text("Cancelar") }
                },
            )
        }
        if (showSubtitleOptions) {
            TvSubtitleOptionsDialog(
                onDismiss = { showSubtitleOptions = false },
                onEmbeddedTracks = {
                    showSubtitleOptions = false
                    controller.setCaptionsEnabled(true)
                    TrackSelectionDialogBuilder(
                        context,
                        "Pista de subtítulos",
                        controller.player(),
                        C.TRACK_TYPE_TEXT,
                    ).setShowDisableOption(true).build().show()
                },
                onExternalFile = {
                    showSubtitleOptions = false
                    if (hasDocumentPicker) {
                        subtitlePickerLauncher.launch(arrayOf("text/vtt", "application/x-subrip", "text/x-ssa", "text/plain", "*/*"))
                    } else {
                        showSubtitlePicker = true
                    }
                },
                onDisable = {
                    showSubtitleOptions = false
                    controller.setCaptionsEnabled(false)
                    subtitleNotice = "Subtítulos desactivados"
                },
                subtitleStyle = subtitleStyle,
                onCycleSubtitleSize = {
                    subtitleStyle = controller.cycleSubtitleSize()
                },
                onCycleSubtitleColor = {
                    subtitleStyle = controller.cycleSubtitleColor()
                },
                subtitleDelaySeconds = subtitleDelaySeconds,
                onDecreaseSubtitleDelay = {
                    subtitleDelaySeconds = controller.adjustSubtitleDelay(-0.5f)
                },
                onIncreaseSubtitleDelay = {
                    subtitleDelaySeconds = controller.adjustSubtitleDelay(0.5f)
                },
                onResetSubtitleDelay = {
                    subtitleDelaySeconds = controller.resetSubtitleDelay()
                },
                hasExternalSubtitle = controller.hasExternalSubtitle(),
            )
        }
        if (showEpisodePicker && onEpisodeOptionSelected != null) {
            TvPlaybackEpisodeDialog(
                episodes = episodeOptions,
                currentKey = currentEpisodeKey,
                onSelect = { episode ->
                    showEpisodePicker = false
                    onEpisodeOptionSelected(episode)
                },
                onDismiss = { showEpisodePicker = false },
            )
        }
        streamInfo?.let { info ->
            TvPlaybackInfoDialog(info = info, onDismiss = { streamInfo = null })
        }
        diagnostics?.let { report ->
            TvPlaybackDiagnosticsDialog(
                diagnostics = report,
                onDismiss = { diagnostics = null },
                onCopy = {
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clipboard.setPrimaryClip(ClipData.newPlainText("Diagnóstico IPTVnator", report.report))
                    diagnosticsNotice = "Informe copiado al portapapeles"
                },
            )
        }
    }
}
