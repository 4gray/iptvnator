package com.iptvnator.googletv

import android.app.DownloadManager
import android.content.Context
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentUris
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.os.Build
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Log
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.ui.zIndex
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.foundation.Canvas
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import android.view.WindowManager
import androidx.tv.material3.Surface
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.blur
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.layout.ContentScale
import coil.compose.AsyncImage
import android.view.KeyEvent
import com.iptvnator.googletv.playback.TvPlaybackRequest
import com.iptvnator.googletv.playback.resolveTvChannelPlaybackRequest
import com.iptvnator.googletv.playback.resolveTvEpgPlaybackRequest
import com.iptvnator.googletv.playback.TvPlaybackScreen
import com.iptvnator.googletv.playback.TvPlaybackGuide
import com.iptvnator.googletv.playback.TvPlaybackChannelOption
import com.iptvnator.googletv.playback.TvPlaybackEpisodeOption
import com.iptvnator.googletv.playlist.StoredPlaylist
import com.iptvnator.googletv.playlist.TvPlaylistCounts
import com.iptvnator.googletv.playlist.TvChannel
import com.iptvnator.googletv.playlist.TvPlaylistRepository
import com.iptvnator.googletv.playlist.TvXtreamImportProgress
import com.iptvnator.googletv.playlist.TvPlaylistSource
import com.iptvnator.googletv.playlist.TvPlaylistStore
import com.iptvnator.googletv.playlist.orderTvSources
import com.iptvnator.googletv.playlist.sourceSortModeAfterManualMove
import com.iptvnator.googletv.playlist.TvHiddenCategory
import com.iptvnator.googletv.playlist.TvEpgSourceState
import com.iptvnator.googletv.playlist.isLikelyTvM3uVod
import com.iptvnator.googletv.playlist.isLikelyTvM3uMovie
import com.iptvnator.googletv.playlist.supportsM3uCatchup
import com.iptvnator.googletv.playlist.TvCredentialVault
import com.iptvnator.googletv.playlist.TvPlaylistBackup
import com.iptvnator.googletv.playlist.TvBackupImportSummary
import com.iptvnator.googletv.playlist.TvVodItem
import com.iptvnator.googletv.playlist.TvSeriesItem
import com.iptvnator.googletv.playlist.TvCatalogCategoryMapping
import com.iptvnator.googletv.playlist.TvSavedItem
import com.iptvnator.googletv.playlist.TvSavedItemType
import com.iptvnator.googletv.playlist.TvCollectionScopeView
import com.iptvnator.googletv.playlist.loadTvCollectionScopeIsAll
import com.iptvnator.googletv.playlist.saveTvCollectionScopeIsAll
import com.iptvnator.googletv.playlist.tvFavoriteCategoryOptions
import com.iptvnator.googletv.playlist.filterTvFavoritesByCategory
import com.iptvnator.googletv.playlist.filterTvFavoritesByQuery
import com.iptvnator.googletv.playlist.TvEpisodeProgress
import com.iptvnator.googletv.epg.TvEpgEntry
import com.iptvnator.googletv.epg.TvEpgSearchChannel
import com.iptvnator.googletv.epg.TvEpgSearchHit
import com.iptvnator.googletv.epg.selectCurrentOrNextEpgEntry
import com.iptvnator.googletv.epg.selectEpgWindow
import com.iptvnator.googletv.epg.searchTvEpgPrograms
import com.iptvnator.googletv.epg.rankTvEpgSearchHits
import com.iptvnator.googletv.epg.TV_EPG_SEARCH_MIN_QUERY_LENGTH
import com.iptvnator.googletv.epg.TV_EPG_SEARCH_RESULT_LIMIT
import com.iptvnator.googletv.xtream.XtreamSeriesDetails
import com.iptvnator.googletv.xtream.XtreamSeriesEpisode
import com.iptvnator.googletv.xtream.tvSeriesEpisodeNeighbors
import com.iptvnator.googletv.xtream.XtreamVodDetails
import com.iptvnator.googletv.xtream.XtreamCredentials
import com.iptvnator.googletv.xtream.XtreamAccountInfo
import com.iptvnator.googletv.xtream.XtreamApiClient
import com.iptvnator.googletv.tmdb.TmdbSearchResult
import com.iptvnator.googletv.xtream.TvXtreamStreamFormat
import com.iptvnator.googletv.xtream.alternateXtreamLiveFormat
import com.iptvnator.googletv.xtream.xtreamLiveFallbackStillApplies
import com.iptvnator.googletv.xtream.friendlyXtreamError
import com.iptvnator.googletv.stalker.StalkerCredentials
import com.iptvnator.googletv.stalker.StalkerSession
import com.iptvnator.googletv.stalker.StalkerRequestBuilder
import com.iptvnator.googletv.stalker.stalkerShortEpgWindowSize
import com.iptvnator.googletv.stalker.deriveStalkerDeviceIdsFromMac
import com.iptvnator.googletv.tmdb.TmdbDetails
import com.iptvnator.googletv.tmdb.TmdbCache
import com.iptvnator.googletv.download.TvDownloadManager
import com.iptvnator.googletv.download.TvDownloadHistory
import com.iptvnator.googletv.download.TvDownloadRecord
import com.iptvnator.googletv.download.TvDownloadSnapshot
import com.iptvnator.googletv.recording.TvLiveRecordingManager
import com.iptvnator.googletv.recording.TvRecording
import com.iptvnator.googletv.recording.TvRecordingHistory
import com.iptvnator.googletv.recording.TvRecordingStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.text.SimpleDateFormat
import java.io.File
import java.io.FileInputStream
import java.util.Date
import java.util.Locale

// IPTVnator's dark web theme tokens, kept as the TV base palette. Individual
// controls may raise contrast for ten-foot readability, but the shell should
// retain the original surface/heading/muted relationship.
private val TvBackground: Color @Composable get() = tvColor(Color(0xFF161A22))
private val TvText: Color @Composable get() = tvColor(Color(0xFFD8DCE8))
private val TvMuted: Color @Composable get() = tvColor(Color(0xFF8891A4))

@Composable
private fun tvImportButtonColors() = tvPrimaryButtonColors()

private fun Int.toTvDigit(): Int? = when (this) {
    KeyEvent.KEYCODE_0 -> 0
    KeyEvent.KEYCODE_1 -> 1
    KeyEvent.KEYCODE_2 -> 2
    KeyEvent.KEYCODE_3 -> 3
    KeyEvent.KEYCODE_4 -> 4
    KeyEvent.KEYCODE_5 -> 5
    KeyEvent.KEYCODE_6 -> 6
    KeyEvent.KEYCODE_7 -> 7
    KeyEvent.KEYCODE_8 -> 8
    KeyEvent.KEYCODE_9 -> 9
    else -> null
}

private fun formatEpisodePositionForPlayback(positionMs: Long): String {
    val totalSeconds = positionMs.coerceAtLeast(0L) / 1_000L
    return "Continuar desde ${totalSeconds / 60}:${(totalSeconds % 60).toString().padStart(2, '0')}"
}

@Composable
fun TvApp(databaseName: String? = null) {
    val context = LocalContext.current
    val preferences = remember(context) {
        context.getSharedPreferences("iptvnator-tv-ui", Context.MODE_PRIVATE)
    }
    var themeMode by remember(preferences) {
        mutableStateOf(TvVisualTheme.fromPreference(preferences.getString("visual_theme", null)))
    }
    val isDark = when (themeMode) {
        TvVisualTheme.DARK -> true
        TvVisualTheme.LIGHT -> false
        TvVisualTheme.SYSTEM -> isSystemInDarkTheme()
    }
    androidx.compose.runtime.CompositionLocalProvider(LocalTvLightTheme provides !isDark) {
        val light = !isDark
        fun t(tone: TvTone) = tone.resolve(light)
        val colors = if (isDark) {
            androidx.compose.material3.darkColorScheme(
                background = t(TvTone.Canvas), onBackground = t(TvTone.Text),
                surface = t(TvTone.Surface), onSurface = t(TvTone.Text),
                surfaceVariant = t(TvTone.SurfaceHigh), onSurfaceVariant = t(TvTone.Muted),
                surfaceContainer = t(TvTone.Surface), surfaceContainerHigh = t(TvTone.SurfaceHigh),
                surfaceContainerHighest = t(TvTone.SurfaceTop), outline = t(TvTone.Faint),
                primary = t(TvTone.Accent), onPrimary = t(TvTone.AccentInk),
                primaryContainer = t(TvTone.Selected), onPrimaryContainer = t(TvTone.Text),
                secondary = t(TvTone.AccentSoft), onSecondary = t(TvTone.AccentInk),
                secondaryContainer = t(TvTone.Selected), onSecondaryContainer = t(TvTone.Text),
                error = t(TvTone.Live), onError = t(TvTone.AccentInk),
            )
        } else {
            androidx.compose.material3.lightColorScheme(
                background = t(TvTone.Canvas), onBackground = t(TvTone.Text),
                surface = t(TvTone.Surface), onSurface = t(TvTone.Text),
                surfaceVariant = t(TvTone.SurfaceHigh), onSurfaceVariant = t(TvTone.Muted),
                surfaceContainer = t(TvTone.Surface), surfaceContainerHigh = t(TvTone.SurfaceHigh),
                surfaceContainerHighest = t(TvTone.SurfaceTop), outline = t(TvTone.Faint),
                primary = t(TvTone.Accent), onPrimary = t(TvTone.AccentInk),
                primaryContainer = t(TvTone.Selected), onPrimaryContainer = t(TvTone.Text),
                secondary = t(TvTone.AccentSoft), onSecondary = t(TvTone.AccentInk),
                secondaryContainer = t(TvTone.Selected), onSecondaryContainer = t(TvTone.Text),
                error = t(TvTone.Live), onError = t(TvTone.AccentInk),
            )
        }
        val tvColors = if (isDark) {
            androidx.tv.material3.darkColorScheme(
                background = t(TvTone.Canvas), onBackground = t(TvTone.Text),
                surface = t(TvTone.Surface), onSurface = t(TvTone.Text),
                surfaceVariant = t(TvTone.SurfaceHigh), onSurfaceVariant = t(TvTone.Muted),
                primary = t(TvTone.Accent), onPrimary = t(TvTone.AccentInk),
                border = t(TvTone.Accent), borderVariant = t(TvTone.SurfaceTop),
            )
        } else {
            androidx.tv.material3.lightColorScheme(
                background = t(TvTone.Canvas), onBackground = t(TvTone.Text),
                surface = t(TvTone.Surface), onSurface = t(TvTone.Text),
                surfaceVariant = t(TvTone.SurfaceHigh), onSurfaceVariant = t(TvTone.Muted),
                primary = t(TvTone.Accent), onPrimary = t(TvTone.AccentInk),
                border = t(TvTone.Accent), borderVariant = t(TvTone.SurfaceTop),
            )
        }
        val baseTypography = androidx.compose.material3.Typography()
        val typography = androidx.compose.material3.Typography(
            displayLarge = baseTypography.displayLarge.copy(fontFamily = TvType.Display),
            displayMedium = baseTypography.displayMedium.copy(fontFamily = TvType.Display),
            displaySmall = baseTypography.displaySmall.copy(fontFamily = TvType.Display),
            headlineLarge = baseTypography.headlineLarge.copy(fontFamily = TvType.Display),
            headlineMedium = baseTypography.headlineMedium.copy(fontFamily = TvType.Display),
            headlineSmall = baseTypography.headlineSmall.copy(fontFamily = TvType.Display),
            titleLarge = baseTypography.titleLarge.copy(fontFamily = TvType.BodyMedium),
            titleMedium = baseTypography.titleMedium.copy(fontFamily = TvType.BodyMedium),
            titleSmall = baseTypography.titleSmall.copy(fontFamily = TvType.BodyMedium),
            bodyLarge = baseTypography.bodyLarge.copy(fontFamily = TvType.Body, letterSpacing = 0.1.sp),
            bodyMedium = baseTypography.bodyMedium.copy(fontFamily = TvType.Body, letterSpacing = 0.1.sp),
            bodySmall = baseTypography.bodySmall.copy(fontFamily = TvType.Body),
            labelLarge = baseTypography.labelLarge.copy(fontFamily = TvType.BodyMedium, letterSpacing = 0.3.sp),
            labelMedium = baseTypography.labelMedium.copy(fontFamily = TvType.BodyMedium),
            labelSmall = baseTypography.labelSmall.copy(fontFamily = TvType.BodyMedium),
        )
        androidx.tv.material3.MaterialTheme(colorScheme = tvColors) {
        androidx.compose.material3.MaterialTheme(colorScheme = colors, typography = typography) {
            TvAppContent(
                databaseName = databaseName,
                themeMode = themeMode,
                onThemeModeChange = { next ->
                    themeMode = next
                    preferences.edit().putString("visual_theme", next.preferenceValue).apply()
                },
            )
        }
        }
    }
}

internal data class TvXtreamEpgPreview(
    val entries: List<TvEpgEntry>,
    val fetchedAtMs: Long,
    val offsetMinutes: Int,
    val failed: Boolean = false,
)

private const val XTREAM_EPG_PREVIEW_TTL_MS = 5 * 60_000L
private const val XTREAM_EPG_PREVIEW_FAILURE_TTL_MS = 60_000L

internal fun isFreshXtreamEpgPreview(
    preview: TvXtreamEpgPreview?,
    offsetMinutes: Int,
    nowMs: Long = System.currentTimeMillis(),
): Boolean {
    if (preview == null || preview.offsetMinutes != offsetMinutes) return false
    val ttlMs = if (preview.failed) XTREAM_EPG_PREVIEW_FAILURE_TTL_MS else XTREAM_EPG_PREVIEW_TTL_MS
    return (nowMs - preview.fetchedAtMs) in 0 until ttlMs
}

@Composable
@OptIn(ExperimentalLayoutApi::class)
private fun TvAppContent(
    databaseName: String?,
    themeMode: TvVisualTheme,
    onThemeModeChange: (TvVisualTheme) -> Unit,
) {
    var selectedSection by remember { mutableStateOf(TvSection.Home) }
    var submittedSearchQuery by remember { mutableStateOf("") }
    val recentSearchQuery = remember { mutableStateOf("") }
    val favoritesSearchQuery = remember { mutableStateOf("") }
    var startupSection by remember { mutableStateOf(TvSection.Home) }
    var showDashboard by remember { mutableStateOf(true) }
    var captionsEnabled by remember { mutableStateOf(true) }
    var stripCountryPrefixes by remember { mutableStateOf(false) }
    var posterSize by remember { mutableStateOf("medium") }
    var showPosterTitles by remember { mutableStateOf(true) }
    var autoPlayEnabled by remember { mutableStateOf(true) }
    var autoReconnectLiveEnabled by remember { mutableStateOf(true) }
    var vodPlaybackSpeed by remember { mutableStateOf(1f) }
    var vodAutoFailoverEnabled by remember { mutableStateOf(false) }
    var xtreamStreamFormat by remember { mutableStateOf(TvXtreamStreamFormat.AUTO) }
    var showContinueWatching by remember { mutableStateOf(true) }
    var showRecentSources by remember { mutableStateOf(true) }
    var showLiveFavorites by remember { mutableStateOf(true) }
    var showRecentlyWatchedLive by remember { mutableStateOf(true) }
    var showFavoriteMoviesAndSeries by remember { mutableStateOf(true) }
    var showTmdbTrending by remember { mutableStateOf(true) }
    var showTmdbRecommendations by remember { mutableStateOf(true) }
    var showXtreamRecentlyAdded by remember { mutableStateOf(true) }
    var tmdbTrendingItems by remember { mutableStateOf<List<TmdbSearchResult>>(emptyList()) }
    var tmdbRecommendationItems by remember { mutableStateOf<List<TmdbSearchResult>>(emptyList()) }
    var m3uVodDetailsEnabled by remember { mutableStateOf(true) }
    var tmdbCacheEntries by remember { mutableStateOf(0) }
    var tmdbCacheMessage by remember { mutableStateOf<String?>(null) }
    var epgViewMode by remember { mutableStateOf("timeline") }
    var epgOffsetMinutes by remember { mutableStateOf(0) }
    var preferUploadedEpgOverXtream by remember { mutableStateOf(false) }
    val mainContentFocusRequester = remember { FocusRequester() }
    val sourcesContentFocusRequester = remember { FocusRequester() }
    val settingsContentFocusRequester = remember { FocusRequester() }
    val downloadsContentFocusRequester = remember { FocusRequester() }
    val liveContentFocusRequester = remember { FocusRequester() }
    val catalogContentFocusRequester = remember { FocusRequester() }
    val guideContentFocusRequester = remember { FocusRequester() }
    val favoritesContentFocusRequester = remember { FocusRequester() }
    val recentContentFocusRequester = remember { FocusRequester() }
    val sectionFilterFocusRequester = remember { FocusRequester() }
    val recentlyAddedContentFocusRequester = remember { FocusRequester() }
    val sidebarFocusRequester = remember { FocusRequester() }
    // Always attached to the rail item of the section on screen.
    val sidebarActiveFocusRequester = remember { FocusRequester() }
    var showPlaylistMenu by remember { mutableStateOf(false) }
    var showImport by remember { mutableStateOf(false) }
    var importSourceType by remember { mutableStateOf(TvSourceType.M3U) }
    var playbackRequest by remember { mutableStateOf<TvPlaybackRequest?>(null) }
    var playbackNotice by remember { mutableStateOf<String?>(null) }
    var activePlaybackItem by remember { mutableStateOf<TvSavedItem?>(null) }
    var playbackChannelQueue by remember { mutableStateOf<List<Pair<String, TvChannel>>>(emptyList()) }
    var playbackZapQueue by remember { mutableStateOf<List<TvChannelZapEntry>>(emptyList()) }
    var playbackZapScope by remember { mutableStateOf(TvChannelZapScope()) }
    var playbackChannelSearchQueue by remember { mutableStateOf<List<Pair<String, TvChannel>>>(emptyList()) }
    var playbackPinnedChannelQueue by remember { mutableStateOf<List<Pair<String, TvChannel>>>(emptyList()) }
    var playbackChannelQueueLoading by remember { mutableStateOf(false) }
    var playbackChannelQueueHasMore by remember { mutableStateOf(false) }
    var playbackChannelQueueOffset by remember { mutableStateOf(0) }
    var playbackChannelQueueRadioOnly by remember { mutableStateOf(false) }
    var playbackChannelQueuePlaylistId by remember { mutableStateOf<String?>(null) }
    var playbackChannelQueueTotalCount by remember { mutableStateOf<Int?>(null) }
    var playbackChannelPickerSearch by remember { mutableStateOf("") }
    var playbackChannelPickerGrouped by remember { mutableStateOf(false) }
    var playbackChannelSearchOffset by remember { mutableStateOf(0) }
    var playbackChannelSearchHasMore by remember { mutableStateOf(false) }
    var playbackChannelSearchJob by remember { mutableStateOf<Job?>(null) }
    var attemptedVodFailoverKeys by remember { mutableStateOf<Set<String>>(emptySet()) }
    var attemptedLiveFallbackKeys by remember { mutableStateOf<Set<String>>(emptySet()) }
    var pendingLiveFallbackKey by remember { mutableStateOf<String?>(null) }
    var pendingLiveFallbackJob by remember { mutableStateOf<Job?>(null) }
    var seriesDetails by remember { mutableStateOf<Pair<String, XtreamSeriesDetails>?>(null) }
    var seriesTmdb by remember { mutableStateOf<TmdbDetails?>(null) }
    var episodeProgress by remember { mutableStateOf<Map<Int, TvEpisodeProgress>>(emptyMap()) }
    var activeEpisodeTarget by remember { mutableStateOf<Triple<String, Int, Int>?>(null) }
    var vodDetails by remember { mutableStateOf<Pair<String, TvVodItem>?>(null) }
    var vodTmdb by remember { mutableStateOf<TmdbDetails?>(null) }
    var vodProviderDetails by remember { mutableStateOf<XtreamVodDetails?>(null) }
    var m3uVodDetails by remember { mutableStateOf<Pair<String, TvChannel>?>(null) }
    var m3uVodTmdb by remember { mutableStateOf<TmdbDetails?>(null) }
    var m3uVodDownloadMessage by remember { mutableStateOf<String?>(null) }
    var m3uVodDownloadId by remember { mutableStateOf<Long?>(null) }
    var customSourceOrder by remember { mutableStateOf<List<String>>(emptyList()) }
    var playlists by remember { mutableStateOf<List<StoredPlaylist>>(emptyList()) }
    var dashboardRecentlyAddedVod by remember { mutableStateOf<Map<String, List<TvVodItem>>>(emptyMap()) }
    var dashboardRecentlyAddedSeries by remember { mutableStateOf<Map<String, List<TvSeriesItem>>>(emptyMap()) }
    var dashboardFavoriteVod by remember { mutableStateOf<Map<String, List<TvVodItem>>>(emptyMap()) }
    var dashboardFavoriteSeries by remember { mutableStateOf<Map<String, List<TvSeriesItem>>>(emptyMap()) }
    var initialSourcesLoading by remember { mutableStateOf(true) }
    val context = LocalContext.current
    val uiPreferences = remember(context) {
        context.getSharedPreferences("iptvnator-tv-ui", Context.MODE_PRIVATE)
    }
    LaunchedEffect(uiPreferences) {
        startupSection = uiPreferences.getString("startup_section", TvSection.Home.name)
            ?.let { value -> runCatching { TvSection.valueOf(value) }.getOrNull() }
            ?: TvSection.Home
        showDashboard = uiPreferences.getBoolean("show_dashboard", true)
        customSourceOrder = uiPreferences.getString("source_order", "")
            ?.split(',')
            ?.map(String::trim)
            ?.filter(String::isNotBlank)
            .orEmpty()
        if (!showDashboard && startupSection == TvSection.Home) startupSection = TvSection.Sources
        selectedSection = startupSection
        captionsEnabled = uiPreferences.getBoolean("captions_enabled", true)
        stripCountryPrefixes = uiPreferences.getBoolean("strip_country_prefix", false)
        posterSize = uiPreferences.getString("poster_size", "medium") ?: "medium"
        showPosterTitles = uiPreferences.getBoolean("show_poster_titles", true)
        autoPlayEnabled = uiPreferences.getBoolean("auto_play_enabled", true)
        autoReconnectLiveEnabled = uiPreferences.getBoolean("auto_reconnect_live_enabled", true)
        vodPlaybackSpeed = uiPreferences.getFloat("vod_playback_speed", 1f).takeIf { it in 0.5f..2f } ?: 1f
        vodAutoFailoverEnabled = uiPreferences.getBoolean("vod_auto_failover_enabled", false)
        xtreamStreamFormat = uiPreferences.getString("xtream_stream_format", TvXtreamStreamFormat.AUTO.name)
            ?.let { runCatching { TvXtreamStreamFormat.valueOf(it) }.getOrNull() }
            ?: TvXtreamStreamFormat.AUTO
        showContinueWatching = uiPreferences.getBoolean("show_continue_watching", true)
        showRecentSources = uiPreferences.getBoolean("show_recent_sources", true)
        showLiveFavorites = uiPreferences.getBoolean("show_live_favorites", true)
        showRecentlyWatchedLive = uiPreferences.getBoolean("show_recently_watched_live", true)
        showFavoriteMoviesAndSeries = uiPreferences.getBoolean("show_favorite_movies_series", true)
        showTmdbTrending = uiPreferences.getBoolean("show_tmdb_trending", true)
        showTmdbRecommendations = uiPreferences.getBoolean("show_tmdb_recommendations", true)
        showXtreamRecentlyAdded = uiPreferences.getBoolean("show_xtream_recently_added", true)
        m3uVodDetailsEnabled = uiPreferences.getBoolean("m3u_vod_details_enabled", true)
        epgViewMode = uiPreferences.getString("epg_view_mode", "timeline")
            ?.takeIf { it == "timeline" || it == "list" }
            ?: "timeline"
        preferUploadedEpgOverXtream = uiPreferences.getBoolean("prefer_uploaded_epg_over_xtream", false)
        epgOffsetMinutes = uiPreferences.getInt("epg_offset_minutes", 0).coerceIn(-720, 720)
    }
    var selectedPlaylistId by remember {
        mutableStateOf(uiPreferences.getString("selected_playlist_id", null))
    }
    var favorites by remember { mutableStateOf<List<TvSavedItem>>(emptyList()) }
    var watchedItems by remember { mutableStateOf<List<TvSavedItem>>(emptyList()) }
    var history by remember { mutableStateOf<List<TvSavedItem>>(emptyList()) }
    var dashboardLiveChannels by remember { mutableStateOf<Map<String, List<TvChannel>>>(emptyMap()) }
    var epgByChannel by remember { mutableStateOf<Map<String, List<TvEpgEntry>>>(emptyMap()) }
    var xtreamEpgPreviews by remember { mutableStateOf<Map<String, TvXtreamEpgPreview>>(emptyMap()) }
    var epgSourceStates by remember { mutableStateOf<Map<String, List<TvEpgSourceState>>>(emptyMap()) }
    var epgMappingTarget by remember { mutableStateOf<Pair<String, TvChannel>?>(null) }
    var epgMappingDraft by remember { mutableStateOf("") }
    var epgMessage by remember { mutableStateOf<String?>(null) }
    var epgRefreshing by remember { mutableStateOf(false) }
    var downloadMessage by remember { mutableStateOf<String?>(null) }
    var downloadsMessage by remember { mutableStateOf<String?>(null) }
    var seriesDownloadMessage by remember { mutableStateOf<String?>(null) }
    var downloadId by remember { mutableStateOf<Long?>(null) }
    var downloadRecords by remember { mutableStateOf<List<TvDownloadRecord>>(emptyList()) }
    var downloadSnapshots by remember { mutableStateOf<Map<Long, TvDownloadSnapshot>>(emptyMap()) }
    var recordingHistoryItems by remember { mutableStateOf<List<TvRecording>>(emptyList()) }
    var operationError by remember { mutableStateOf<String?>(null) }
    var sourceMessage by remember { mutableStateOf<String?>(null) }
    var sourceNoticeMessage by remember { mutableStateOf<String?>(null) }
    var sourceBusyId by remember { mutableStateOf<String?>(null) }
    var backupMessage by remember { mutableStateOf<String?>(null) }
    var backupBusy by remember { mutableStateOf(false) }
    var playlistPendingDelete by remember { mutableStateOf<StoredPlaylist?>(null) }
    var playlistPendingRename by remember { mutableStateOf<StoredPlaylist?>(null) }
    var playlistInfo by remember { mutableStateOf<StoredPlaylist?>(null) }
    var playlistInfoCounts by remember { mutableStateOf<TvPlaylistCounts?>(null) }
    var accountInfoPlaylist by remember { mutableStateOf<StoredPlaylist?>(null) }
    var accountInfo by remember { mutableStateOf<XtreamAccountInfo?>(null) }
    var accountStalkerSession by remember { mutableStateOf<StalkerSession?>(null) }
    var accountInfoLoading by remember { mutableStateOf(false) }
    var accountInfoError by remember { mutableStateOf<String?>(null) }
    var renameDraft by remember { mutableStateOf("") }
    var importInitialValues by remember { mutableStateOf<TvImportInitialValues?>(null) }
    var importInProgress by remember { mutableStateOf(false) }
    var xtreamImportStatus by remember { mutableStateOf<String?>(null) }
    var xtreamImportJob by remember { mutableStateOf<Job?>(null) }
    var xtreamImportProgress by remember { mutableStateOf<TvXtreamImportProgress?>(null) }
    var importingName by remember { mutableStateOf("") }
    var importingSourceType by remember { mutableStateOf(TvSourceType.M3U) }
    var importingLocal by remember { mutableStateOf(false) }
    var showLocalFilePicker by remember { mutableStateOf(false) }
    var localFileReplacement by remember { mutableStateOf<StoredPlaylist?>(null) }
    var pendingLocalFilePick by remember { mutableStateOf(false) }
    val store = remember(context, databaseName) {
        databaseName?.let { TvPlaylistStore(context.applicationContext, it) }
            ?: TvPlaylistStore(context.applicationContext)
    }
    val credentialVault = remember(context) { TvCredentialVault(context.applicationContext) }
    val tmdbCache = remember(context) { TmdbCache(context.applicationContext) }
    LaunchedEffect(tmdbCache) {
        tmdbCacheEntries = withContext(Dispatchers.IO) { tmdbCache.size() }
    }
    val downloadManager = remember(context) { TvDownloadManager(context.applicationContext) }
    LaunchedEffect(downloadManager) {
        withContext(Dispatchers.IO) { downloadManager.recoverInterruptedDownloads() }
    }
    val downloadHistory = remember(context) { TvDownloadHistory(context.getSharedPreferences("iptvnator-tv-downloads", 0)) }
    val recordingManager = remember(context) { TvLiveRecordingManager(context.applicationContext) }
    val recordingHistory = remember(context) { TvRecordingHistory(context.getSharedPreferences("iptvnator-tv-recordings", 0)) }
    val activeRecording by recordingManager.active.collectAsState()
    val repository = remember(store, credentialVault, tmdbCache) {
        TvPlaylistRepository(
            store,
            credentialVault = credentialVault,
            tmdbCache = tmdbCache,
            contentResolver = context.contentResolver,
        )
    }
    DisposableEffect(store) {
        onDispose { store.close() }
    }
    DisposableEffect(recordingManager) {
        onDispose { recordingManager.close() }
    }
    LaunchedEffect(activeRecording?.file?.absolutePath, activeRecording?.status) {
        val finished = activeRecording?.takeIf { it.status != TvRecordingStatus.RECORDING }
        if (finished != null) {
            recordingHistory.add(finished)
            recordingHistoryItems = recordingHistory.load()
            recordingManager.dismissFinished()
        }
    }
    LaunchedEffect(recordingHistory) {
        recordingHistoryItems = withContext(Dispatchers.IO) { recordingHistory.load() }
    }
    val scope = rememberCoroutineScope()
    val playbackZapMutex = remember { Mutex() }
    var playbackZapNoticeGeneration by remember { mutableStateOf(0) }
    var playbackHistoryRefreshJob by remember { mutableStateOf<Job?>(null) }
    fun refreshPlaybackHistoryAfterZap() {
        playbackHistoryRefreshJob?.cancel()
        playbackHistoryRefreshJob = scope.launch {
            // Keep history current for dashboard surfaces without making the
            // next CH+/CH− action wait for a full history query after each zap.
            delay(250)
            history = withContext(Dispatchers.IO) { repository.loadHistory() }
        }
    }
    val dashboardChannelKeys = remember(favorites, history) {
        (favorites + history)
            .filter { it.itemType == com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL }
            .distinctBy { "${it.playlistId}:${it.itemKey}" }
    }
    LaunchedEffect(
        dashboardChannelKeys.map { "${it.playlistId}:${it.itemKey}" },
        playlists.map { it.id },
    ) {
        dashboardLiveChannels = withContext(Dispatchers.IO) {
            dashboardChannelKeys.groupBy { it.playlistId }.mapValues { (playlistId, items) ->
                items.mapNotNull { item -> repository.loadChannel(playlistId, item.itemKey) }
            }
        }
    }
    LaunchedEffect(
        favorites.map { "${it.playlistId}:${it.itemType}:${it.itemKey}" },
        playlists.map { it.id },
    ) {
        val favoriteVod = favorites.filter { it.itemType == TvSavedItemType.VOD }
        val favoriteSeries = favorites.filter { it.itemType == TvSavedItemType.SERIES }
        val loaded = withContext(Dispatchers.IO) {
            favoriteVod.mapNotNull { item ->
                item.itemKey.toIntOrNull()?.let { id -> repository.loadVodItem(item.playlistId, id)?.let { item.playlistId to it } }
            }.groupBy({ it.first }, { it.second }) to favoriteSeries.mapNotNull { item ->
                item.itemKey.toIntOrNull()?.let { id -> repository.loadSeriesItem(item.playlistId, id)?.let { item.playlistId to it } }
            }.groupBy({ it.first }, { it.second })
        }
        dashboardFavoriteVod = loaded.first
        dashboardFavoriteSeries = loaded.second
    }
    fun openEpgMapping(playlistId: String, channel: TvChannel) {
        epgMappingTarget = playlistId to channel
        epgMappingDraft = ""
        scope.launch {
            epgMappingDraft = withContext(Dispatchers.IO) {
                repository.loadEpgMapping(playlistId, channel.id).orEmpty()
            }
        }
    }
    fun openAccountInfo(playlist: StoredPlaylist) {
        accountInfoPlaylist = playlist
        accountInfo = null
        accountStalkerSession = null
        accountInfoError = null
        accountInfoLoading = true
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    when (playlistType(playlist)) {
                        "Xtream" -> repository.loadXtreamAccountInfo(playlist.id)
                            ?.let { info -> info to null }
                        "Stalker" -> repository.loadStalkerAccountInfo(playlist.id)
                            ?.let { session -> null to session }
                        else -> null to null
                    }
                }
            }.onSuccess { result ->
                accountInfo = result?.first
                accountStalkerSession = result?.second
                if (result?.first == null && result?.second == null && playlistType(playlist) != "M3U") {
                    accountInfoError = "El portal no devolvió información de cuenta."
                }
            }.onFailure { failure ->
                accountInfoError = if (playlistType(playlist) == "Xtream") friendlyXtreamError(failure)
                else failure.message ?: "No se pudo consultar la cuenta del portal."
            }
            accountInfoLoading = false
        }
    }
    fun openPlaylistInfo(playlist: StoredPlaylist) {
        playlistInfo = playlist
        playlistInfoCounts = null
        scope.launch {
            playlistInfoCounts = withContext(Dispatchers.IO) { repository.loadPlaylistCounts(playlist.id) }
        }
    }
    fun openEditPlaylist(playlist: StoredPlaylist) {
        if (playlistType(playlist) == "M3U" && !isRemotePlaylistSource(playlist.sourceUrl)) {
            // Existing local sources, including old imports without a saved
            // URI, can attach or replace their file without losing their ID.
            localFileReplacement = playlist
            pendingLocalFilePick = true
            importInitialValues = null
            operationError = null
            sourceMessage = null
            showPlaylistMenu = false
            return
        }
        scope.launch {
            val initial = withContext(Dispatchers.IO) {
                val type = playlistType(playlist)
                val account = repository.loadProviderAccount(playlist.id)
                TvImportInitialValues(
                    playlistId = playlist.id,
                    sourceType = when (type) {
                        "Xtream" -> TvSourceType.XTREAM
                        "Stalker" -> TvSourceType.STALKER
                        else -> TvSourceType.M3U
                    },
                    name = playlist.name,
                    url = when (type) {
                        "Xtream" -> account.xtream?.serverUrl.orEmpty()
                        "Stalker" -> account.stalker?.portalUrl.orEmpty()
                        else -> playlist.sourceUrl.orEmpty()
                    },
                    epgUrl = playlist.epgUrl.orEmpty(),
                    epgUrls = playlist.epgUrls,
                    userAgent = playlist.sourceUserAgent.orEmpty(),
                    sourceReferrer = playlist.sourceReferrer,
                    sourceOrigin = playlist.sourceOrigin,
                    username = account.xtream?.username ?: account.stalker?.username.orEmpty(),
                    password = account.xtream?.password ?: account.stalker?.password.orEmpty(),
                    macAddress = account.stalker?.macAddress.orEmpty(),
                    serialNumber = account.stalker?.serialNumber.orEmpty(),
                    deviceId1 = account.stalker?.deviceId1.orEmpty(),
                    deviceId2 = account.stalker?.deviceId2.orEmpty(),
                    signature1 = account.stalker?.signature1.orEmpty(),
                    signature2 = account.stalker?.signature2.orEmpty(),
                )
            }
            importInitialValues = initial
            importSourceType = initial.sourceType
            operationError = null
            showImport = true
        }
    }
    val fallbackBackupFile = remember(context) {
        File(context.filesDir, "backups/iptvnator-playlist-backup.json")
    }
    val hasDocumentPicker = remember(context) {
        val pickerPackage = context.packageManager.resolveActivity(
            Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                type = "application/json"
                addCategory(Intent.CATEGORY_OPENABLE)
            },
            0,
        )?.activityInfo?.packageName
        // Some TV emulator images expose a framework stub that resolves the
        // intent but cannot actually display DocumentsUI.
        isUsableTvDocumentPickerPackage(pickerPackage)
    }
    suspend fun buildBackupJson(): String = withContext(Dispatchers.IO) {
        val backupPlaylists = repository.loadStoredForBackup()
        TvPlaylistBackup.export(
            backupPlaylists,
            credentialVault,
            TvPlaylistBackup.mergeSavedItems(favorites, history, watchedItems),
            backupPlaylists.flatMap { repository.loadEpisodeProgressForPlaylist(it.id) },
            epgSourceStates = backupPlaylists.associate { playlist ->
                playlist.id to repository.loadEpgSourceStates(playlist.id)
            },
            autoRefresh = { playlistId -> uiPreferences.getBoolean("auto_refresh_$playlistId", false) },
            sourceOrder = customSourceOrder + backupPlaylists.map { it.id },
        )
    }
    suspend fun writeFallbackBackup(json: String): String = withContext(Dispatchers.IO) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, "iptvnator-playlist-backup.json")
                put(MediaStore.Downloads.MIME_TYPE, "application/json")
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: error("No se pudo crear el backup en Descargas")
            try {
                context.contentResolver.openOutputStream(uri)?.use { output ->
                    output.write(json.toByteArray(Charsets.UTF_8))
                } ?: error("No se pudo escribir el backup en Descargas")
                context.contentResolver.update(uri, ContentValues().apply {
                    put(MediaStore.Downloads.IS_PENDING, 0)
                }, null, null)
                fallbackBackupFile.parentFile?.mkdirs()
                fallbackBackupFile.writeText(json)
                "Backup guardado en Descargas/iptvnator-playlist-backup.json."
            } catch (failure: Throwable) {
                context.contentResolver.delete(uri, null, null)
                throw failure
            }
        } else {
            fallbackBackupFile.parentFile?.mkdirs()
            fallbackBackupFile.writeText(json)
            "Backup guardado en el almacenamiento privado de la app."
        }
    }
    suspend fun readFallbackBackup(): String = withContext(Dispatchers.IO) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val projection = arrayOf(MediaStore.Downloads._ID)
            context.contentResolver.query(
                MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                projection,
                "${MediaStore.Downloads.DISPLAY_NAME} = ?",
                arrayOf("iptvnator-playlist-backup.json"),
                "${MediaStore.Downloads.DATE_MODIFIED} DESC",
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val uri = ContentUris.withAppendedId(
                        MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                        cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Downloads._ID)),
                    )
                    context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { reader ->
                        return@withContext reader.readText()
                    }
                }
            }
        }
        fallbackBackupFile.takeIf { it.isFile }?.readText()
            ?: error("No hay ningún backup local para restaurar")
    }
    suspend fun refreshRestoredBackupEpg(summary: TvBackupImportSummary) {
        val restored = withContext(Dispatchers.IO) {
            repository.loadStored().filter { playlist ->
                playlist.id in summary.importedPlaylistIds && playlist.epgUrls.isNotEmpty()
            }.filter { playlist ->
                val account = repository.loadProviderAccount(playlist.id)
                // Do not turn restoring a large Xtream backup into a 28k-stream
                // native EPG sweep. Manual XMLTV is refreshed immediately when
                // selected, and M3U/Stalker sources can hydrate normally.
                account.xtream == null || preferUploadedEpgOverXtream
            }
        }
        if (restored.isNotEmpty()) {
            withContext(Dispatchers.IO) {
                repository.refreshEpg(restored)
            }
        }
    }
    val backupExportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/json"),
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            backupBusy = true
            backupMessage = runCatching {
                val json = buildBackupJson()
                withContext(Dispatchers.IO) {
                    context.contentResolver.openOutputStream(uri)?.use { output ->
                        output.write(json.toByteArray(Charsets.UTF_8))
                    } ?: error("No se pudo abrir el archivo de backup")
                }
                "Backup guardado correctamente."
            }.getOrElse { "No se pudo guardar el backup: ${it.message ?: "error desconocido"}" }
            backupBusy = false
        }
    }
    val backupImportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            backupBusy = true
            backupMessage = runCatching {
                val json = withContext(Dispatchers.IO) {
                    context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
                        ?: error("No se pudo leer el backup")
                }
                val restoredPositions = mutableListOf<Pair<String, Int>>()
                val summary = withContext(Dispatchers.IO) {
                    TvPlaylistBackup.import(
                        json,
                        repository,
                        onAutoRefresh = { playlistId, enabled ->
                            uiPreferences.edit().putBoolean("auto_refresh_$playlistId", enabled).apply()
                        },
                        onSourcePosition = { playlistId, position -> restoredPositions += playlistId to position },
                    )
                }
                playlists = withContext(Dispatchers.IO) { repository.loadStored() }
                customSourceOrder = TvPlaylistBackup.mergeSourceOrder(customSourceOrder, restoredPositions)
                uiPreferences.edit().putString("source_order", customSourceOrder.joinToString(",")).apply()
                refreshRestoredBackupEpg(summary)
                playlists = withContext(Dispatchers.IO) { repository.loadStored() }
                favorites = withContext(Dispatchers.IO) { repository.loadFavorites() }
                watchedItems = withContext(Dispatchers.IO) { repository.loadWatched() }
                history = withContext(Dispatchers.IO) { repository.loadHistory() }
                epgByChannel = withContext(Dispatchers.IO) { repository.loadEpgSnapshot(playlists) }
                if (summary.failed == 0) {
                    "Backup restaurado: ${summary.imported} fuente(s)."
                } else {
                    "Restauradas ${summary.imported}; ${summary.failed} con error: ${summary.errors.first()}"
                }
            }.getOrElse { "No se pudo restaurar el backup: ${it.message ?: "error desconocido"}" }
            backupBusy = false
        }
    }
    fun exportBackup() {
        if (hasDocumentPicker) {
            backupExportLauncher.launch("iptvnator-playlist-backup.json")
        } else {
            scope.launch {
                backupBusy = true
                backupMessage = runCatching {
                    writeFallbackBackup(buildBackupJson())
                }.getOrElse { "No se pudo guardar el backup: ${it.message ?: "error desconocido"}" }
                backupBusy = false
            }
        }
    }
    fun importBackup() {
        if (hasDocumentPicker) {
            backupImportLauncher.launch(arrayOf("application/json", "text/plain", "*/*"))
        } else {
            scope.launch {
                backupBusy = true
                backupMessage = runCatching {
                    val restoredPositions = mutableListOf<Pair<String, Int>>()
                    val summary = withContext(Dispatchers.IO) {
                        TvPlaylistBackup.import(
                            readFallbackBackup(),
                            repository,
                            onAutoRefresh = { playlistId, enabled ->
                                uiPreferences.edit().putBoolean("auto_refresh_$playlistId", enabled).apply()
                            },
                            onSourcePosition = { playlistId, position -> restoredPositions += playlistId to position },
                        )
                    }
                    refreshRestoredBackupEpg(summary)
                    playlists = withContext(Dispatchers.IO) { repository.loadStored() }
                    customSourceOrder = TvPlaylistBackup.mergeSourceOrder(customSourceOrder, restoredPositions)
                    uiPreferences.edit().putString("source_order", customSourceOrder.joinToString(",")).apply()
                    favorites = withContext(Dispatchers.IO) { repository.loadFavorites() }
                    watchedItems = withContext(Dispatchers.IO) { repository.loadWatched() }
                    history = withContext(Dispatchers.IO) { repository.loadHistory() }
                    epgByChannel = withContext(Dispatchers.IO) { repository.loadEpgSnapshot(playlists) }
                    "Backup restaurado: ${summary.imported} fuente(s), ${summary.failed} con error."
                }.getOrElse { "No se pudo restaurar el backup: ${it.message ?: "error desconocido"}" }
                backupBusy = false
            }
        }
    }
    var localImportName by remember { mutableStateOf("Local playlist") }
    var epgFilePlaylistId by remember { mutableStateOf<String?>(null) }
    val epgFilePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val playlistId = epgFilePlaylistId
        epgFilePlaylistId = null
        if (uri == null || playlistId == null) return@rememberLauncherForActivityResult
        runCatching {
            context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val playlist = playlists.firstOrNull { it.id == playlistId } ?: return@rememberLauncherForActivityResult
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    val allEpgUrls = repository.loadEpgSourceStates(playlist.id).map { it.url }
                    repository.updateEpgUrls(playlist.id, allEpgUrls + uri.toString())
                    val updated = repository.loadStored().first { it.id == playlist.id }
                    repository.refreshEpg(listOf(updated))
                }
            }.onSuccess {
                playlists = withContext(Dispatchers.IO) { repository.loadStored() }
                epgByChannel = withContext(Dispatchers.IO) { repository.loadEpgSnapshot(playlists) }
                sourceMessage = "Archivo XMLTV añadido: ${playlist.name}"
            }.onFailure { sourceMessage = it.message ?: "No se pudo añadir el archivo XMLTV" }
        }
    }
    val localM3uPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) {
            // We only launch OpenDocument when a provider exists. A null
            // result here is the user's Cancel action.
            localFileReplacement = null
            return@rememberLauncherForActivityResult
        }
        val replacement = localFileReplacement
        // ACTION_OPEN_DOCUMENT grants persistable access when the provider
        // supports it, allowing this source to be refreshed after a reboot.
        runCatching {
            context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }.onFailure { failure ->
            Log.w("TvImport", "M3U document grant could not be persisted: ${failure.javaClass.simpleName}")
        }
        val displayName = context.contentResolver.query(
            uri,
            arrayOf(OpenableColumns.DISPLAY_NAME),
            null,
            null,
            null,
        )?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        } ?: uri.lastPathSegment
        localImportName = replacement?.name ?: displayName
            ?.substringBeforeLast('.')
            ?.ifBlank { "Local playlist" }
            ?: "Local playlist"
        importInProgress = true
        importingSourceType = TvSourceType.M3U; importingName = localImportName; importingLocal = true; xtreamImportProgress = null
        if (replacement != null) {
            sourceBusyId = replacement.id
            sourceMessage = "Importando archivo M3U…"
            selectedSection = TvSection.Sources
        }
        scope.launch {
            runCatching {
                val imported = withContext(Dispatchers.IO) {
                    context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { reader ->
                        repository.importM3uReader(
                            reader,
                            localImportName,
                            identitySeed = uri.toString(),
                            sourceUrl = uri.toString(),
                            epgUrl = replacement?.epgUrl ?: importInitialValues?.epgUrl,
                            userAgent = replacement?.sourceUserAgent ?: importInitialValues?.userAgent,
                            sourceReferrer = replacement?.sourceReferrer ?: importInitialValues?.sourceReferrer,
                            sourceOrigin = replacement?.sourceOrigin ?: importInitialValues?.sourceOrigin,
                            playlistIdOverride = replacement?.id ?: importInitialValues?.playlistId,
                        )
                    } ?: error("No se pudo leer el archivo M3U")
                }
                imported
            }.onSuccess {
                importInProgress = false
                sourceBusyId = null
                localFileReplacement = null
                importInitialValues = null
                operationError = null
                playlists = withContext(Dispatchers.IO) { repository.loadStored() }
                favorites = withContext(Dispatchers.IO) { repository.loadFavorites() }
                history = withContext(Dispatchers.IO) { repository.loadHistory() }
                epgByChannel = withContext(Dispatchers.IO) { repository.loadEpgSnapshot(playlists) }
                selectedPlaylistId = it.id
                if (replacement != null) sourceMessage = "Archivo M3U actualizado: ${it.name}"
                showImport = false
                selectedSection = TvSection.Home
            }.onFailure {
                importInProgress = false
                sourceBusyId = null
                localFileReplacement = null
                operationError = it.message ?: "No se pudo importar el archivo M3U"
                if (replacement != null) sourceMessage = operationError
            }
        }
    }

    LaunchedEffect(pendingLocalFilePick) {
        if (!pendingLocalFilePick) return@LaunchedEffect
        pendingLocalFilePick = false
        localImportName = localFileReplacement?.name ?: "Local playlist"
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
        }
        val hasDocumentProvider = context.packageManager.queryIntentActivities(intent, 0).any { info ->
            isUsableTvDocumentPickerPackage(info.activityInfo.packageName)
        }
        if (hasDocumentProvider) {
            localM3uPicker.launch(arrayOf("audio/x-mpegurl", "application/x-mpegurl", "text/plain", "*/*"))
        } else {
            showLocalFilePicker = true
        }
    }

    LaunchedEffect(repository) {
        val loaded = withContext(Dispatchers.IO) { repository.loadStored() }
        playlists = loaded
        favorites = withContext(Dispatchers.IO) { repository.loadFavorites() }
        watchedItems = withContext(Dispatchers.IO) { repository.loadWatched() }
        history = withContext(Dispatchers.IO) { repository.loadHistory() }
        epgByChannel = withContext(Dispatchers.IO) { repository.loadEpgSnapshot(loaded) }
        epgSourceStates = withContext(Dispatchers.IO) {
            loaded.associate { it.id to repository.loadEpgSourceStates(it.id) }
        }
        val restoredDownloads = withContext(Dispatchers.IO) { downloadHistory.load() }
        downloadRecords = restoredDownloads
        downloadSnapshots = withContext(Dispatchers.IO) {
            restoredDownloads.mapNotNull { record ->
                downloadManager.query(record.downloadId)?.let { record.downloadId to it }
            }.toMap()
        }
        initialSourcesLoading = false

        // Match the original auto-refresh contract: only sources explicitly
        // marked for startup refresh contact the provider here. Keep the first
        // frame usable and isolate failures per source: an unavailable portal
        // must never prevent local playlists or the dashboard from loading.
        val refreshableSources = loaded.filter { playlist ->
            playlistHasRefreshableSource(playlist) &&
                uiPreferences.getBoolean("auto_refresh_${playlist.id}", false)
        }
        if (refreshableSources.isNotEmpty()) {
            // Do not hold the initial screen behind provider/network timeouts.
            // The original client keeps the catalogue usable while its
            // background refresh completes; this is especially important on
            // TV where an unavailable provider must not look like a frozen UI.
            launch(Dispatchers.IO) {
                // Match IPTVnator's bounded startup refresh: a slow portal
                // must not serialize every other source, while launching one
                // request per playlist could overwhelm the TV and provider.
                var failedRefreshes = 0
                refreshableSources.chunked(3).forEach { batch ->
                    failedRefreshes += batch.map { playlist ->
                        async {
                            try {
                                repository.refreshPlaylist(playlist)
                                false
                            } catch (cancelled: CancellationException) {
                                throw cancelled
                            } catch (_: Exception) {
                                true
                            }
                        }
                    }.awaitAll().count { it }
                }
                val refreshedBeforeEpg = repository.loadStored()
                // Importing or refreshing a source can expose an XMLTV URL;
                // reconcile it in the same background pass so the first visit
                // to Guide already has data, like IPTVnator's startup worker.
                runCatching { repository.refreshEpg(refreshedBeforeEpg) }
                val refreshed = repository.loadStored()
                val refreshedFavorites = repository.loadFavorites()
                val refreshedWatched = repository.loadWatched()
                val refreshedHistory = repository.loadHistory()
                val refreshedEpg = repository.loadEpgSnapshot(refreshed)
                withContext(Dispatchers.Main.immediate) {
                    playlists = refreshed
                    favorites = refreshedFavorites
                    watchedItems = refreshedWatched
                    history = refreshedHistory
                    epgByChannel = refreshedEpg
                    sourceMessage = if (failedRefreshes == 0) {
                        "Actualización automática completada: ${refreshableSources.size} fuentes."
                    } else {
                        "Actualización automática: ${refreshableSources.size - failedRefreshes} correctas, $failedRefreshes con error."
                    }
                    sourceNoticeMessage = sourceMessage
                }
            }
        } else {
            // Local M3U sources can also declare a remote XMLTV URL. They do
            // not take part in remote playlist refresh, but their guide should
            // still be hydrated without requiring a manual button press.
            launch(Dispatchers.IO) {
                val current = repository.loadStored()
                runCatching { repository.refreshEpg(current) }
                val refreshedEpg = repository.loadEpgSnapshot(current)
                withContext(Dispatchers.Main.immediate) {
                    epgByChannel = refreshedEpg
                }
            }
        }
    }

    LaunchedEffect(playlists) {
        if (playlists.none { it.id == selectedPlaylistId }) {
            selectedPlaylistId = playlists.firstOrNull()?.id
        }
    }

    LaunchedEffect(
        playlists.map { it.id to it.vod.size + it.series.size },
        history.map { "${it.playlistId}:${it.itemType}:${it.itemKey}:${it.lastPlayedAt}" },
        showTmdbTrending,
        showTmdbRecommendations,
    ) {
        if (!showTmdbTrending && !showTmdbRecommendations) {
            tmdbTrendingItems = emptyList()
            tmdbRecommendationItems = emptyList()
        } else {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val trending = if (showTmdbTrending) repository.tmdbTrending() else emptyList()
                    val recommendations = if (showTmdbRecommendations) repository.tmdbRecommendations(history) else emptyList()
                    trending to recommendations
                }.getOrDefault(emptyList<TmdbSearchResult>() to emptyList())
            }
            tmdbTrendingItems = result.first
            tmdbRecommendationItems = result.second
        }
    }

    LaunchedEffect(repository, playlists) {
        val ids = playlists.map { it.id }
        if (ids.isEmpty()) {
            dashboardRecentlyAddedVod = emptyMap()
            dashboardRecentlyAddedSeries = emptyMap()
        } else {
            val recent = withContext(Dispatchers.IO) {
                ids.map { playlistId ->
                    playlistId to repository.loadRecentVodPage(playlistId, 12)
                }.toMap() to ids.map { playlistId ->
                    playlistId to repository.loadRecentSeriesPage(playlistId, 12)
                }.toMap()
            }
            dashboardRecentlyAddedVod = recent.first
            dashboardRecentlyAddedSeries = recent.second
        }
    }

    LaunchedEffect(selectedPlaylistId) {
        uiPreferences.edit()
            .putString("selected_playlist_id", selectedPlaylistId)
            .apply()
    }

    // A section change closes the source menu; opening it from the top bar
    // of any section must not be undone by this effect.
    LaunchedEffect(selectedSection) {
        showPlaylistMenu = false
    }

    LaunchedEffect(selectedSection) {
        if (selectedSection != TvSection.Recent) recentSearchQuery.value = ""
        if (selectedSection != TvSection.Favorites) favoritesSearchQuery.value = ""
    }

    BackHandler(
        enabled = playbackRequest == null && seriesDetails == null && vodDetails == null &&
            (showPlaylistMenu || showImport || showLocalFilePicker || selectedSection != TvSection.Home),
    ) {
        when {
            showLocalFilePicker -> {
                showLocalFilePicker = false
                localFileReplacement = null
            }
            showPlaylistMenu -> {
                showPlaylistMenu = false
                mainContentFocusRequester.requestFocus()
            }
            showImport -> showImport = false
            else -> selectedSection = TvSection.Home
        }
    }

    LaunchedEffect(downloadRecords.map { it.downloadId }) {
        while (downloadRecords.isNotEmpty()) {
            downloadSnapshots = withContext(Dispatchers.IO) {
                downloadRecords.mapNotNull { record -> downloadManager.query(record.downloadId)?.let { record.downloadId to it } }.toMap()
            }
            delay(1_000)
        }
    }

    LaunchedEffect(seriesDetails) {
        val current = seriesDetails
        seriesDownloadMessage = null
        seriesTmdb = current?.second?.let { details ->
            withContext(Dispatchers.IO) { runCatching { repository.tmdbSeriesDetails(details.name) }.getOrNull() }
        }
        episodeProgress = if (current == null) {
            emptyMap()
        } else {
            withContext(Dispatchers.IO) { repository.loadEpisodeProgress(current.first, current.second.id) }
        }
    }

    LaunchedEffect(vodDetails, downloadId) {
        while (vodDetails != null && downloadId != null) {
            val snapshot = withContext(Dispatchers.IO) { downloadManager.query(downloadId!!) }
            if (snapshot != null) {
                val progress = snapshot.progressPercent?.let { " $it%" }.orEmpty()
                downloadMessage = when (snapshot.status) {
                    DownloadManager.STATUS_SUCCESSFUL -> "Descarga completada.$progress"
                    DownloadManager.STATUS_FAILED -> "La descarga ha fallado${snapshot.reason?.let { " ($it)" }.orEmpty()}."
                    DownloadManager.STATUS_PAUSED -> "Descarga pausada.$progress"
                    DownloadManager.STATUS_PENDING, DownloadManager.STATUS_RUNNING -> "Descargando…$progress"
                    else -> downloadMessage
                }
                if (snapshot.status == DownloadManager.STATUS_SUCCESSFUL || snapshot.status == DownloadManager.STATUS_FAILED) break
            }
            delay(1_000)
        }
    }

    LaunchedEffect(m3uVodDetails, m3uVodDownloadId) {
        while (m3uVodDetails != null && m3uVodDownloadId != null) {
            val snapshot = withContext(Dispatchers.IO) { downloadManager.query(m3uVodDownloadId!!) }
            if (snapshot != null) {
                val progress = snapshot.progressPercent?.let { " $it%" }.orEmpty()
                m3uVodDownloadMessage = when (snapshot.status) {
                    DownloadManager.STATUS_SUCCESSFUL -> "Descarga completada.$progress"
                    DownloadManager.STATUS_FAILED -> "La descarga ha fallado${snapshot.reason?.let { " ($it)" }.orEmpty()}."
                    DownloadManager.STATUS_PAUSED -> "Descarga pausada.$progress"
                    DownloadManager.STATUS_PENDING, DownloadManager.STATUS_RUNNING -> "Descargando…$progress"
                    else -> m3uVodDownloadMessage
                }
                if (snapshot.status == DownloadManager.STATUS_SUCCESSFUL || snapshot.status == DownloadManager.STATUS_FAILED) break
            }
            delay(1_000)
        }
    }

    suspend fun resolveChannelPlaybackRequest(
        playlistId: String,
        channel: TvChannel,
    ): Result<TvPlaybackRequest> = resolveTvChannelPlaybackRequest(
        channel = channel,
        resolveStalker = {
            withContext(Dispatchers.IO) { repository.resolveStalkerChannel(playlistId, channel) }
        },
        resolveXtream = {
            withContext(Dispatchers.IO) {
                repository.resolveXtreamChannelPlayback(playlistId, channel, xtreamStreamFormat)
            }
        },
        directRequest = { channel.toPlaybackRequest() },
    )

    fun showChannelSwitchFailure() {
        val notice = "No se pudo cambiar de canal. Se mantiene el canal actual."
        playbackZapNoticeGeneration += 1
        playbackNotice = notice
        val generation = playbackZapNoticeGeneration
        scope.launch {
            delay(3_500)
            if (playbackZapNoticeGeneration == generation && playbackNotice == notice) playbackNotice = null
        }
    }

    fun beginPlaybackZapNotice(): Int {
        playbackZapNoticeGeneration += 1
        playbackNotice = "Cambiando de canal…"
        return playbackZapNoticeGeneration
    }

    fun finishPlaybackZapNotice(generation: Int, channelName: String) {
        if (playbackZapNoticeGeneration != generation) return
        val notice = "Canal: $channelName"
        playbackNotice = notice
        scope.launch {
            delay(1_500)
            if (playbackZapNoticeGeneration == generation && playbackNotice == notice) playbackNotice = null
        }
    }

    fun cancelPlaybackZapNotice(generation: Int) {
        if (playbackZapNoticeGeneration == generation && playbackNotice == "Cambiando de canal…") {
            playbackZapNoticeGeneration += 1
            playbackNotice = null
        }
    }

    fun playbackZapScopeFor(
        playlistId: String,
        scope: TvChannelZapScope = TvChannelZapScope(),
        radioOnly: Boolean = false,
    ): TvChannelZapScope {
        val playlist = playlists.firstOrNull { it.id == playlistId }
        return scope.copy(
            hiddenGroupTitles = playlist?.hiddenGroupTitles.orEmpty(),
            hiddenCategoryIds = if (radioOnly) emptyList() else playlist?.hiddenCategories
                .orEmpty()
                .filter { it.type == "live" }
                .map { it.id },
        )
    }

    fun defaultChannelZapScope(channel: TvChannel): TvChannelZapScope {
        val providerOwned = channel.id.startsWith("xtream:") || channel.id.startsWith("stalker:")
        if (!providerOwned) return TvChannelZapScope()
        val sortPreference = uiPreferences.getString(
            if (channel.radio) "radio_sort_mode" else "live_sort_mode",
            "SERVER",
        )
        val order = when (sortPreference) {
            "NAME_ASC" -> TvChannelZapOrder.NAME_ASC
            "NAME_DESC" -> TvChannelZapOrder.NAME_DESC
            else -> TvChannelZapOrder.SOURCE
        }
        return TvChannelZapScope(
            order = order,
            groupName = channel.group,
            providerCategoryId = channel.providerCategoryId,
        )
    }

    // Keep live-channel zapping available from the native player without
    // hijacking DPAD navigation used by Media3's transport controls. Android
    // TV remotes expose CHANNEL_UP/DOWN separately from the arrows.
    val playbackChannelChange: ((Int) -> Unit)? = if (
        playbackRequest != null &&
        activePlaybackItem?.itemType == com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL
    ) {
        { delta ->
            val noticeGeneration = beginPlaybackZapNotice()
            scope.launch {
                playbackZapMutex.withLock {
                    // Read the active channel only after acquiring the lock:
                    // rapid remote key presses must advance from the result of
                    // the previous zap rather than all targeting one channel.
                    val current = activePlaybackItem?.takeIf {
                        it.itemType == com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL
                    } ?: run {
                        cancelPlaybackZapNotice(noticeGeneration)
                        return@withLock
                    }
                    val zapScope = playbackZapScope
                    val zapQueue = playbackZapQueue
                    // The UI queue may be filtered or alphabetically sorted. CH+/− is
                    // resolved inside that captured channel-list scope. Large catalogues
                    // stay on the indexed SQLite path rather than being copied into a
                    // transient Compose list just to step from one channel to the next.
                    val target = withContext(Dispatchers.IO) {
                        if (zapScope.order == TvChannelZapOrder.CAPTURED) {
                            adjacentTvChannelInCapturedQueue(
                                zapQueue,
                                current.playlistId,
                                current.itemKey,
                                delta,
                            )?.let { entry ->
                                repository.loadChannel(entry.playlistId, entry.channelId)
                                    ?.let { entry.playlistId to it }
                            }
                        } else if (zapScope.playlistOrder.size > 1) {
                            val sourceIds = zapScope.playlistOrder
                            val hiddenGroupsByPlaylist = sourceIds.associateWith { sourceId ->
                                playlists.firstOrNull { it.id == sourceId }?.hiddenGroupTitles.orEmpty()
                            }
                            val hiddenCategoriesByPlaylist = sourceIds.associateWith { sourceId ->
                                playlists.firstOrNull { it.id == sourceId }?.hiddenCategories
                                    .orEmpty()
                                    .filter { it.type == "live" }
                                    .map { it.id }
                            }
                            repository.loadAdjacentChannelAcrossPlaylists(
                                playlistIds = sourceIds,
                                playlistId = current.playlistId,
                                channelId = current.itemKey,
                                delta = delta,
                                groupName = zapScope.groupName,
                                providerCategoryId = zapScope.providerCategoryId,
                                sortByName = zapScope.order == TvChannelZapOrder.NAME_ASC ||
                                    zapScope.order == TvChannelZapOrder.NAME_DESC,
                                descending = zapScope.order == TvChannelZapOrder.NAME_DESC,
                                hiddenGroupTitlesByPlaylist = hiddenGroupsByPlaylist,
                                hiddenCategoryIdsByPlaylist = hiddenCategoriesByPlaylist,
                            )
                        } else {
                            repository.loadAdjacentChannelInScope(
                                current.playlistId,
                                current.itemKey,
                                delta,
                                groupName = zapScope.groupName,
                                providerCategoryId = zapScope.providerCategoryId,
                                sortByName = zapScope.order == TvChannelZapOrder.NAME_ASC ||
                                    zapScope.order == TvChannelZapOrder.NAME_DESC,
                                descending = zapScope.order == TvChannelZapOrder.NAME_DESC,
                                hiddenGroupTitles = zapScope.hiddenGroupTitles,
                                hiddenCategoryIds = zapScope.hiddenCategoryIds,
                            )?.let { current.playlistId to it }
                        }
                    } ?: run {
                        cancelPlaybackZapNotice(noticeGeneration)
                        return@withLock
                    }
                    val (targetPlaylistId, targetChannel) = target
                    val targetRequest = resolveChannelPlaybackRequest(targetPlaylistId, targetChannel)
                        .getOrElse {
                            showChannelSwitchFailure()
                            return@withLock
                        }
                    withContext(Dispatchers.IO) {
                        repository.recordChannelPlayback(targetPlaylistId, targetChannel)
                    }
                    activePlaybackItem = targetChannel.toSavedItem(targetPlaylistId)
                    playbackRequest = targetRequest
                    finishPlaybackZapNotice(noticeGeneration, targetChannel.name)
                }
                refreshPlaybackHistoryAfterZap()
            }
        }
    } else null

    val playbackChannelNumber: ((Int) -> Unit)? = if (
        playbackRequest != null &&
        activePlaybackItem?.itemType == com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL
    ) {
        { requested ->
            val noticeGeneration = beginPlaybackZapNotice()
            scope.launch {
                playbackZapMutex.withLock {
                    // Serialize numeric selection with CH+/CH−. Resolve the
                    // active item after acquiring the lock so whichever remote
                    // action ran first cannot be overwritten by a stale lookup.
                    val current = activePlaybackItem?.takeIf {
                        it.itemType == com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL
                    } ?: run {
                        cancelPlaybackZapNotice(noticeGeneration)
                        return@withLock
                    }
                    val zapScope = playbackZapScope
                    val zapQueue = playbackZapQueue
                    val target = withContext(Dispatchers.IO) {
                        if (zapScope.order == TvChannelZapOrder.CAPTURED) {
                            tvChannelEntryForNumber(zapQueue, requested)?.let { entry ->
                                repository.loadChannel(entry.playlistId, entry.channelId)
                                    ?.let { entry.playlistId to it }
                            }
                        } else {
                            val position = tvChannelPositionForNumber(requested) ?: return@withContext null
                            if (zapScope.playlistOrder.size > 1) {
                                // The global live view is a concatenation of source blocks;
                                // numeric entry follows that complete order via indexed counts.
                                repository.loadChannelAtPositionAcrossPlaylists(
                                    zapScope.playlistOrder,
                                    position,
                                    playbackRequest?.isAudio == true,
                                )
                            } else {
                                val currentChannel = repository.loadChannel(current.playlistId, current.itemKey)
                                val radioOnly = currentChannel?.radio
                                // Numeric entry outside a captured collection follows the provider's
                                // 1-based source order, not tvg-chno or a filtered/sorted UI page.
                                repository.loadChannelAtPosition(current.playlistId, position, radioOnly)
                                    ?.let { current.playlistId to it }
                            }
                        }
                    } ?: run {
                        cancelPlaybackZapNotice(noticeGeneration)
                        showChannelSwitchFailure()
                        return@launch
                    }
                    val (targetPlaylistId, targetChannel) = target
                    val targetRequest = resolveChannelPlaybackRequest(targetPlaylistId, targetChannel)
                        .getOrElse {
                            showChannelSwitchFailure()
                            return@launch
                    }
                    withContext(Dispatchers.IO) {
                        repository.recordChannelPlayback(targetPlaylistId, targetChannel)
                    }
                    activePlaybackItem = targetChannel.toSavedItem(targetPlaylistId)
                    if (zapScope.order != TvChannelZapOrder.CAPTURED && zapScope.playlistOrder.isEmpty()) {
                        playbackZapQueue = emptyList()
                        playbackZapScope = playbackZapScopeFor(
                            targetPlaylistId,
                            defaultChannelZapScope(targetChannel),
                            targetChannel.radio,
                        )
                    }
                    playbackRequest = targetRequest
                    finishPlaybackZapNotice(noticeGeneration, targetChannel.name)
                }
                refreshPlaybackHistoryAfterZap()
            }
        }
    } else null

    fun openChannel(
        playlistId: String,
        channel: TvChannel,
        channelQueue: List<Pair<String, TvChannel>> = emptyList(),
        zapScope: TvChannelZapScope? = null,
        zapQueue: List<TvChannelZapEntry> = channelQueue.map { (owner, item) ->
            TvChannelZapEntry(owner, item.id)
        },
    ) {
        scope.launch {
            val tmdbEnabled = withContext(Dispatchers.IO) {
                credentialVault.loadTmdbApiKey()?.isNotBlank() == true
            }
            if (isLikelyTvM3uMovie(channel) && tmdbEnabled && m3uVodDetailsEnabled) {
                m3uVodTmdb = withContext(Dispatchers.IO) {
                    runCatching { repository.tmdbMovieDetails(channel.name) }.getOrNull()
                }
                m3uVodDownloadMessage = null
                m3uVodDownloadId = null
                m3uVodDetails = playlistId to channel
                return@launch
            }
            val targetRequest = resolveChannelPlaybackRequest(playlistId, channel).getOrElse {
                showChannelSwitchFailure()
                return@launch
            }
            withContext(Dispatchers.IO) { repository.recordChannelPlayback(playlistId, channel) }
            activePlaybackItem = channel.toSavedItem(playlistId)
            playbackChannelQueue = channelQueue
            val effectiveZapScope = zapScope ?: defaultChannelZapScope(channel)
            playbackZapQueue = if (effectiveZapScope.order == TvChannelZapOrder.CAPTURED) zapQueue else emptyList()
            playbackZapScope = playbackZapScopeFor(playlistId, effectiveZapScope, channel.radio)
            playbackRequest = targetRequest
            history = withContext(Dispatchers.IO) { repository.loadHistory() }
        }
    }

    fun tryVodFailover(positionMs: Long) {
        if (!vodAutoFailoverEnabled) return
        val saved = activePlaybackItem ?: return
        if (saved.itemType != com.iptvnator.googletv.playlist.TvSavedItemType.VOD) return
        val currentKey = "${saved.playlistId}:${saved.itemKey}"
        if (currentKey in attemptedVodFailoverKeys) return
        playbackNotice = "Buscando otra fuente Xtream…"
        scope.launch {
            val current = withContext(Dispatchers.IO) {
                repository.loadVodItem(saved.playlistId, saved.itemKey.toIntOrNull() ?: return@withContext null)
            } ?: run {
                playbackNotice = null
                return@launch
            }
            if (current.providerType != "xtream") {
                playbackNotice = null
                return@launch
            }
            val attempted = attemptedVodFailoverKeys + currentKey
            val candidates = withContext(Dispatchers.IO) {
                playlists.flatMap { playlist ->
                    repository.searchVod(playlist.id, current.name, limit = 100)
                        .filter { it.name.equals(current.name, ignoreCase = true) }
                        .map { TvVodFailoverCandidate(playlist.id, it) }
                }
            }
            val next = nextTvVodFailoverCandidate(candidates, currentKey, attempted)
            attemptedVodFailoverKeys = next?.let { attempted + it.key } ?: attempted
            if (next == null) {
                playbackNotice = null
                return@launch
            }
            withContext(Dispatchers.IO) { repository.recordVodPlayback(next.playlistId, next.item) }
            activePlaybackItem = next.item.toSavedItem(next.playlistId)
            playbackRequest = next.item.toPlaybackRequest().copy(startPositionMs = positionMs)
            history = withContext(Dispatchers.IO) { repository.loadHistory() }
            playbackNotice = "Cambiando a otra fuente…"
            delay(1_800)
            playbackNotice = null
        }
    }

    val activeLiveChannelKey = activePlaybackItem
        ?.takeIf { it.itemType == TvSavedItemType.CHANNEL }
        ?.let { "${it.playlistId}:${it.itemKey}" }
    LaunchedEffect(activeLiveChannelKey) {
        val pendingKey = pendingLiveFallbackKey
        if (pendingKey != null && pendingKey != activeLiveChannelKey) {
            pendingLiveFallbackJob?.cancel()
            pendingLiveFallbackJob = null
            pendingLiveFallbackKey = null
        }
    }

    fun tryXtreamLiveFallback(positionMs: Long) {
        if (xtreamStreamFormat != TvXtreamStreamFormat.AUTO) return
        val saved = activePlaybackItem ?: return
        if (saved.itemType != TvSavedItemType.CHANNEL) return
        val key = "${saved.playlistId}:${saved.itemKey}"
        if (key in attemptedLiveFallbackKeys || pendingLiveFallbackKey != null) return
        val currentRequest = playbackRequest ?: return
        val sourceUri = currentRequest.uri.toString()
        val fallbackNotice = "Probando formato Xtream alternativo…"
        val fallbackJob = scope.launch(start = CoroutineStart.LAZY) {
            try {
                val channel = withContext(Dispatchers.IO) {
                    repository.loadChannel(saved.playlistId, saved.itemKey)
                } ?: return@launch
                if (!xtreamLiveFallbackStillApplies(
                        expectedChannelKey = key,
                        expectedSourceUri = sourceUri,
                        activeChannelKey = activeLiveChannelKey,
                        activeRequestUri = playbackRequest?.uri?.toString(),
                    ) || channel.providerCommand != null || !channel.id.startsWith("xtream:")
                ) return@launch
                val alternate = alternateXtreamLiveFormat(sourceUri)
                val fallback = withContext(Dispatchers.IO) {
                    repository.resolveXtreamChannelPlayback(saved.playlistId, channel, alternate)
                } ?: return@launch
                if (!xtreamLiveFallbackStillApplies(
                        expectedChannelKey = key,
                        expectedSourceUri = sourceUri,
                        activeChannelKey = activeLiveChannelKey,
                        activeRequestUri = playbackRequest?.uri?.toString(),
                    )
                ) return@launch
                attemptedLiveFallbackKeys = attemptedLiveFallbackKeys + key
                playbackNotice = fallbackNotice
                playbackRequest = fallback.copy(startPositionMs = positionMs)
                delay(1_800)
                if (playbackNotice == fallbackNotice &&
                    activeLiveChannelKey == key &&
                    playbackRequest?.uri?.toString() == fallback.uri.toString()
                ) {
                    playbackNotice = null
                }
            } finally {
                if (pendingLiveFallbackKey == key) {
                    pendingLiveFallbackKey = null
                    pendingLiveFallbackJob = null
                }
            }
        }
        pendingLiveFallbackKey = key
        pendingLiveFallbackJob = fallbackJob
        fallbackJob.start()
    }

    fun openSavedChannel(item: TvSavedItem, visibleZapQueue: List<TvChannelZapEntry>? = null) {
        val playlist = playlists.firstOrNull { it.id == item.playlistId } ?: return
        fun openSavedChannel(channel: TvChannel) {
            val capturedQueue = visibleZapQueue?.takeIf { queue ->
                queue.any { it.playlistId == item.playlistId && it.channelId == item.itemKey }
            }
            val zapScope = if (capturedQueue != null) {
                TvChannelZapScope(order = TvChannelZapOrder.CAPTURED)
            } else {
                defaultChannelZapScope(channel)
            }
            openChannel(
                playlist.id,
                channel,
                zapScope = zapScope,
                zapQueue = capturedQueue.orEmpty(),
            )
        }
        val cached = playlist.channels.firstOrNull { it.id == item.itemKey }
        if (cached != null) {
            openSavedChannel(cached)
        } else {
            scope.launch {
                withContext(Dispatchers.IO) { repository.loadChannel(playlist.id, item.itemKey) }
                    ?.let(::openSavedChannel)
            }
        }
    }

    val activeEpisodeDetails = activeEpisodeTarget?.let { target ->
        seriesDetails?.takeIf { it.first == target.first && it.second.id == target.second }?.second
    }
    val activeEpisodeNeighbors = activeEpisodeTarget?.third?.let { episodeId ->
        activeEpisodeDetails?.episodes?.let { episodes -> tvSeriesEpisodeNeighbors(episodes, episodeId) }
    }

    fun changeActiveEpisode(delta: Int) {
        val target = activeEpisodeTarget ?: return
        val details = activeEpisodeDetails ?: return
        val neighbors = tvSeriesEpisodeNeighbors(details.episodes, target.third)
        val nextEpisode = when (delta) {
            -1 -> neighbors.previous
            1 -> neighbors.next
            else -> null
        } ?: return
        scope.launch {
            activeEpisodeTarget = Triple(target.first, target.second, nextEpisode.id)
            playbackRequest = withContext(Dispatchers.IO) {
                repository.resolveSeriesEpisodePlayback(target.first, nextEpisode)
            }.copy(startPositionMs = episodeProgress[nextEpisode.id]?.positionMs ?: 0L)
        }
    }

    fun selectActiveEpisode(episodeId: Int) {
        val target = activeEpisodeTarget ?: return
        val episode = activeEpisodeDetails?.episodes?.firstOrNull { it.id == episodeId } ?: return
        scope.launch {
            activeEpisodeTarget = Triple(target.first, target.second, episode.id)
            playbackRequest = withContext(Dispatchers.IO) {
                repository.resolveSeriesEpisodePlayback(target.first, episode)
            }.copy(startPositionMs = episodeProgress[episode.id]?.positionMs ?: 0L)
        }
    }

    @Composable
    fun PlaybackContent() {
    if (playbackRequest != null) {
        val channelOption = remember(epgByChannel, epgOffsetMinutes) {
            { entry: Pair<String, TvChannel> ->
                val channel = entry.second
                val now = System.currentTimeMillis() - epgOffsetMinutes * 60_000L
                val programme = selectCurrentOrNextEpgEntry(
                    epgByChannel["${entry.first}:${channel.id}"].orEmpty(),
                    now,
                )
                TvPlaybackChannelOption(
                    key = channel.id,
                    title = channel.name,
                    group = channel.group,
                    logoUrl = channel.logoUrl,
                    currentProgram = programme?.title,
                    catchupAvailable = programme?.let { tvCatchupAvailable(channel, it, now) } == true,
                )
            }
        }
        val playbackChannelOptions by produceState(
            initialValue = emptyList<TvPlaybackChannelOption>(),
            activePlaybackItem,
            playbackChannelQueue,
            playbackChannelSearchQueue,
            playbackChannelPickerSearch,
            channelOption,
        ) {
            // Channel pages can grow to tens of thousands of rows as users
            // browse/zap. Keep model conversion and filtering off Compose's
            // main dispatcher so a page append cannot hitch video controls.
            value = withContext(Dispatchers.Default) {
                activePlaybackItem
                    ?.takeIf { it.itemType == TvSavedItemType.CHANNEL }
                    ?.let { current ->
                        val entries = if (playbackChannelPickerSearch.isNotBlank()) {
                            playbackChannelSearchQueue
                        } else {
                            playbackChannelQueue
                        }
                        val currentChannel = entries.firstOrNull {
                            it.first == current.playlistId && it.second.id == current.itemKey
                        }?.second
                        entries.asSequence()
                            .filter { it.first == current.playlistId }
                            .filter { currentChannel == null || it.second.radio == currentChannel.radio }
                            .map(channelOption)
                            .toList()
                    }
                    .orEmpty()
            }
        }
        val playbackFavoriteKeys = remember(activePlaybackItem, favorites) {
            favorites.asSequence().filter {
                it.playlistId == activePlaybackItem?.playlistId && it.itemType == com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL
            }.map { "${it.playlistId}:${it.itemKey}" }.toSet()
        }
        val playbackRecentKeys = remember(activePlaybackItem, history) {
            history.asSequence().filter {
                it.playlistId == activePlaybackItem?.playlistId && it.itemType == com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL
            }.map { "${it.playlistId}:${it.itemKey}" }.toSet()
        }
        val playbackFavorites = remember(playbackPinnedChannelQueue, playbackFavoriteKeys, channelOption) {
            playbackPinnedChannelQueue.filter { "${it.first}:${it.second.id}" in playbackFavoriteKeys }.map(channelOption)
        }
        val playbackRecents = remember(playbackPinnedChannelQueue, playbackRecentKeys, channelOption) {
            playbackPinnedChannelQueue.filter { "${it.first}:${it.second.id}" in playbackRecentKeys }.map(channelOption)
        }
        val loadPlaybackChannelPage: (Boolean) -> Unit = { reset ->
            val current = activePlaybackItem
                ?.takeIf { it.itemType == com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL }
            if (current != null && !playbackChannelQueueLoading &&
                (reset || playbackChannelQueueHasMore) && playbackChannelPickerSearch.isBlank()
            ) {
                val startOffset = if (reset) 0 else playbackChannelQueueOffset
                val radioForNextPage = playbackChannelQueueRadioOnly
                val knownTotal = playbackChannelQueueTotalCount
                    ?.takeIf { !reset && playbackChannelQueuePlaylistId == current.playlistId }
                playbackChannelQueueLoading = true
                if (reset) {
                    playbackChannelPickerSearch = ""
                    playbackChannelSearchQueue = emptyList()
                    playbackChannelSearchOffset = 0
                    playbackChannelSearchHasMore = false
                }
                scope.launch {
                    try {
                        val loaded = withContext(Dispatchers.IO) {
                            val radio = if (reset) {
                                repository.loadChannel(current.playlistId, current.itemKey)?.radio ?: false
                            } else radioForNextPage
                            val count = knownTotal ?: repository.loadPlaylistCounts(current.playlistId).let { counts ->
                                if (radio) counts.radio else counts.channels - counts.radio
                            }
                            val start = startOffset
                            val channels = if (playbackChannelPickerGrouped) {
                                repository.loadGroupedChannelPage(current.playlistId, start, 200, radio)
                            } else {
                                repository.loadChannelPage(current.playlistId, start, 200, radio)
                            }
                            val pinnedChannels = if (reset) {
                                val savedIds = (favorites + history)
                                    .filter {
                                        it.playlistId == current.playlistId &&
                                            it.itemType == com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL
                                    }
                                    .map { it.itemKey }
                                    .distinct()
                                repository.loadChannelsByIds(current.playlistId, savedIds, radio)
                                    .map { current.playlistId to it }
                            } else emptyList()
                            Triple(
                                radio to count,
                                start,
                                channels.map { current.playlistId to it } to pinnedChannels,
                            )
                        }
                        val radioOnly = loaded.first.first
                        val total = loaded.first.second
                        val offset = loaded.second
                        val page = loaded.third.first
                        val pinned = loaded.third.second
                        playbackChannelQueueRadioOnly = radioOnly
                        playbackChannelQueuePlaylistId = current.playlistId
                        playbackChannelQueueTotalCount = total
                        playbackChannelQueueOffset = offset + page.size
                        playbackChannelQueueHasMore = playbackChannelQueueOffset < total
                        playbackPinnedChannelQueue = if (reset) pinned else playbackPinnedChannelQueue
                        playbackChannelQueue = if (reset) page else {
                            (playbackChannelQueue + page).distinctBy { (playlistId, channel) -> "$playlistId:${channel.id}" }
                        }
                    } finally {
                        playbackChannelQueueLoading = false
                    }
                }
            }
        }
        val searchPlaybackChannels: (String) -> Unit = { rawQuery ->
            playbackChannelPickerSearch = rawQuery
            playbackChannelSearchJob?.cancel()
            playbackChannelSearchQueue = emptyList()
            playbackChannelSearchOffset = 0
            playbackChannelSearchHasMore = false
            val query = rawQuery.trim()
            val current = activePlaybackItem?.takeIf { it.itemType == com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL }
            if (query.isNotBlank() && current != null) {
                playbackChannelSearchJob = scope.launch {
                    delay(250)
                    playbackChannelQueueLoading = true
                    try {
                        val (hasMore, pageResult) = withContext(Dispatchers.IO) {
                            val fetched = repository.searchChannels(
                                current.playlistId,
                                query,
                                limit = 201,
                                radioOnly = playbackChannelQueueRadioOnly,
                            )
                            val hasMore = fetched.size > 200
                            val channels = fetched.take(200)
                            val now = System.currentTimeMillis() - epgOffsetMinutes * 60_000L
                            val programIds = epgByChannel.asSequence()
                                .filter { (key, entries) ->
                                    key.startsWith("${current.playlistId}:") &&
                                        selectCurrentOrNextEpgEntry(entries, now)?.title?.contains(query, ignoreCase = true) == true
                                }
                                .map { it.key.substringAfter(':') }
                                .toList()
                            val programChannels = repository.loadChannelsByIds(
                                current.playlistId,
                                programIds,
                                playbackChannelQueueRadioOnly,
                            )
                            hasMore to (channels.size to (channels + programChannels).distinctBy { it.id })
                        }
                        if (playbackChannelPickerSearch.trim() == query) {
                            playbackChannelSearchHasMore = hasMore
                            playbackChannelSearchOffset = pageResult.first
                            playbackChannelSearchQueue = pageResult.second.map { current.playlistId to it }
                        }
                    } finally {
                        playbackChannelQueueLoading = false
                    }
                }
            }
        }
        val loadMorePlaybackChannelOptions = {
            if (playbackChannelPickerSearch.isNotBlank()) {
                val current = activePlaybackItem
                    ?.takeIf { it.itemType == com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL }
                if (current != null && !playbackChannelQueueLoading && playbackChannelSearchHasMore) {
                    val query = playbackChannelPickerSearch.trim()
                    val offset = playbackChannelSearchOffset
                    val radioOnly = playbackChannelQueueRadioOnly
                    playbackChannelQueueLoading = true
                    scope.launch {
                        try {
                            val page = withContext(Dispatchers.IO) {
                                repository.searchChannels(
                                    current.playlistId,
                                    query,
                                    limit = 201,
                                    radioOnly = radioOnly,
                                    offset = offset,
                                )
                            }
                            if (playbackChannelPickerSearch.trim() == query && playbackChannelSearchOffset == offset) {
                                playbackChannelSearchHasMore = page.size > 200
                                val visiblePage = page.take(200)
                                playbackChannelSearchOffset += visiblePage.size
                                playbackChannelSearchQueue = (playbackChannelSearchQueue + visiblePage.map { current.playlistId to it })
                                    .distinctBy { it.second.id }
                            }
                        } finally {
                            playbackChannelQueueLoading = false
                        }
                    }
                }
            } else {
                loadPlaybackChannelPage(false)
            }
        }
        val playbackGuide = activePlaybackItem
            ?.takeIf { it.itemType == com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL }
            ?.let { item ->
                val entries = epgByChannel["${item.playlistId}:${item.itemKey}"].orEmpty()
                if (entries.isEmpty()) null else {
                    val now = System.currentTimeMillis() - epgOffsetMinutes * 60_000L
                    TvPlaybackGuide(
                        channelName = item.title,
                        current = entries.firstOrNull { it.startMs <= now && it.endMs > now },
                        next = entries.firstOrNull { it.startMs > now },
                        providerClockOffsetMs = epgOffsetMinutes * 60_000L,
                        sourceName = playlists.firstOrNull { it.id == item.playlistId }?.name,
                    )
                }
            }
        androidx.compose.runtime.CompositionLocalProvider(LocalTvLightTheme provides false) {
        TvPlaybackScreen(
            request = playbackRequest!!,
            recordingManager = recordingManager,
            onChannelChange = playbackChannelChange,
            onChannelNumber = playbackChannelNumber,
            channelOptions = playbackChannelOptions,
            favoriteChannelOptions = playbackFavorites,
            recentChannelOptions = playbackRecents,
            onChannelOptionSelected = { selected ->
                val current = activePlaybackItem
                    ?.takeIf { it.itemType == com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL }
                if (current != null) {
                    scope.launch {
                        val target = withContext(Dispatchers.IO) {
                            repository.loadChannel(current.playlistId, selected.key)
                        } ?: return@launch
                        playbackRequest = withContext(Dispatchers.IO) {
                            repository.recordChannelPlayback(current.playlistId, target)
                            activePlaybackItem = target.toSavedItem(current.playlistId)
                            if (target.providerCommand != null) repository.resolveStalkerChannel(current.playlistId, target)
                            else repository.resolveXtreamChannelPlayback(current.playlistId, target, xtreamStreamFormat)
                                ?: target.toPlaybackRequest()
                        }
                        playbackZapQueue = emptyList()
                        playbackZapScope = playbackZapScopeFor(
                            current.playlistId,
                            radioOnly = target.radio,
                        )
                        history = withContext(Dispatchers.IO) { repository.loadHistory() }
                    }
                }
            },
            onChannelPickerOpened = {
                playbackChannelPickerGrouped = false
                loadPlaybackChannelPage(true)
            },
            onChannelPickerGroupingChanged = { grouped ->
                playbackChannelPickerGrouped = grouped
                playbackChannelQueue = emptyList()
                playbackChannelQueueOffset = 0
                playbackChannelQueueHasMore = true
                loadPlaybackChannelPage(true)
            },
            channelPickerLoading = playbackChannelQueueLoading,
            channelPickerHasMore = if (playbackChannelPickerSearch.isBlank()) {
                playbackChannelQueueHasMore
            } else playbackChannelSearchHasMore,
            onLoadMoreChannels = loadMorePlaybackChannelOptions,
            onChannelPickerSearch = searchPlaybackChannels,
            captionsEnabled = captionsEnabled,
            autoPlayEnabled = autoPlayEnabled,
            autoReconnectLiveEnabled = autoReconnectLiveEnabled,
            playbackSpeed = vodPlaybackSpeed,
            onPlaybackSpeedChange = { speed ->
                vodPlaybackSpeed = speed
                uiPreferences.edit().putFloat("vod_playback_speed", speed).apply()
            },
            guide = playbackGuide,
            onPreviousEpisode = if (activeEpisodeDetails != null) ({ changeActiveEpisode(-1) }) else null,
            onNextEpisode = if (activeEpisodeDetails != null) ({ changeActiveEpisode(1) }) else null,
            onPlaybackEnded = if (activeEpisodeDetails != null) ({ changeActiveEpisode(1) }) else null,
            canPreviousEpisode = activeEpisodeNeighbors?.previous != null,
            canNextEpisode = activeEpisodeNeighbors?.next != null,
            episodeOptions = activeEpisodeDetails?.episodes.orEmpty().map { episode ->
                TvPlaybackEpisodeOption(
                    key = episode.id,
                    season = episode.season,
                    number = episode.episode,
                    title = episode.title,
                    plot = episode.plot,
                    duration = episode.duration?.takeIf { it.isNotBlank() }?.let { "Duración: $it" },
                    coverUrl = episode.coverUrl,
                    completed = episodeProgress[episode.id]?.completed == true,
                    progressLabel = episodeProgress[episode.id]?.let { progress ->
                        when {
                            progress.completed -> "Visto"
                            progress.positionMs > 0L -> "Continuar desde ${formatEpisodePositionForPlayback(progress.positionMs)}"
                            else -> null
                        }
                    },
                )
            },
            currentEpisodeKey = activeEpisodeTarget?.third,
            onEpisodeOptionSelected = { option -> selectActiveEpisode(option.key) },
            onPlaybackError = { positionMs ->
                tryXtreamLiveFallback(positionMs)
                tryVodFailover(positionMs)
            },
            playbackNotice = playbackNotice,
            onEnterPictureInPicture = (context as? MainActivity)
                ?.takeIf { it.supportsTvPictureInPicture() }
                ?.let { activity -> { activity.enterTvPictureInPicture() } },
            onExit = {
                val target = activeEpisodeTarget
                playbackRequest = null
                playbackNotice = null
                activePlaybackItem = null
                playbackChannelQueue = emptyList()
                playbackZapQueue = emptyList()
                playbackZapScope = TvChannelZapScope()
                playbackChannelSearchQueue = emptyList()
                playbackPinnedChannelQueue = emptyList()
                playbackChannelQueueHasMore = false
                playbackChannelQueuePlaylistId = null
                playbackChannelQueueTotalCount = null
                playbackChannelPickerSearch = ""
                playbackChannelSearchJob?.cancel()
                activeEpisodeTarget = null
                attemptedVodFailoverKeys = emptySet()
                attemptedLiveFallbackKeys = emptySet()
                if (target != null) {
                    scope.launch(Dispatchers.IO) {
                        episodeProgress = repository.loadEpisodeProgress(target.first, target.second)
                    }
                }
                scope.launch(Dispatchers.IO) {
                    watchedItems = repository.loadWatched()
                }
            },
            onPositionChanged = { positionMs, durationMs ->
                activeEpisodeTarget?.let { target ->
                    scope.launch(Dispatchers.IO) {
                        repository.recordEpisodeProgress(target.first, target.second, target.third, positionMs, durationMs)
                    }
                } ?: activePlaybackItem?.let { item ->
                    scope.launch(Dispatchers.IO) { repository.recordPlaybackPosition(item, positionMs, durationMs) }
                }
            },
        )
        }
        return
    }
    }

    if (playbackRequest != null) {
        PlaybackContent()
        return
    }

    @Composable
    fun DetailsContent() {
    if (seriesDetails != null) {
        val (playlistId, details) = seriesDetails!!
        TvSeriesDetailScreen(
            details = details,
            tmdb = seriesTmdb,
            episodeProgress = episodeProgress,
            isFavorite = playlists.firstOrNull { it.id == playlistId }?.series
                ?.firstOrNull { it.id == details.id }
                ?.toSavedItem(playlistId)
                ?.let { item -> favorites.any { it.playlistId == item.playlistId && it.itemType == item.itemType && it.itemKey == item.itemKey } }
                ?: false,
            onToggleFavorite = playlists.firstOrNull { it.id == playlistId }?.series
                ?.firstOrNull { it.id == details.id }
                ?.toSavedItem(playlistId)
                ?.let { item ->
                    {
                        scope.launch {
                            withContext(Dispatchers.IO) {
                                store.setFavorite(item, favorites.none { it.playlistId == item.playlistId && it.itemType == item.itemType && it.itemKey == item.itemKey })
                            }
                            favorites = withContext(Dispatchers.IO) { repository.loadFavorites() }
                        }
                    }
                },
            onToggleEpisodesWatched = { episodes, watched ->
                scope.launch {
                    withContext(Dispatchers.IO) {
                        repository.setEpisodesWatched(
                            playlistId = playlistId,
                            seriesId = details.id,
                            episodeIds = episodes.map { it.id },
                            watched = watched,
                        )
                    }
                    episodeProgress = withContext(Dispatchers.IO) {
                        repository.loadEpisodeProgress(playlistId, details.id)
                    }
                }
            },
            downloadMessage = seriesDownloadMessage,
            onBack = { seriesDetails = null; seriesTmdb = null },
            onPlayEpisode = { episode ->
                scope.launch {
                    activePlaybackItem = null
                    activeEpisodeTarget = Triple(playlistId, details.id, episode.id)
                    playbackRequest = withContext(Dispatchers.IO) {
                        repository.resolveSeriesEpisodePlayback(playlistId, episode)
                    }.copy(
                        startPositionMs = episodeProgress[episode.id]?.positionMs ?: 0L,
                    )
                }
            },
            onDownloadEpisode = { episode ->
                scope.launch {
                    seriesDownloadMessage = runCatching {
                        val request = withContext(Dispatchers.IO) {
                            repository.resolveSeriesEpisodePlayback(playlistId, episode)
                        }
                        val id = withContext(Dispatchers.IO) {
                            downloadManager.enqueueUrl(
                                request.uri,
                                "${details.name} · ${episode.title}",
                                episode.extension,
                                userAgent = request.userAgent,
                                headers = request.headers,
                            )
                        }
                        downloadHistory.add(
                            TvDownloadRecord(
                                downloadId = id,
                                playlistId = playlistId,
                                vodId = episode.id,
                                title = "${details.name} · ${episode.title}",
                                createdAt = System.currentTimeMillis(),
                                contentType = "series-episode",
                                seriesId = details.id,
                                episodeId = episode.id,
                            ),
                        )
                        downloadRecords = downloadHistory.load()
                        "Episodio añadido a Descargas."
                    }.getOrElse { failure -> failure.message ?: "No se pudo descargar el episodio." }
                }
            },
            onDownloadEpisodes = { episodes ->
                scope.launch {
                    var added = 0
                    var skipped = 0
                    var failed = 0
                    val reservedEpisodeIds = mutableSetOf<Int>()
                    episodes.forEach { episode ->
                        if (episode.id in reservedEpisodeIds) {
                            skipped++
                            return@forEach
                        }
                        val existing = downloadRecords.firstOrNull { record ->
                            record.contentType == "series-episode" &&
                                record.playlistId == playlistId &&
                                record.seriesId == details.id &&
                                record.episodeId == episode.id
                        }
                        val existingSnapshot = existing?.let { downloadSnapshots[it.downloadId] }
                        val isActive = existingSnapshot?.status in setOf(
                            DownloadManager.STATUS_PENDING,
                            DownloadManager.STATUS_RUNNING,
                            DownloadManager.STATUS_PAUSED,
                        )
                        val isAvailable = existingSnapshot?.status == DownloadManager.STATUS_SUCCESSFUL &&
                            !existingSnapshot.localUri.isNullOrBlank()
                        if (isActive || isAvailable) {
                            skipped++
                            return@forEach
                        }
                        reservedEpisodeIds += episode.id
                        runCatching {
                            val request = withContext(Dispatchers.IO) {
                                repository.resolveSeriesEpisodePlayback(playlistId, episode)
                            }
                            val id = withContext(Dispatchers.IO) {
                                downloadManager.enqueueUrl(
                                    request.uri,
                                    "${details.name} · ${episode.title}",
                                    episode.extension,
                                    userAgent = request.userAgent,
                                    headers = request.headers,
                                )
                            }
                            downloadHistory.add(
                                TvDownloadRecord(
                                    downloadId = id,
                                    playlistId = playlistId,
                                    vodId = episode.id,
                                    title = "${details.name} · ${episode.title}",
                                    createdAt = System.currentTimeMillis(),
                                    contentType = "series-episode",
                                    seriesId = details.id,
                                    episodeId = episode.id,
                                ),
                            )
                            added++
                            downloadRecords = downloadHistory.load()
                        }.onFailure { failed++ }
                    }
                    seriesDownloadMessage = "Temporada: $added añadidos, $skipped omitidos, $failed fallidos."
                }
            },
        )
        return
    }

    if (vodDetails != null) {
        val (playlistId, item) = vodDetails!!
        TvVodDetailScreen(
            item = item,
            tmdb = vodTmdb,
            providerDetails = vodProviderDetails,
            isFavorite = favorites.any { it.playlistId == playlistId && it.itemType == com.iptvnator.googletv.playlist.TvSavedItemType.VOD && it.itemKey == item.id.toString() },
            isWatched = watchedItems.any { it.playlistId == playlistId && it.itemType == com.iptvnator.googletv.playlist.TvSavedItemType.VOD && it.itemKey == item.id.toString() },
            onToggleFavorite = {
                val savedItem = item.toSavedItem(playlistId)
                scope.launch {
                    withContext(Dispatchers.IO) {
                        store.setFavorite(savedItem, favorites.none { it.playlistId == savedItem.playlistId && it.itemType == savedItem.itemType && it.itemKey == savedItem.itemKey })
                    }
                    favorites = withContext(Dispatchers.IO) { repository.loadFavorites() }
                }
            },
            onToggleWatched = {
                val savedItem = item.toSavedItem(playlistId)
                scope.launch {
                    val watched = watchedItems.none { it.playlistId == savedItem.playlistId && it.itemType == savedItem.itemType && it.itemKey == savedItem.itemKey }
                    withContext(Dispatchers.IO) { repository.setWatched(savedItem, watched) }
                    watchedItems = withContext(Dispatchers.IO) { repository.loadWatched() }
                }
            },
            onTrailer = vodTmdb?.trailerKey?.let { key ->
                {
                    runCatching {
                        context.startActivity(
                            Intent(
                                Intent.ACTION_VIEW,
                                Uri.parse("https://www.youtube.com/watch?v=$key"),
                            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                        )
                    }
                }
            },
            onBack = { vodDetails = null; vodTmdb = null; vodProviderDetails = null; downloadId = null },
            downloadMessage = downloadMessage,
            onCancelDownload = downloadId?.let { id ->
                {
                    if (downloadManager.cancel(id)) {
                        downloadMessage = "Descarga cancelada."
                        downloadId = null
                    }
                }
            },
            onDownload = {
                scope.launch {
                    downloadMessage = runCatching {
                        val request = withContext(Dispatchers.IO) {
                            if (item.providerCommand != null) repository.resolveStalkerVod(playlistId, item)
                            else item.toPlaybackRequest()
                        }
                        val id = withContext(Dispatchers.IO) {
                            downloadManager.enqueueUrl(
                                request.uri,
                                item.name,
                                item.extension,
                                request.userAgent,
                                request.headers,
                            )
                        }
                        downloadId = id
                        downloadHistory.add(TvDownloadRecord(id, playlistId, item.id, item.name, System.currentTimeMillis()))
                        downloadRecords = downloadHistory.load()
                        "Descarga iniciada (ID $id). Se notificará al terminar."
                    }.getOrElse { it.message ?: "No se pudo iniciar la descarga." }
                }
            },
            onPlay = {
                scope.launch {
                    withContext(Dispatchers.IO) { repository.recordVodPlayback(playlistId, item) }
                    attemptedVodFailoverKeys = emptySet()
                    activePlaybackItem = item.toSavedItem(playlistId)
                    playbackRequest = withContext(Dispatchers.IO) {
                        if (item.providerCommand != null) repository.resolveStalkerVod(playlistId, item)
                        else item.toPlaybackRequest()
                    }
                    vodDetails = null
                    vodTmdb = null
                    vodProviderDetails = null
                    downloadId = null
                    history = withContext(Dispatchers.IO) { repository.loadHistory() }
                }
            },
        )
        return
    }

    if (m3uVodDetails != null) {
        val (playlistId, channel) = m3uVodDetails!!
        val item = channel.toM3uVodItem()
        val savedItem = channel.toSavedItem(playlistId)
        TvVodDetailScreen(
            item = item,
            tmdb = m3uVodTmdb,
            providerDetails = null,
            isFavorite = favorites.any { it.playlistId == savedItem.playlistId && it.itemType == savedItem.itemType && it.itemKey == savedItem.itemKey },
            isWatched = watchedItems.any { it.playlistId == savedItem.playlistId && it.itemType == savedItem.itemType && it.itemKey == savedItem.itemKey },
            onToggleFavorite = {
                scope.launch {
                    withContext(Dispatchers.IO) {
                        store.setFavorite(savedItem, favorites.none { it.playlistId == savedItem.playlistId && it.itemType == savedItem.itemType && it.itemKey == savedItem.itemKey })
                    }
                    favorites = withContext(Dispatchers.IO) { repository.loadFavorites() }
                }
            },
            onToggleWatched = {
                scope.launch {
                    val watched = watchedItems.none { it.playlistId == savedItem.playlistId && it.itemType == savedItem.itemType && it.itemKey == savedItem.itemKey }
                    withContext(Dispatchers.IO) { repository.setWatched(savedItem, watched) }
                    watchedItems = withContext(Dispatchers.IO) { repository.loadWatched() }
                }
            },
            onTrailer = m3uVodTmdb?.trailerKey?.let { key ->
                {
                    runCatching {
                        context.startActivity(
                            Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/watch?v=$key"))
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                        )
                    }
                }
            },
            onBack = {
                m3uVodDetails = null
                m3uVodTmdb = null
                m3uVodDownloadMessage = null
                m3uVodDownloadId = null
            },
            downloadMessage = m3uVodDownloadMessage,
            onCancelDownload = m3uVodDownloadId?.let { id ->
                {
                    if (downloadManager.cancel(id)) {
                        m3uVodDownloadMessage = "Descarga cancelada."
                        m3uVodDownloadId = null
                    }
                }
            },
            onDownload = {
                m3uVodDownloadMessage = runCatching {
                    val id = downloadManager.enqueueUrl(
                        channel.url,
                        channel.name,
                        channel.m3uVodExtension(),
                        userAgent = channel.userAgent,
                        headers = channel.headers,
                    )
                    m3uVodDownloadId = id
                    downloadHistory.add(
                        TvDownloadRecord(
                            downloadId = id,
                            playlistId = playlistId,
                            vodId = channel.id.hashCode(),
                            title = channel.name,
                            createdAt = System.currentTimeMillis(),
                            contentType = "m3u",
                            itemKey = channel.id,
                        ),
                    )
                    downloadRecords = downloadHistory.load()
                    "Descarga iniciada (ID $id). Se notificará al terminar."
                }.getOrElse { it.message ?: "No se pudo iniciar la descarga." }
            },
            onPlay = {
                scope.launch {
                    withContext(Dispatchers.IO) { repository.recordChannelPlayback(playlistId, channel) }
                    activePlaybackItem = savedItem
                    playbackRequest = channel.toPlaybackRequest()
                    m3uVodDetails = null
                    m3uVodTmdb = null
                    m3uVodDownloadId = null
                    history = withContext(Dispatchers.IO) { repository.loadHistory() }
                }
            },
        )
        return
    }
    }

    if (seriesDetails != null || vodDetails != null || m3uVodDetails != null) {
        DetailsContent()
        return
    }

    if (showImport) {
        Dialog(
            onDismissRequest = { if (!importInProgress) showImport = false },
            properties = DialogProperties(
                usePlatformDefaultWidth = false,
                dismissOnBackPress = !importInProgress,
                dismissOnClickOutside = false,
            ),
        ) {
            val dialogWindow = (LocalView.current.parent as? DialogWindowProvider)?.window
            val imeVisible = WindowInsets.isImeVisible
            val dialogMaxHeight = (LocalConfiguration.current.screenHeightDp *
                if (imeVisible) 0.54f else 0.76f).dp
            DisposableEffect(dialogWindow) {
                // This is a separate platform dialog window. ADJUST_RESIZE
                // can collapse it to the IME's height on Google TV, clipping
                // the lower credential fields before Compose can scroll them.
                dialogWindow?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING)
                dialogWindow?.setLayout(
                    WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.MATCH_PARENT,
                )
                onDispose { }
            }
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.68f)),
                // The TV emulator keyboard is a separate window. When it is
                // visible, move the modal to the top and give its form a
                // genuinely smaller viewport.
                contentAlignment = if (imeVisible) Alignment.TopCenter else Alignment.Center,
            ) {
                Surface(
                    modifier = Modifier
                        .fillMaxWidth(0.58f)
                        // The Google TV keyboard is rendered in a separate
                        // window on some emulator images. A merely resized
                        // dialog can still extend underneath it, so make the
                        // modal viewport genuinely shorter while typing.
                        // The form itself remains scrollable and keeps the
                        // focused field reachable through the IME spacer.
                        // Keep a real editing viewport. 0.42f left the active
                        // Xtream field clipped by the Surface itself on the
                        // Google TV IME image, even though the keyboard was
                        // technically below it.
                        // Without the IME the six-card chooser plus the two
                        // compact fields and action row need a little more
                        // vertical room on a 1080p TV. Keep the former viewport
                        // as a maximum, but let short forms wrap their content
                        // instead of leaving an empty panel below the actions.
                        .heightIn(max = dialogMaxHeight)
                        // The Google TV IME is a separate window on some images
                        // and its top edge is not reflected in the dialog's
                        // measured bounds. Move the modal clear of that edge
                        // while editing so the active field never sits behind
                        // the keyboard.
                        .then(if (imeVisible) Modifier.offset(y = 0.dp) else Modifier)
                        .clip(RoundedCornerShape(22.dp))
                        .tvHairline(tvTone(TvTone.SurfaceTop), 22f),
                    colors = androidx.tv.material3.SurfaceDefaults.colors(containerColor = tvTone(TvTone.Surface)),
                ) {
                    Box {
                    Box(
                        Modifier
                            .graphicsLayer { alpha = if (importInProgress) 0f else 1f }
                            .then(if (importInProgress) Modifier.clearAndSetSemantics { } else Modifier),
                    ) {
                    TvImportScreen(
            initialValues = importInitialValues,
            initialSourceType = importSourceType,
            maxDialogHeight = dialogMaxHeight,
            errorMessage = operationError,
                        importInProgress = importInProgress,
                        importStatus = xtreamImportStatus,
                        imeVisible = imeVisible,
            onBack = {
                if (importInProgress) {
                    // Only Xtream currently exposes a cooperative cancellation
                    // job. M3U/Stalker imports must remain visible until their
                    // repository operation finishes; closing this surface
                    // would leave a live import with no TV feedback.
                    if (xtreamImportJob != null) {
                        xtreamImportJob?.cancel()
                        importInProgress = false
                        xtreamImportStatus = null
                        operationError = null
                        showImport = false
                        importInitialValues = null
                    }
                } else {
                    showImport = false
                    importInitialValues = null
                }
            },
            onPickLocalM3u = { name ->
                localFileReplacement = null
                localImportName = name.ifBlank { "Local playlist" }
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                }
                val hasDocumentProvider = context.packageManager.queryIntentActivities(intent, 0).any { info ->
                    isUsableTvDocumentPickerPackage(info.activityInfo.packageName)
                }
                if (hasDocumentProvider) {
                    localM3uPicker.launch(arrayOf("audio/x-mpegurl", "application/x-mpegurl", "text/plain", "*/*"))
                } else {
                    showLocalFilePicker = true
                }
            },
            onImportM3u = { source ->
                if (importInProgress) return@TvImportScreen
                importInProgress = true
                importingSourceType = TvSourceType.M3U; importingName = source.name; importingLocal = false; xtreamImportProgress = null; xtreamImportStatus = null
                scope.launch {
                    runCatching {
                        withContext(Dispatchers.IO) {
                            repository.importRemote(
                                source.copy(name = source.name.trim().ifBlank { "Remote playlist" }),
                                playlistIdOverride = importInitialValues?.playlistId,
                                onPhase = { phase -> scope.launch { if (importInProgress) xtreamImportStatus = phase } },
                            )
                        }
                    }.onSuccess { imported ->
                        importInProgress = false
                        xtreamImportStatus = null
                        importInitialValues?.playlistId?.takeIf { it != imported.id }?.let(repository::deletePlaylist)
                        importInitialValues = null
                        operationError = null
                        val loaded = withContext(Dispatchers.IO) { repository.loadStored() }
                        playlists = loaded
                        favorites = withContext(Dispatchers.IO) { repository.loadFavorites() }
                        history = withContext(Dispatchers.IO) { repository.loadHistory() }
                        epgByChannel = withContext(Dispatchers.IO) { repository.loadEpgSnapshot(loaded) }
                        selectedPlaylistId = imported.id
                        showImport = false
                        selectedSection = TvSection.Home
                    }.onFailure {
                        importInProgress = false
                        xtreamImportStatus = null
                        operationError = it.message ?: "No se pudo importar la fuente"
                    }
                }
            },
            onImportM3uText = { content, playlistName ->
                if (importInProgress) return@TvImportScreen
                importInProgress = true
                importingSourceType = TvSourceType.M3U; importingName = playlistName; importingLocal = true; xtreamImportProgress = null
                scope.launch {
                    runCatching {
                        withContext(Dispatchers.IO) {
                            repository.importM3uContent(
                                content,
                                playlistName,
                                playlistIdOverride = importInitialValues?.playlistId,
                            )
                        }
                    }.onSuccess { imported ->
                        importInProgress = false
                        importInitialValues?.playlistId?.takeIf { it != imported.id }?.let(repository::deletePlaylist)
                        importInitialValues = null
                        operationError = null
                        val loaded = withContext(Dispatchers.IO) { repository.loadStored() }
                        playlists = loaded
                        favorites = withContext(Dispatchers.IO) { repository.loadFavorites() }
                        history = withContext(Dispatchers.IO) { repository.loadHistory() }
                        epgByChannel = withContext(Dispatchers.IO) { repository.loadEpgSnapshot(loaded) }
                        selectedPlaylistId = imported.id
                        showImport = false
                        selectedSection = TvSection.Home
                    }.onFailure {
                        importInProgress = false
                        operationError = it.message ?: "No se pudo importar el texto M3U"
                    }
                }
            },
            onImportAutoDetect = { text, playlistName ->
                if (importInProgress) return@TvImportScreen
                importInProgress = true
                importingSourceType = TvSourceType.M3U; importingName = playlistName; importingLocal = false; xtreamImportProgress = null
                scope.launch {
                    runCatching {
                        withContext(Dispatchers.IO) {
                            repository.importAutoDetect(
                                text,
                                playlistName,
                                playlistIdOverride = importInitialValues?.playlistId,
                            )
                        }
                    }.onSuccess { imported ->
                        importInProgress = false
                        importInitialValues?.playlistId?.takeIf { it != imported.id }?.let(repository::deletePlaylist)
                        importInitialValues = null
                        operationError = null
                        val loaded = withContext(Dispatchers.IO) { repository.loadStored() }
                        playlists = loaded
                        favorites = withContext(Dispatchers.IO) { repository.loadFavorites() }
                        history = withContext(Dispatchers.IO) { repository.loadHistory() }
                        epgByChannel = withContext(Dispatchers.IO) { repository.loadEpgSnapshot(loaded) }
                        selectedPlaylistId = imported.id
                        showImport = false
                        selectedSection = TvSection.Home
                    }.onFailure {
                        importInProgress = false
                        operationError = it.message ?: "No se pudo detectar la fuente"
                    }
                }
            },
            onImportXtream = { credentials, name ->
                if (importInProgress) return@TvImportScreen
                importInProgress = true
                importingSourceType = TvSourceType.XTREAM
                importingName = name.trim().ifBlank { credentials.serverUrl }
                importingLocal = false
                xtreamImportProgress = null
                xtreamImportStatus = "Autenticando con Xtream…"
                xtreamImportJob = scope.launch {
                    runCatching {
                        // Xtream portals can legitimately expose hundreds of
                        // thousands of VOD/series rows. The HTTP layer already
                        // has bounded connect/read retries; cancellation is
                        // cooperative and the SQLite transaction rolls back.
                        withContext(Dispatchers.IO) {
                            repository.importXtream(
                                credentials,
                                name.trim().ifBlank { "Xtream playlist" },
                                epgUrl = importInitialValues?.epgUrl?.trim()?.takeIf { it.isNotBlank() },
                                epgUrls = importInitialValues?.epgUrls.orEmpty(),
                                onProgress = { progress ->
                                scope.launch {
                                    xtreamImportStatus = progress.toTvImportStatus()
                                    xtreamImportProgress = progress
                                }
                                },
                                isCancelled = { !isActive },
                                playlistIdOverride = importInitialValues?.playlistId,
                            )
                        }
                    }.onSuccess { imported ->
                        importInProgress = false
                        xtreamImportJob = null
                        xtreamImportStatus = null
                        importInitialValues?.playlistId?.takeIf { it != imported.id }?.let(repository::deletePlaylist)
                        importInitialValues = null
                        operationError = null
                        val loaded = withContext(Dispatchers.IO) { repository.loadStored() }
                        playlists = loaded
                        favorites = withContext(Dispatchers.IO) { repository.loadFavorites() }
                        history = withContext(Dispatchers.IO) { repository.loadHistory() }
                        epgByChannel = withContext(Dispatchers.IO) { repository.loadEpgSnapshot(loaded) }
                        selectedPlaylistId = imported.id
                        showImport = false
                        selectedSection = TvSection.Home
                    }.onFailure {
                        importInProgress = false
                        xtreamImportJob = null
                        xtreamImportStatus = null
                        operationError = if (it is CancellationException) null else friendlyXtreamError(it)
                    }
                }
            },
            onImportStalker = { credentials, name ->
                if (importInProgress) return@TvImportScreen
                importInProgress = true
                importingSourceType = TvSourceType.STALKER; importingName = name.trim().ifBlank { credentials.portalUrl }; importingLocal = false; xtreamImportProgress = null
                scope.launch {
                    runCatching {
                        withContext(Dispatchers.IO) {
                            repository.importStalker(
                                credentials,
                                name.trim().ifBlank { "Portal Stalker" },
                                playlistIdOverride = importInitialValues?.playlistId,
                            )
                        }
                    }.onSuccess { imported ->
                        importInProgress = false
                        importInitialValues?.playlistId?.takeIf { it != imported.id }?.let(repository::deletePlaylist)
                        importInitialValues = null
                        operationError = null
                        val loaded = withContext(Dispatchers.IO) { repository.loadStored() }
                        playlists = loaded
                        favorites = withContext(Dispatchers.IO) { repository.loadFavorites() }
                        history = withContext(Dispatchers.IO) { repository.loadHistory() }
                        epgByChannel = withContext(Dispatchers.IO) { repository.loadEpgSnapshot(loaded) }
                        selectedPlaylistId = imported.id
                        showImport = false
                        selectedSection = TvSection.Home
                    }.onFailure {
                        importInProgress = false
                        operationError = it.message ?: "No se pudo conectar con Stalker"
                    }
                }
            },
        )
                    }
                    if (importInProgress) {
                        TvImportProgressPanel(
                            sourceType = importingSourceType,
                            sourceName = importingName,
                            local = importingLocal,
                            statusText = xtreamImportStatus ?: when (importingSourceType) {
                                TvSourceType.XTREAM -> "Conectando con el panel Xtream…"
                                TvSourceType.STALKER -> "Conectando con el portal Stalker…"
                                TvSourceType.M3U -> "Importando playlist…"
                            },
                            progress = xtreamImportProgress,
                            canCancel = xtreamImportJob != null,
                            onCancel = {
                                xtreamImportJob?.cancel()
                                importInProgress = false
                                xtreamImportStatus = null
                                xtreamImportProgress = null
                                operationError = null
                            },
                            modifier = Modifier.matchParentSize().background(tvTone(TvTone.Surface)),
                        )
                    }
                    }
                }
            }
        }
    }
        if (showLocalFilePicker) {
            TvLocalM3uPicker(
                onDismiss = {
                    showLocalFilePicker = false
                    localFileReplacement = null
                },
                onUseUrlOrText = {
                    showLocalFilePicker = false
                    localFileReplacement = null
                    importSourceType = TvSourceType.M3U
                    importInitialValues = null
                    operationError = null
                    showImport = true
                },
                onSelect = { file ->
                    showLocalFilePicker = false
                    val replacement = localFileReplacement
                    localImportName = replacement?.name ?: file.name.substringBeforeLast('.').ifBlank { "Local playlist" }
                    importInProgress = true
                    importingSourceType = TvSourceType.M3U; importingName = localImportName; importingLocal = true; xtreamImportProgress = null
                    if (replacement != null) {
                        sourceBusyId = replacement.id
                        sourceMessage = "Importando archivo M3U…"
                        selectedSection = TvSection.Sources
                    }
                    scope.launch {
                        runCatching {
                            withContext(Dispatchers.IO) {
                                if (file.uri.scheme == "file") {
                                    FileInputStream(file.uri.path!!).bufferedReader().use { reader ->
                                        repository.importM3uReader(
                                            reader,
                                            localImportName,
                                            identitySeed = file.uri.toString(),
                                            sourceUrl = file.uri.toString(),
                                            epgUrl = replacement?.epgUrl ?: importInitialValues?.epgUrl,
                                            userAgent = replacement?.sourceUserAgent ?: importInitialValues?.userAgent,
                                            sourceReferrer = replacement?.sourceReferrer ?: importInitialValues?.sourceReferrer,
                                            sourceOrigin = replacement?.sourceOrigin ?: importInitialValues?.sourceOrigin,
                                            playlistIdOverride = replacement?.id ?: importInitialValues?.playlistId,
                                        )
                                    }
                                } else {
                                    context.contentResolver.openInputStream(file.uri)?.bufferedReader()?.use { reader ->
                                        repository.importM3uReader(
                                            reader,
                                            localImportName,
                                            identitySeed = file.uri.toString(),
                                            sourceUrl = file.uri.toString(),
                                            epgUrl = replacement?.epgUrl ?: importInitialValues?.epgUrl,
                                            userAgent = replacement?.sourceUserAgent ?: importInitialValues?.userAgent,
                                            sourceReferrer = replacement?.sourceReferrer ?: importInitialValues?.sourceReferrer,
                                            sourceOrigin = replacement?.sourceOrigin ?: importInitialValues?.sourceOrigin,
                                            playlistIdOverride = replacement?.id ?: importInitialValues?.playlistId,
                                        )
                                    } ?: error("No se pudo leer el archivo M3U")
                                }
                            }
                        }.onSuccess { imported ->
                            importInProgress = false
                            sourceBusyId = null
                            localFileReplacement = null
                            importInitialValues?.playlistId?.takeIf { it != imported.id }?.let(repository::deletePlaylist)
                            importInitialValues = null
                            operationError = null
                            playlists = withContext(Dispatchers.IO) { repository.loadStored() }
                            favorites = withContext(Dispatchers.IO) { repository.loadFavorites() }
                            history = withContext(Dispatchers.IO) { repository.loadHistory() }
                            epgByChannel = withContext(Dispatchers.IO) { repository.loadEpgSnapshot(playlists) }
                            selectedPlaylistId = imported.id
                            if (replacement != null) sourceMessage = "Archivo M3U actualizado: ${imported.name}"
                            showImport = false
                            selectedSection = TvSection.Home
                        }.onFailure {
                            importInProgress = false
                            sourceBusyId = null
                            localFileReplacement = null
                            Log.e("TvImport", "Local M3U import failed", it)
                            operationError = it.message ?: "No se pudo importar el archivo M3U"
                            if (replacement != null) sourceMessage = operationError
                        }
                    }
                },
            )
        }

    // The toolbar playlist is the workspace context for content sections.
    // Global search, sources, favourites and history deliberately keep their
    // cross-playlist scope, matching IPTVnator's original behaviour.
    val contextualPlaylist = playlists.firstOrNull { it.id == selectedPlaylistId }
    val contextualPlaylists = contextualPlaylist?.let(::listOf).orEmpty()
    LaunchedEffect(
        initialSourcesLoading,
        contextualPlaylist?.id,
        contextualPlaylist?.catalogCounts?.channels,
        contextualPlaylist?.catalogCounts?.radio,
        contextualPlaylist?.channels?.isNotEmpty(),
        contextualPlaylist?.channels?.any { it.radio },
        contextualPlaylist?.vod?.isNotEmpty(),
        contextualPlaylist?.series?.isNotEmpty(),
    ) {
        // A configured startup section such as Live is valid as soon as its
        // persisted playlist is hydrated. Evaluating it against the initial
        // empty in-memory list would incorrectly redirect startup to Home.
        if (initialSourcesLoading) return@LaunchedEffect
        val selectedStillAvailable = when (selectedSection) {
            TvSection.Live -> contextualPlaylist?.let(::playlistHasTvChannels) == true
            TvSection.Guide -> contextualPlaylist?.let(::playlistHasTvChannels) == true ||
                contextualPlaylist?.epgUrl?.isNotBlank() == true
            TvSection.Radio -> contextualPlaylist?.channels?.any { it.radio } == true
            TvSection.Vod, TvSection.RecentlyAdded -> contextualPlaylist?.vod?.isNotEmpty() == true ||
                contextualPlaylist?.series?.isNotEmpty() == true
            TvSection.Series -> contextualPlaylist?.series?.isNotEmpty() == true
            else -> true
        }
        if (!selectedStillAvailable) selectedSection = if (showDashboard) TvSection.Home else TvSection.Sources
    }
        ?.let { listOf(it) }
        ?: playlists
    LaunchedEffect(selectedSection, playlists.map { it.id to it.channels.size }) {
        if (selectedSection != TvSection.Live && selectedSection != TvSection.Radio) return@LaunchedEffect
        // Entering Live/Radio swaps in a database-backed lazy list. The first
        // group may not be attached during the sidebar's route callback, so
        // retry from the screen owner until that focus target is ready.
        repeat(12) {
            delay(150)
            val focused = runCatching { liveContentFocusRequester.requestFocus() }.getOrDefault(false)
            if (focused) return@LaunchedEffect
        }
    }
    val activeDownloadCount = downloadRecords.count { record ->
        downloadSnapshots[record.downloadId]?.status in setOf(
            DownloadManager.STATUS_PENDING,
            DownloadManager.STATUS_RUNNING,
            DownloadManager.STATUS_PAUSED,
        )
    }

    LaunchedEffect(sourceNoticeMessage) {
        if (sourceNoticeMessage != null) {
            delay(7_000)
            sourceNoticeMessage = null
        }
    }

    Surface(
        modifier = Modifier
            .fillMaxSize()
            .then(if (showImport) Modifier.blur(8.dp) else Modifier),
        colors = androidx.tv.material3.SurfaceDefaults.colors(containerColor = TvBackground),
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxSize().tvBackdrop(LocalTvLightTheme.current),
        ) {
            TvSidebar(
                section = selectedSection,
                showDashboard = showDashboard,
                selectedPlaylist = contextualPlaylist,
                activeDownloadCount = activeDownloadCount,
                hasDownloads = downloadRecords.isNotEmpty(),
                hasRecordings = recordingHistoryItems.isNotEmpty() || activeRecording != null,
                rightFocusRequester = if (selectedSection == TvSection.Live || selectedSection == TvSection.Radio) {
                    liveContentFocusRequester
                } else if (selectedSection == TvSection.Sources) {
                    sourcesContentFocusRequester
                } else if (selectedSection == TvSection.Settings) {
                    settingsContentFocusRequester
                } else if (selectedSection == TvSection.Downloads) {
                    downloadsContentFocusRequester
                } else if (selectedSection == TvSection.Recent) {
                    recentContentFocusRequester
                } else {
                    mainContentFocusRequester
                },
                firstFocusRequester = sidebarFocusRequester,
                activeFocusRequester = sidebarActiveFocusRequester,
                onSectionSelected = { nextSection ->
                    // A sidebar navigation is a route change. Do not leave
                    // the toolbar's playlist popover layered over the target
                    // screen (especially Search and Settings).
                    showPlaylistMenu = false
                    selectedSection = nextSection
                    // Selecting a section with the center key should leave
                    // the sidebar and land on the first content control. This
                    // keeps a section change usable without an extra RIGHT.
                    // Settings owns a two-column focus graph and deliberately
                    // starts on its first category instead of the top bar.
                    if (nextSection != TvSection.Settings &&
                        nextSection != TvSection.Live &&
                        nextSection != TvSection.Radio
                    ) {
                        scope.launch {
                            delay(100)
                            // Catalogue screens attach their first target only
                            // after the SQLite window loads; retry briefly so
                            // OK on a section always lands in its content.
                            suspend fun focusContent(target: FocusRequester) {
                                repeat(30) {
                                    if (runCatching { target.requestFocus() }.getOrDefault(false)) return
                                    delay(80)
                                }
                            }
                            if (nextSection == TvSection.Sources) {
                                focusContent(sourcesContentFocusRequester)
                            } else if (nextSection == TvSection.Vod || nextSection == TvSection.Series) {
                                focusContent(catalogContentFocusRequester)
                            } else if (nextSection == TvSection.Guide) {
                                focusContent(guideContentFocusRequester)
                            } else if (nextSection == TvSection.Favorites) {
                                // The first result or, for an empty collection,
                                // its Home action owns the section-entry focus.
                                delay(220)
                                repeat(12) {
                                    if (runCatching { favoritesContentFocusRequester.requestFocus() }.getOrDefault(false)) {
                                        return@launch
                                    }
                                    delay(80)
                                }
                            } else if (nextSection == TvSection.Recent) {
                                focusContent(recentContentFocusRequester)
                            } else if (nextSection == TvSection.Downloads) {
                                focusContent(downloadsContentFocusRequester)
                            } else {
                                focusContent(mainContentFocusRequester)
                            }
                        }
                    } else if (nextSection == TvSection.Settings) {
                        scope.launch {
                            delay(320)
                            settingsContentFocusRequester.requestFocus()
                        }
                    } else if (nextSection == TvSection.Live || nextSection == TvSection.Radio) {
                        scope.launch {
                            // TvSidebar aligns itself with the selected item
                            // after 200ms; enter the live catalogue after
                            // that hand-off so the request is not overwritten.
                            delay(320)
                            liveContentFocusRequester.requestFocus()
                        }
                    }
                },
            )
            androidx.compose.runtime.CompositionLocalProvider(LocalTvNavRailFocus provides sidebarActiveFocusRequester) {
            val contentFocusManager = LocalFocusManager.current
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    // D-pad LEFT that finds no target inside the content
                    // (the leftmost control of any screen) always returns to
                    // the active section of the navigation rail.
                    .onKeyEvent { event ->
                        if (event.type == KeyEventType.KeyDown &&
                            event.nativeKeyEvent.keyCode == KeyEvent.KEYCODE_DPAD_LEFT
                        ) {
                            if (!contentFocusManager.moveFocus(androidx.compose.ui.focus.FocusDirection.Left)) {
                                runCatching { sidebarActiveFocusRequester.requestFocus() }
                            }
                            true
                        } else false
                    },
            ) {
                Box {
                    TvTopBar(
                        playlists = playlists,
                        selectedPlaylistId = selectedPlaylistId,
                        selectedSection = selectedSection,
                        sectionSearchQuery = when (selectedSection) {
                            TvSection.Recent -> recentSearchQuery
                            TvSection.Favorites -> favoritesSearchQuery
                            else -> null
                        },
                        sectionFilterFocusRequester = sectionFilterFocusRequester,
                        initialFocusRequester = mainContentFocusRequester,
                        leftFocusRequester = sidebarFocusRequester,
                        // Open only: OK fires on key down and on key up, so a
                        // toggle here would close the menu in the same press.
                        onPlaylistMenu = { showPlaylistMenu = true },
                        onSearchSubmit = { query ->
                            submittedSearchQuery = query.trim()
                            if (submittedSearchQuery.length >= 2) {
                                showPlaylistMenu = false
                                selectedSection = TvSection.Search
                            }
                        },
                        onDownloads = {
                            showPlaylistMenu = false
                            selectedSection = TvSection.Downloads
                        },
                        onAddPlaylist = {
                            importInitialValues = null
                            importSourceType = TvSourceType.M3U
                            showImport = true
                        },
                    )
                    if (showPlaylistMenu) androidx.compose.ui.window.Popup(
                        alignment = Alignment.TopStart,
                        offset = androidx.compose.ui.unit.IntOffset(0, 0),
                        onDismissRequest = { showPlaylistMenu = false },
                        properties = androidx.compose.ui.window.PopupProperties(focusable = true),
                    ) {
                        TvPlaylistMenu(
                            playlists = playlists,
                            selectedPlaylistId = selectedPlaylistId,
                            onSelect = { playlistId ->
                                selectedPlaylistId = playlistId
                                showPlaylistMenu = false
                            },
                            onDismiss = { showPlaylistMenu = false },
                            onAdd = {
                                showPlaylistMenu = false
                                importInitialValues = null
                                importSourceType = TvSourceType.M3U
                                showImport = true
                            },
                            onRename = { playlist ->
                                showPlaylistMenu = false
                                renameDraft = playlist.name
                                playlistPendingRename = playlist
                            },
                            onEdit = ::openEditPlaylist,
                            onDelete = { playlist ->
                                showPlaylistMenu = false
                                playlistPendingDelete = playlist
                            },
                            onInfo = {
                                showPlaylistMenu = false
                                (playlists.firstOrNull { it.id == selectedPlaylistId } ?: playlists.firstOrNull())?.let(::openPlaylistInfo)
                            },
                            onAccountInfo = { playlist ->
                                showPlaylistMenu = false
                                openAccountInfo(playlist)
                            },
                        )
                    }
                }
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(start = 20.dp, end = 28.dp, top = 8.dp, bottom = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(24.dp),
                ) {
            fun refreshSource(playlist: StoredPlaylist) {
                sourceBusyId = playlist.id
                sourceMessage = "Actualizando ${playlist.name}…"
                sourceNoticeMessage = sourceMessage
                scope.launch {
                    val result = runCatching {
                        withContext(Dispatchers.IO) {
                            repository.refreshPlaylist(playlist) { progress ->
                                if (progress.current == 0 || progress.current % 500 == 0 || progress.phase == "complete") {
                                    val status = progress.toTvImportStatus()
                                    scope.launch {
                                        if (sourceBusyId == playlist.id) {
                                            sourceMessage = status
                                            sourceNoticeMessage = status
                                        }
                                    }
                                }
                            }
                        }
                    }
                    result.onSuccess {
                        playlists = withContext(Dispatchers.IO) { repository.loadStored() }
                        epgByChannel = withContext(Dispatchers.IO) { repository.loadEpgSnapshot(playlists) }
                        epgSourceStates = withContext(Dispatchers.IO) {
                            playlists.associate { it.id to repository.loadEpgSourceStates(it.id) }
                        }
                        sourceMessage = "Fuente actualizada: ${playlist.name}"
                        sourceNoticeMessage = sourceMessage
                    }.onFailure { failure ->
                        sourceMessage = failure.message ?: "No se pudo actualizar la fuente."
                        sourceNoticeMessage = sourceMessage
                    }
                    sourceBusyId = null
                }
            }
            when (selectedSection) {
                TvSection.Home -> HomeContent(
                    playlists = playlists,
                    selectedPlaylistId = selectedPlaylistId,
                    liveChannelOverrides = dashboardLiveChannels,
                    history = history,
                    favorites = favorites,
                    showContinueWatching = showContinueWatching,
                    showRecentSources = showRecentSources,
                    showLiveFavorites = showLiveFavorites,
                    showRecentlyWatchedLive = showRecentlyWatchedLive,
                    showFavoriteMoviesAndSeries = showFavoriteMoviesAndSeries,
                    favoriteVod = dashboardFavoriteVod,
                    favoriteSeries = dashboardFavoriteSeries,
                    tmdbTrending = tmdbTrendingItems,
                    tmdbRecommendations = tmdbRecommendationItems,
                    showXtreamRecentlyAdded = showXtreamRecentlyAdded,
                    recentlyAddedVod = dashboardRecentlyAddedVod,
                    recentlyAddedSeries = dashboardRecentlyAddedSeries,
                    onSeeAll = { selectedSection = it },
                    onRenamePlaylist = {
                        renameDraft = it.name
                        playlistPendingRename = it
                    },
                    onEditPlaylist = ::openEditPlaylist,
                    onDeletePlaylist = { playlistPendingDelete = it },
                    onInfoPlaylist = ::openPlaylistInfo,
                    onAccountInfo = ::openAccountInfo,
                    onRefreshPlaylist = ::refreshSource,
                    onHistoryClick = { item ->
                        val playlist = playlists.firstOrNull { it.id == item.playlistId }
                        when (item.itemType) {
                            com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL -> openSavedChannel(item)
                            com.iptvnator.googletv.playlist.TvSavedItemType.VOD -> playlist?.let {
                                scope.launch {
                                    val vod = withContext(Dispatchers.IO) { repository.loadVodItem(item.playlistId, item.itemKey.toIntOrNull() ?: return@withContext null) }
                                        ?: return@launch
                            activePlaybackItem = item
                                    attemptedVodFailoverKeys = emptySet()
                                    playbackRequest = withContext(Dispatchers.IO) {
                                        if (vod.providerCommand != null) repository.resolveStalkerVod(playlist.id, vod).copy(startPositionMs = item.resumePositionMs)
                                        else vod.toPlaybackRequest().copy(startPositionMs = item.resumePositionMs)
                                    }
                                }
                            }
                            com.iptvnator.googletv.playlist.TvSavedItemType.SERIES -> playlist?.let {
                                scope.launch {
                                    runCatching { withContext(Dispatchers.IO) { repository.getSeriesDetails(item.playlistId, item.itemKey.toIntOrNull() ?: error("Identificador de serie no válido")) } }
                                        .onSuccess { details -> seriesDetails = playlist.id to details }
                                }
                            }
                        }
                    },
                    onToggleFavorite = { item, selected ->
                        scope.launch {
                            withContext(Dispatchers.IO) { store.setFavorite(item, selected) }
                            favorites = withContext(Dispatchers.IO) { repository.loadFavorites() }
                        }
                    },
                    onToggleWatched = { item, watched ->
                        scope.launch {
                            withContext(Dispatchers.IO) { repository.setWatched(item, watched) }
                            history = withContext(Dispatchers.IO) { repository.loadHistory() }
                            watchedItems = withContext(Dispatchers.IO) { repository.loadWatched() }
                        }
                    },
                    onRemoveFromHistory = { item ->
                        scope.launch {
                            withContext(Dispatchers.IO) { repository.removeFromHistory(item) }
                            history = withContext(Dispatchers.IO) { repository.loadHistory() }
                            watchedItems = withContext(Dispatchers.IO) { repository.loadWatched() }
                        }
                    },
                    onAddPlaylist = { sourceType ->
                        importInitialValues = null
                        importSourceType = sourceType ?: TvSourceType.M3U
                        showImport = true
                    },
                    onOpenPlaylist = { playlist ->
                        selectedPlaylistId = playlist.id
                        selectedSection = TvSection.Home
                    },
                    onPlay = { playlistId, channel ->
                        openChannel(playlistId, channel)
                    },
                    onPlayVod = { playlistId, item ->
                        scope.launch {
                            vodTmdb = withContext(Dispatchers.IO) { runCatching { repository.tmdbMovieDetails(item.name) }.getOrNull() }
                            vodProviderDetails = withContext(Dispatchers.IO) { repository.xtreamVodDetails(playlistId, item) }
                            downloadId = null
                            vodDetails = playlistId to item
                        }
                    },
                    onOpenSeries = { playlistId, series ->
                        scope.launch {
                            withContext(Dispatchers.IO) { repository.recordSeriesOpened(playlistId, series) }
                            history = withContext(Dispatchers.IO) { repository.loadHistory() }
                            runCatching {
                                withContext(Dispatchers.IO) {
                                    repository.getSeriesDetails(playlistId, series.id)
                                }
                            }.onSuccess { details -> seriesDetails = playlistId to details }
                        }
                    },
                )
                TvSection.Sources -> SourcesContent(
                    playlists = playlists,
                    customOrder = customSourceOrder,
                    busyPlaylistId = sourceBusyId,
                    statusMessage = sourceMessage,
                    firstFocusRequester = sourcesContentFocusRequester,
                    onMoveCustom = { playlistId, delta ->
                        val current = (customSourceOrder + playlists.map { it.id })
                            .distinct()
                            .filter { id -> playlists.any { it.id == id } }
                            .toMutableList()
                        val index = current.indexOf(playlistId)
                        val target = index + delta
                        if (index >= 0 && target in current.indices) {
                            current[index] = current[target].also { current[target] = current[index] }
                            customSourceOrder = current
                            uiPreferences.edit().putString("source_order", current.joinToString(",")).apply()
                        }
                    },
                    onOpen = { playlist ->
                        selectedPlaylistId = playlist.id
                        selectedSection = TvSection.Home
                    },
                    onAdd = {
                        importInitialValues = null
                        importSourceType = TvSourceType.M3U
                        showImport = true
                    },
                    onRefresh = ::refreshSource,
                    onDelete = { playlistPendingDelete = it },
                    onEdit = ::openEditPlaylist,
                    onRename = {
                        renameDraft = it.name
                        playlistPendingRename = it
                    },
                )
                TvSection.Recent -> RecentContent(
                    history = history,
                    favorites = favorites,
                    playlistNames = playlists.associate { it.id to it.name },
                    selectedPlaylistId = selectedPlaylistId,
                    searchQuery = recentSearchQuery,
                    sectionFilterFocusRequester = sectionFilterFocusRequester,
                    initialFocusRequester = recentContentFocusRequester,
                    onToggleFavorite = { item, selected ->
                        scope.launch {
                            withContext(Dispatchers.IO) { store.setFavorite(item, selected) }
                            favorites = withContext(Dispatchers.IO) { repository.loadFavorites() }
                        }
                    },
                    onRemoveFromHistory = { item ->
                        scope.launch {
                            withContext(Dispatchers.IO) { repository.removeFromHistory(item) }
                            history = withContext(Dispatchers.IO) { repository.loadHistory() }
                            watchedItems = withContext(Dispatchers.IO) { repository.loadWatched() }
                        }
                    },
                    onClearHistory = { playlistId ->
                        scope.launch {
                            withContext(Dispatchers.IO) { repository.clearHistory(playlistId) }
                            history = withContext(Dispatchers.IO) { repository.loadHistory() }
                        }
                    },
                    onToggleWatched = { item, watched ->
                        scope.launch {
                            withContext(Dispatchers.IO) { repository.setWatched(item, watched) }
                            history = withContext(Dispatchers.IO) { repository.loadHistory() }
                            watchedItems = withContext(Dispatchers.IO) { repository.loadWatched() }
                        }
                    },
                    onItemClick = { item, zapQueue ->
                        val playlist = playlists.firstOrNull { it.id == item.playlistId }
                        when (item.itemType) {
                            com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL -> openSavedChannel(item, zapQueue)
                            com.iptvnator.googletv.playlist.TvSavedItemType.VOD -> playlist?.let {
                                scope.launch {
                                    val vod = withContext(Dispatchers.IO) { repository.loadVodItem(item.playlistId, item.itemKey.toIntOrNull() ?: return@withContext null) }
                                        ?: return@launch
                                    vodTmdb = withContext(Dispatchers.IO) { runCatching { repository.tmdbMovieDetails(vod.name) }.getOrNull() }
                                    vodProviderDetails = withContext(Dispatchers.IO) { repository.xtreamVodDetails(playlist.id, vod) }
                                    vodDetails = playlist.id to vod
                                }
                            }
                            com.iptvnator.googletv.playlist.TvSavedItemType.SERIES -> playlist?.let {
                                scope.launch {
                                    runCatching { withContext(Dispatchers.IO) { repository.getSeriesDetails(item.playlistId, item.itemKey.toIntOrNull() ?: error("Identificador de serie no válido")) } }
                                        .onSuccess { details -> seriesDetails = playlist.id to details }
                                }
                            }
                        }
                    },
                )
                TvSection.Live -> LiveContent(
                    topBarFocusRequester = mainContentFocusRequester,
                    playlists = contextualPlaylists,
                    repository = repository,
                    sortPreferences = uiPreferences,
                    radioOnly = false,
                    epgOffsetMinutes = epgOffsetMinutes,
                    stripCountryPrefixes = stripCountryPrefixes,
                    initialFocusRequester = liveContentFocusRequester,
                    epgByChannel = epgByChannel,
                    xtreamEpgPreviews = xtreamEpgPreviews,
                    preferUploadedEpgOverXtream = preferUploadedEpgOverXtream,
                    onXtreamEpgPreviewLoaded = { key, preview ->
                        xtreamEpgPreviews = (xtreamEpgPreviews - key + (key to preview))
                            .entries.toList().takeLast(500).associate { it.key to it.value }
                    },
                    favorites = favorites,
                    history = history,
                    onToggleFavorite = { item, selected ->
                        scope.launch {
                            withContext(Dispatchers.IO) { store.setFavorite(item, selected) }
                            favorites = withContext(Dispatchers.IO) { repository.loadFavorites() }
                        }
                    },
                    onEditEpg = ::openEpgMapping,
                    onSaveHiddenGroups = { playlistId, hidden ->
                        scope.launch {
                            withContext(Dispatchers.IO) { repository.saveHiddenGroupTitles(playlistId, hidden) }
                            playlists = withContext(Dispatchers.IO) { repository.loadStored() }
                        }
                    },
                    onPlay = { playlistId, channel, queue, zapScope ->
                        openChannel(playlistId, channel, queue, zapScope)
                    },
                )
                TvSection.Radio -> LiveContent(
                    topBarFocusRequester = mainContentFocusRequester,
                    playlists = contextualPlaylists,
                    repository = repository,
                    sortPreferences = uiPreferences,
                    radioOnly = true,
                    epgOffsetMinutes = epgOffsetMinutes,
                    stripCountryPrefixes = stripCountryPrefixes,
                    initialFocusRequester = liveContentFocusRequester,
                    epgByChannel = emptyMap(),
                    favorites = favorites,
                    history = history,
                    onToggleFavorite = { item, selected ->
                        scope.launch {
                            withContext(Dispatchers.IO) { store.setFavorite(item, selected) }
                            favorites = withContext(Dispatchers.IO) { repository.loadFavorites() }
                        }
                    },
                    onEditEpg = ::openEpgMapping,
                    onSaveHiddenGroups = { playlistId, hidden ->
                        scope.launch {
                            withContext(Dispatchers.IO) { repository.saveHiddenGroupTitles(playlistId, hidden) }
                            playlists = withContext(Dispatchers.IO) { repository.loadStored() }
                        }
                    },
                    onPlay = { playlistId, channel, queue, zapScope ->
                        openChannel(playlistId, channel, queue, zapScope)
                    },
                )
                TvSection.Vod -> VodContent(
                    playlists = contextualPlaylists,
                    repository = repository,
                    initialFocusRequester = catalogContentFocusRequester,
                    onOpen = { playlistId, item ->
                        scope.launch {
                            vodTmdb = withContext(Dispatchers.IO) { runCatching { repository.tmdbMovieDetails(item.name) }.getOrNull() }
                            vodProviderDetails = withContext(Dispatchers.IO) { repository.xtreamVodDetails(playlistId, item) }
                            downloadId = null
                            vodDetails = playlistId to item
                        }
                    },
                )
                TvSection.Series -> SeriesContent(
                    playlists = contextualPlaylists,
                    repository = repository,
                    initialFocusRequester = catalogContentFocusRequester,
                    onOpen = { playlistId, series ->
                        scope.launch {
                            withContext(Dispatchers.IO) { repository.recordSeriesOpened(playlistId, series) }
                            history = withContext(Dispatchers.IO) { repository.loadHistory() }
                            runCatching { withContext(Dispatchers.IO) { repository.getSeriesDetails(playlistId, series.id) } }
                                .onSuccess { details -> seriesDetails = playlistId to details }
                        }
                    },
                )
                TvSection.RecentlyAdded -> RecentlyAddedContent(
                    playlists = contextualPlaylists,
                    repository = repository,
                    initialFocusRequester = recentlyAddedContentFocusRequester,
                    onOpenVod = { playlistId, item ->
                        scope.launch {
                            vodTmdb = withContext(Dispatchers.IO) { runCatching { repository.tmdbMovieDetails(item.name) }.getOrNull() }
                            vodProviderDetails = withContext(Dispatchers.IO) { repository.xtreamVodDetails(playlistId, item) }
                            downloadId = null
                            vodDetails = playlistId to item
                        }
                    },
                    onOpenSeries = { playlistId, series ->
                        scope.launch {
                            withContext(Dispatchers.IO) { repository.recordSeriesOpened(playlistId, series) }
                            history = withContext(Dispatchers.IO) { repository.loadHistory() }
                            runCatching { withContext(Dispatchers.IO) { repository.getSeriesDetails(playlistId, series.id) } }
                                .onSuccess { details -> seriesDetails = playlistId to details }
                        }
                    },
                )
                TvSection.Search -> SearchContent(
                    playlists = playlists,
                    repository = repository,
                    initialQuery = submittedSearchQuery,
                    stripCountryPrefixes = stripCountryPrefixes,
                    onPlay = { playlistId, channel, zapQueue ->
                        openChannel(
                            playlistId,
                            channel,
                            zapScope = TvChannelZapScope(order = TvChannelZapOrder.CAPTURED),
                            zapQueue = zapQueue,
                        )
                    },
                    onPlayVod = { playlistId, item ->
                        scope.launch {
                            vodTmdb = withContext(Dispatchers.IO) { runCatching { repository.tmdbMovieDetails(item.name) }.getOrNull() }
                            vodProviderDetails = withContext(Dispatchers.IO) { repository.xtreamVodDetails(playlistId, item) }
                            downloadId = null
                            vodDetails = playlistId to item
                        }
                    },
                    onOpenSeries = { playlistId, series ->
                        scope.launch {
                            withContext(Dispatchers.IO) { repository.recordSeriesOpened(playlistId, series) }
                            history = withContext(Dispatchers.IO) { repository.loadHistory() }
                            runCatching {
                                withContext(Dispatchers.IO) { repository.getSeriesDetails(playlistId, series.id) }
                            }.onSuccess { details -> seriesDetails = playlistId to details }
                        }
                    },
                )
                TvSection.Guide -> EpgGuideContent(
                    playlists = contextualPlaylists,
                    repository = repository,
                    initialFocusRequester = guideContentFocusRequester,
                    stripCountryPrefixes = stripCountryPrefixes,
                    epgByChannel = epgByChannel,
                    xtreamEpgPreviews = xtreamEpgPreviews,
                    preferUploadedEpgOverXtream = preferUploadedEpgOverXtream,
                    favorites = favorites,
                    history = history,
                    viewMode = epgViewMode,
                    epgOffsetMinutes = epgOffsetMinutes,
                    statusMessage = epgMessage,
                    refreshing = epgRefreshing,
                    onRefresh = {
                        scope.launch {
                            epgRefreshing = true
                            epgMessage = null
                            runCatching { withContext(Dispatchers.IO) { repository.refreshEpg(contextualPlaylists) } }
                                .onSuccess { count ->
                                    epgByChannel = withContext(Dispatchers.IO) { repository.loadEpgSnapshot(contextualPlaylists) }
                                    epgMessage = if (count == 0) {
                                        "No hay programas XMLTV actualizados; las vistas previas Xtream se cargan al recorrer TV en directo."
                                    } else {
                                        "EPG actualizado: $count programas."
                                    }
                                }
                                .onFailure { epgMessage = it.message ?: "No se pudo actualizar el EPG." }
                            epgRefreshing = false
                        }
                    },
                    onXtreamEpgPreviewLoaded = { key, preview ->
                        xtreamEpgPreviews = (xtreamEpgPreviews - key + (key to preview))
                            .entries.toList().takeLast(500).associate { it.key to it.value }
                    },
                    onPlay = { playlistId, channel, program ->
                        scope.launch {
                            val isCatchup = tvCatchupAvailable(
                                channel,
                                program,
                                epgProviderNowMs(System.currentTimeMillis(), epgOffsetMinutes),
                            )
                            val request = withContext(Dispatchers.IO) {
                                resolveTvEpgPlaybackRequest(
                                    isCatchup = isCatchup,
                                    resolveCatchup = {
                                        repository.resolveCatchup(playlistId, channel, program)?.let { uri ->
                                            TvPlaybackRequest(
                                                uri = uri,
                                                title = "${channel.name} · ${program.title}",
                                                userAgent = channel.userAgent,
                                                headers = channel.headers,
                                                isLive = false,
                                            )
                                        }
                                    },
                                    resolveLive = {
                                        if (channel.providerCommand != null) {
                                            repository.resolveStalkerChannel(playlistId, channel)
                                        } else {
                                            repository.resolveXtreamChannelPlayback(playlistId, channel, xtreamStreamFormat)
                                                ?: channel.toPlaybackRequest()
                                        }
                                    },
                                )
                            }.getOrElse { failure ->
                                epgMessage = failure.message ?: "No se pudo iniciar la reproducción del programa."
                                return@launch
                            }
                            withContext(Dispatchers.IO) {
                                repository.recordChannelPlayback(playlistId, channel)
                            }
                            activePlaybackItem = channel.toSavedItem(playlistId)
                            playbackRequest = request
                            epgMessage = null
                            history = withContext(Dispatchers.IO) { repository.loadHistory() }
                        }
                    },
                    onDownloadCatchup = { playlistId, channel, program ->
                        if (!isEpgProgrammePast(
                                programEndMs = program.endMs,
                                systemNowMs = System.currentTimeMillis(),
                                providerClockOffsetMinutes = epgOffsetMinutes,
                            )
                        ) {
                            epgMessage = "Solo se pueden descargar programas ya emitidos."
                        } else {
                            scope.launch {
                                epgMessage = runCatching {
                                    val url = withContext(Dispatchers.IO) {
                                        repository.resolveCatchup(playlistId, channel, program)
                                    } ?: error("Este canal no ofrece archivo catch-up para ese programa.")
                                    val newId = withContext(Dispatchers.IO) {
                                        downloadManager.enqueueUrl(
                                            url = url,
                                            title = "${channel.name} · ${program.title}",
                                            extensionHint = "ts",
                                            userAgent = channel.userAgent,
                                            headers = channel.headers,
                                        )
                                    }
                                    downloadHistory.add(
                                        TvDownloadRecord(
                                            downloadId = newId,
                                            playlistId = playlistId,
                                            vodId = -1,
                                            title = "${channel.name} · ${program.title}",
                                            createdAt = System.currentTimeMillis(),
                                            contentType = "catchup",
                                            itemKey = channel.id,
                                            catchupStartMs = program.startMs,
                                            catchupEndMs = program.endMs,
                                        ),
                                    )
                                    downloadRecords = downloadHistory.load()
                                    "Descarga catch-up iniciada."
                                }.getOrElse { it.message ?: "No se pudo descargar el programa." }
                            }
                        }
                    },
                    onCopyCatchup = { playlistId, channel, program ->
                        scope.launch {
                            epgMessage = runCatching {
                                val url = withContext(Dispatchers.IO) {
                                    repository.resolveCatchup(playlistId, channel, program)
                                } ?: error("Este canal no ofrece una URL catch-up para ese programa.")
                                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                clipboard.setPrimaryClip(ClipData.newPlainText("Catch-up", url))
                                "URL catch-up copiada al portapapeles."
                            }.getOrElse { it.message ?: "No se pudo copiar la URL catch-up." }
                        }
                    },
                )
                TvSection.Favorites -> FavoritesContent(
                    favorites = favorites,
                    playlistNames = playlists.associate { it.id to it.name },
                    selectedPlaylistId = selectedPlaylistId,
                    searchQuery = favoritesSearchQuery,
                    sectionFilterFocusRequester = sectionFilterFocusRequester,
                    initialFocusRequester = favoritesContentFocusRequester,
                    onGoHome = { selectedSection = TvSection.Home },
                    onRemoveFavorite = { item ->
                        scope.launch {
                            withContext(Dispatchers.IO) { store.setFavorite(item, false) }
                            favorites = withContext(Dispatchers.IO) { repository.loadFavorites() }
                        }
                    },
                    onClearFavorites = { type, playlistId ->
                        scope.launch {
                            withContext(Dispatchers.IO) { store.clearFavorites(type, playlistId) }
                            favorites = withContext(Dispatchers.IO) { repository.loadFavorites() }
                        }
                    },
                    onReorderFavorites = { orderedItems, playlistId ->
                        scope.launch {
                            withContext(Dispatchers.IO) { store.updateFavoriteOrder(orderedItems, playlistId) }
                            favorites = withContext(Dispatchers.IO) { repository.loadFavorites() }
                        }
                    },
                    onEditEpg = { item ->
                        scope.launch {
                            val channel = withContext(Dispatchers.IO) {
                                repository.loadChannel(item.playlistId, item.itemKey)
                            }
                            if (channel != null) openEpgMapping(item.playlistId, channel)
                            else sourceMessage = "El canal ya no está disponible en esta playlist."
                        }
                    },
                    onFavoriteClick = { item, zapQueue ->
                        val playlist = playlists.firstOrNull { it.id == item.playlistId }
                        when (item.itemType) {
                            com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL -> openSavedChannel(item, zapQueue)
                            com.iptvnator.googletv.playlist.TvSavedItemType.VOD -> playlist?.let {
                                scope.launch {
                                    val vod = withContext(Dispatchers.IO) { repository.loadVodItem(item.playlistId, item.itemKey.toIntOrNull() ?: return@withContext null) }
                                        ?: return@launch
                                    vodTmdb = withContext(Dispatchers.IO) { runCatching { repository.tmdbMovieDetails(vod.name) }.getOrNull() }
                                    vodProviderDetails = withContext(Dispatchers.IO) { repository.xtreamVodDetails(playlist.id, vod) }
                                    downloadId = null
                                    vodDetails = playlist.id to vod
                                }
                            }
                            com.iptvnator.googletv.playlist.TvSavedItemType.SERIES -> playlist?.let {
                                scope.launch {
                                    runCatching { withContext(Dispatchers.IO) { repository.getSeriesDetails(item.playlistId, item.itemKey.toIntOrNull() ?: error("Identificador de serie no válido")) } }
                                        .onSuccess { details -> seriesDetails = playlist.id to details }
                                }
                            }
                        }
                    },
                )
                TvSection.Settings -> SettingsContent(
                    credentialVault = credentialVault,
                    themeMode = themeMode,
                    onThemeModeChange = onThemeModeChange,
                    epgSourceStates = epgSourceStates,
                    playlists = playlists,
                    busyPlaylistId = sourceBusyId,
                    statusMessage = sourceMessage,
                    onRefresh = ::refreshSource,
                    onRequestDelete = { playlistPendingDelete = it },
                    startupSection = startupSection,
                    onStartupSectionChange = { next ->
                        startupSection = next
                        uiPreferences.edit().putString("startup_section", next.name).apply()
                    },
                    showDashboard = showDashboard,
                    onShowDashboardChange = { enabled ->
                        showDashboard = enabled
                        if (!enabled) {
                            if (startupSection == TvSection.Home) {
                                startupSection = TvSection.Sources
                                uiPreferences.edit().putString("startup_section", TvSection.Sources.name).apply()
                            }
                            if (selectedSection == TvSection.Home) selectedSection = TvSection.Sources
                        }
                        uiPreferences.edit().putBoolean("show_dashboard", enabled).apply()
                    },
                    autoRefreshEnabled = { playlist ->
                        uiPreferences.getBoolean("auto_refresh_${playlist.id}", false)
                    },
                    onAutoRefreshChange = { playlist, enabled ->
                        uiPreferences.edit().putBoolean("auto_refresh_${playlist.id}", enabled).apply()
                    },
                    captionsEnabled = captionsEnabled,
                    onCaptionsEnabledChange = { enabled ->
                        captionsEnabled = enabled
                        uiPreferences.edit().putBoolean("captions_enabled", enabled).apply()
                    },
                    stripCountryPrefixes = stripCountryPrefixes,
                    onStripCountryPrefixesChange = { enabled ->
                        stripCountryPrefixes = enabled
                        uiPreferences.edit().putBoolean("strip_country_prefix", enabled).apply()
                    },
                    posterSize = posterSize,
                    onPosterSizeChange = { size ->
                        posterSize = size
                        uiPreferences.edit().putString("poster_size", size).apply()
                    },
                    showPosterTitles = showPosterTitles,
                    onShowPosterTitlesChange = { enabled ->
                        showPosterTitles = enabled
                        uiPreferences.edit().putBoolean("show_poster_titles", enabled).apply()
                    },
                    autoPlayEnabled = autoPlayEnabled,
                    onAutoPlayEnabledChange = { enabled ->
                        autoPlayEnabled = enabled
                        uiPreferences.edit().putBoolean("auto_play_enabled", enabled).apply()
                    },
                    autoReconnectLiveEnabled = autoReconnectLiveEnabled,
                    onAutoReconnectLiveEnabledChange = { enabled ->
                        autoReconnectLiveEnabled = enabled
                        uiPreferences.edit().putBoolean("auto_reconnect_live_enabled", enabled).apply()
                    },
                    vodPlaybackSpeed = vodPlaybackSpeed,
                    onVodPlaybackSpeedChange = { speed ->
                        vodPlaybackSpeed = speed
                        uiPreferences.edit().putFloat("vod_playback_speed", speed).apply()
                    },
                    vodAutoFailoverEnabled = vodAutoFailoverEnabled,
                    onVodAutoFailoverEnabledChange = { enabled ->
                        vodAutoFailoverEnabled = enabled
                        uiPreferences.edit().putBoolean("vod_auto_failover_enabled", enabled).apply()
                    },
                    xtreamStreamFormat = xtreamStreamFormat,
                    onXtreamStreamFormatChange = { format ->
                        xtreamStreamFormat = format
                        uiPreferences.edit().putString("xtream_stream_format", format.name).apply()
                    },
                    showContinueWatching = showContinueWatching,
                    onShowContinueWatchingChange = { enabled ->
                        showContinueWatching = enabled
                        uiPreferences.edit().putBoolean("show_continue_watching", enabled).apply()
                    },
                    showRecentSources = showRecentSources,
                    onShowRecentSourcesChange = { enabled ->
                        showRecentSources = enabled
                        uiPreferences.edit().putBoolean("show_recent_sources", enabled).apply()
                    },
                    showLiveFavorites = showLiveFavorites,
                    onShowLiveFavoritesChange = { enabled ->
                        showLiveFavorites = enabled
                        uiPreferences.edit().putBoolean("show_live_favorites", enabled).apply()
                    },
                    showRecentlyWatchedLive = showRecentlyWatchedLive,
                    onShowRecentlyWatchedLiveChange = { enabled ->
                        showRecentlyWatchedLive = enabled
                        uiPreferences.edit().putBoolean("show_recently_watched_live", enabled).apply()
                    },
                    showFavoriteMoviesAndSeries = showFavoriteMoviesAndSeries,
                    onShowFavoriteMoviesAndSeriesChange = { enabled ->
                        showFavoriteMoviesAndSeries = enabled
                        uiPreferences.edit().putBoolean("show_favorite_movies_series", enabled).apply()
                    },
                    showTmdbTrending = showTmdbTrending,
                    onShowTmdbTrendingChange = { enabled ->
                        showTmdbTrending = enabled
                        uiPreferences.edit().putBoolean("show_tmdb_trending", enabled).apply()
                    },
                    showTmdbRecommendations = showTmdbRecommendations,
                    onShowTmdbRecommendationsChange = { enabled ->
                        showTmdbRecommendations = enabled
                        uiPreferences.edit().putBoolean("show_tmdb_recommendations", enabled).apply()
                    },
                    showXtreamRecentlyAdded = showXtreamRecentlyAdded,
                    onShowXtreamRecentlyAddedChange = { enabled ->
                        showXtreamRecentlyAdded = enabled
                        uiPreferences.edit().putBoolean("show_xtream_recently_added", enabled).apply()
                    },
                    epgViewMode = epgViewMode,
                    onEpgViewModeChange = { mode ->
                        epgViewMode = mode
                        uiPreferences.edit().putString("epg_view_mode", mode).apply()
                    },
                    epgOffsetMinutes = epgOffsetMinutes,
                    onEpgOffsetMinutesChange = { offset ->
                        epgOffsetMinutes = offset.coerceIn(-720, 720)
                        uiPreferences.edit().putInt("epg_offset_minutes", epgOffsetMinutes).apply()
                    },
                    preferUploadedEpgOverXtream = preferUploadedEpgOverXtream,
                    onPreferUploadedEpgOverXtreamChange = { enabled ->
                        preferUploadedEpgOverXtream = enabled
                        uiPreferences.edit().putBoolean("prefer_uploaded_epg_over_xtream", enabled).apply()
                    },
                    m3uVodDetailsEnabled = m3uVodDetailsEnabled,
                    onM3uVodDetailsEnabledChange = { enabled ->
                        m3uVodDetailsEnabled = enabled
                        uiPreferences.edit().putBoolean("m3u_vod_details_enabled", enabled).apply()
                    },
                    tmdbCacheEntries = tmdbCacheEntries,
                    tmdbCacheMessage = tmdbCacheMessage,
                    onClearTmdbCache = {
                        tmdbCache.clear()
                        tmdbCacheEntries = 0
                        tmdbCacheMessage = "Caché TMDB vaciada."
                    },
                    onUpdateEpgUrls = { playlist, urls ->
                        scope.launch {
                            runCatching {
                                withContext(Dispatchers.IO) {
                                    repository.updateEpgUrls(playlist.id, urls)
                                    val keptDisabled = epgSourceStates[playlist.id].orEmpty()
                                        .filter { !it.enabled && it.url in urls.map(String::trim) }
                                    keptDisabled.forEach { source ->
                                        repository.setEpgSourceEnabled(playlist.id, source.url, false)
                                    }
                                    val updated = repository.loadStored()
                                    // Saving a new XMLTV URL is an explicit user
                                    // refresh action. Hydrate it immediately so
                                    // Guide TV and catch-up do not remain empty
                                    // until a later startup/refresh cycle.
                                    repository.refreshEpg(updated.filter { it.id == playlist.id })
                                }
                            }.onSuccess {
                                playlists = withContext(Dispatchers.IO) { repository.loadStored() }
                                epgByChannel = withContext(Dispatchers.IO) { repository.loadEpgSnapshot(playlists) }
                                epgSourceStates = withContext(Dispatchers.IO) {
                                    playlists.associate { it.id to repository.loadEpgSourceStates(it.id) }
                                }
                                sourceMessage = if (urls.none { it.isNotBlank() }) "Fuentes EPG eliminadas: ${playlist.name}" else "Fuentes EPG guardadas: ${playlist.name}"
                            }.onFailure { sourceMessage = it.message ?: "URL EPG no válida" }
                        }
                    },
                    onToggleEpgSource = { playlist, url, enabled ->
                        scope.launch {
                            if (withContext(Dispatchers.IO) { repository.setEpgSourceEnabled(playlist.id, url, enabled) }) {
                                val refreshedPlaylists = withContext(Dispatchers.IO) { repository.loadStored() }
                                playlists = refreshedPlaylists
                                epgSourceStates = withContext(Dispatchers.IO) {
                                    refreshedPlaylists.associate { it.id to repository.loadEpgSourceStates(it.id) }
                                }
                                withContext(Dispatchers.IO) {
                                    repository.refreshEpg(refreshedPlaylists.filter { it.id == playlist.id })
                                }
                                epgByChannel = withContext(Dispatchers.IO) { repository.loadEpgSnapshot(refreshedPlaylists) }
                                sourceMessage = if (enabled) "Fuente EPG activada: ${playlist.name}" else "Fuente EPG desactivada: ${playlist.name}"
                            }
                        }
                    },
                    onPickEpgFile = { playlist ->
                        epgFilePlaylistId = playlist.id
                        epgFilePicker.launch(arrayOf("application/xml", "text/xml", "text/plain", "*/*"))
                    },
                    backupMessage = backupMessage,
                    backupBusy = backupBusy,
                    onExportBackup = ::exportBackup,
                    onImportBackup = ::importBackup,
                    initialFocusRequester = settingsContentFocusRequester,
                    onResetPreferences = {
                        uiPreferences.edit().clear().apply()
                        onThemeModeChange(TvVisualTheme.SYSTEM)
                        startupSection = TvSection.Home
                        showDashboard = true
                        selectedSection = TvSection.Home
                        captionsEnabled = true
                        stripCountryPrefixes = false
                        posterSize = "medium"
                        showPosterTitles = true
                        autoPlayEnabled = true
                        autoReconnectLiveEnabled = true
                        vodPlaybackSpeed = 1f
                        vodAutoFailoverEnabled = false
                        xtreamStreamFormat = TvXtreamStreamFormat.AUTO
                        showContinueWatching = true
                        showRecentSources = true
                        showLiveFavorites = true
                        showRecentlyWatchedLive = true
                        showFavoriteMoviesAndSeries = true
                        showTmdbTrending = true
                        showTmdbRecommendations = true
                        showXtreamRecentlyAdded = true
                        m3uVodDetailsEnabled = true
                        epgViewMode = "timeline"
                        epgOffsetMinutes = 0
                        preferUploadedEpgOverXtream = false
                        selectedPlaylistId = playlists.firstOrNull()?.id
                        sourceMessage = "Preferencias de TV restauradas. Las fuentes se conservaron."
                    },
                )
                TvSection.Downloads -> DownloadsContent(
                    records = downloadRecords,
                    snapshots = downloadSnapshots,
                    playlistNames = playlists.associate { it.id to it.name },
                    recordings = recordingHistoryItems,
                    activeRecording = activeRecording,
                    message = downloadsMessage,
                    initialFocusRequester = downloadsContentFocusRequester,
                    onClearCompleted = {
                        val removable = downloadRecords.filter { record ->
                            val status = downloadSnapshots[record.downloadId]?.status
                            record.cancelled ||
                                status == DownloadManager.STATUS_SUCCESSFUL ||
                                status == DownloadManager.STATUS_FAILED ||
                                status == null
                        }
                        removable.forEach { downloadManager.forget(it.downloadId) }
                        downloadHistory.removeAll(removable.map { it.downloadId }.toSet())
                        downloadRecords = downloadHistory.load()
                        downloadsMessage = if (removable.isEmpty()) {
                            "No hay descargas terminadas para limpiar."
                        } else {
                            "Se quitaron ${removable.size} entradas. Los archivos ya descargados se conservaron."
                        }
                    },
                    onCancel = { record ->
                        if (downloadManager.cancel(record.downloadId)) {
                            downloadHistory.add(record.copy(cancelled = true))
                            downloadRecords = downloadHistory.load()
                            downloadSnapshots = downloadSnapshots - record.downloadId
                            if (downloadId == record.downloadId) downloadId = null
                        }
                    },
                    onPause = { record ->
                        if (downloadManager.pause(record.downloadId)) {
                            downloadsMessage = "Descarga pausada; puedes reanudarla desde este punto."
                        }
                    },
                    onResume = { record ->
                        if (downloadManager.resume(record.downloadId)) {
                            downloadsMessage = "Reanudando descarga desde el archivo parcial."
                        }
                    },
                    onRemove = { record ->
                        if (downloadManager.cancel(record.downloadId)) {
                            downloadSnapshots = downloadSnapshots - record.downloadId
                        }
                        downloadHistory.remove(record.downloadId)
                        downloadRecords = downloadHistory.load()
                        if (downloadId == record.downloadId) downloadId = null
                    },
                    onRetry = { record ->
                        scope.launch {
                            downloadsMessage = runCatching {
                                val request = withContext(Dispatchers.IO) {
                                    when {
                                        record.contentType == "series-episode" && record.seriesId != null && record.episodeId != null -> {
                                            val details = repository.getSeriesDetails(record.playlistId, record.seriesId)
                                            val episode = details.episodes.firstOrNull { it.id == record.episodeId }
                                                ?: error("No se encontró el episodio original.")
                                            val playback = repository.resolveSeriesEpisodePlayback(record.playlistId, episode)
                                            TvRetryDownloadRequest(playback.uri, episode.extension, playback.userAgent, playback.headers)
                                        }
                                        record.contentType == "m3u" && record.itemKey != null -> {
                                            val channel = repository.loadChannel(record.playlistId, record.itemKey)
                                                ?: error("No se encontró la entrada M3U original.")
                                            TvRetryDownloadRequest(channel.url, channel.url.substringAfterLast('.', "mp4"), channel.userAgent, channel.headers)
                                        }
                                            record.contentType == "catchup" && record.itemKey != null &&
                                            record.catchupStartMs != null && record.catchupEndMs != null -> {
                                            val channel = repository.loadChannel(record.playlistId, record.itemKey)
                                                ?: error("No se encontró el canal original del catch-up.")
                                            val programme = TvEpgEntry(
                                                channelId = channel.tvgId ?: channel.id,
                                                startMs = record.catchupStartMs,
                                                endMs = record.catchupEndMs,
                                                title = record.title,
                                            )
                                            val url = repository.resolveCatchup(record.playlistId, channel, programme)
                                                ?: error("El archivo catch-up ya no está disponible.")
                                            TvRetryDownloadRequest(url, "ts", channel.userAgent, channel.headers)
                                        }
                                        else -> {
                                            val item = repository.loadVodItem(record.playlistId, record.vodId)
                                                ?: error("No se encontró el VOD original.")
                                            val playback = if (item.providerCommand != null) {
                                                repository.resolveStalkerVod(record.playlistId, item)
                                            } else {
                                                TvPlaybackRequest(
                                                    uri = item.url,
                                                    title = item.name,
                                                    userAgent = com.iptvnator.googletv.xtream.XtreamApiClient.ClientUserAgent.takeIf { item.providerType == "xtream" },
                                                    isLive = false,
                                                )
                                            }
                                            TvRetryDownloadRequest(playback.uri, item.extension, playback.userAgent, playback.headers)
                                        }
                                    }
                                }
                                val keptPartial = withContext(Dispatchers.IO) {
                                    downloadManager.retry(
                                        record.downloadId,
                                        request.url,
                                        request.extension,
                                        request.userAgent,
                                        request.headers,
                                    )
                                }
                                if (keptPartial) {
                                    downloadHistory.add(record.copy(cancelled = false))
                                    downloadRecords = downloadHistory.load()
                                    downloadSnapshots = downloadSnapshots + (
                                        record.downloadId to withContext(Dispatchers.IO) {
                                            downloadManager.query(record.downloadId)
                                        }!!
                                    )
                                    return@runCatching "Reintentando desde el archivo parcial conservado."
                                }
                                val newId = withContext(Dispatchers.IO) {
                                    downloadManager.enqueueUrl(request.url, record.title, request.extension, request.userAgent, request.headers)
                                }
                                downloadManager.cancel(record.downloadId)
                                downloadHistory.remove(record.downloadId)
                                downloadHistory.add(record.copy(downloadId = newId, createdAt = System.currentTimeMillis(), cancelled = false))
                                downloadRecords = downloadHistory.load()
                                downloadSnapshots = downloadSnapshots - record.downloadId
                                "Descarga reintentada."
                            }.getOrElse { failure -> failure.message ?: "No se pudo reintentar la descarga." }
                        }
                    },
                    onPlayRecording = { recording ->
                        if (recording.file.isFile) {
                            playbackRequest = TvPlaybackRequest(
                                uri = Uri.fromFile(recording.file).toString(),
                                title = recording.title,
                                isLive = false,
                                isAudio = false,
                                mimeType = "application/dash+xml".takeIf {
                                    recording.file.extension.equals("mpd", ignoreCase = true)
                                },
                            )
                            activePlaybackItem = null
                            playbackNotice = null
                        } else {
                            recordingHistory.remove(recording)
                            recordingHistoryItems = recordingHistory.load()
                        }
                    },
                    onRemoveRecording = { recording ->
                        TvRecordingHistory.deleteFiles(recording.file)
                        recordingHistory.remove(recording)
                        recordingHistoryItems = recordingHistory.load()
                    },
                    onStopRecording = {
                        scope.launch { recordingManager.stop() }
                    },
                    onPlay = { record, snapshot ->
                        snapshot.localUri?.takeIf { it.isNotBlank() }?.let { uri ->
                            scope.launch {
                                activePlaybackItem = null
                                val episodeTarget = if (
                                    record.contentType == "series-episode" &&
                                    record.seriesId != null &&
                                    record.episodeId != null
                                ) {
                                    Triple(record.playlistId, record.seriesId, record.episodeId)
                                } else null
                                activeEpisodeTarget = episodeTarget
                                val startPosition = episodeTarget?.let { target ->
                                    withContext(Dispatchers.IO) {
                                        repository.loadEpisodeProgress(target.first, target.second)[target.third]?.positionMs
                                    }
                                } ?: 0L
                                playbackRequest = TvPlaybackRequest(
                                    uri = uri,
                                    title = record.title,
                                    startPositionMs = startPosition,
                                    isLive = false,
                                )
                            }
                        }
                    },
                    onOpen = { record ->
                        scope.launch {
                            if (record.contentType == "series-episode" && record.seriesId != null) {
                                runCatching {
                                    val details = withContext(Dispatchers.IO) {
                                        repository.getSeriesDetails(record.playlistId, record.seriesId)
                                    }
                                    episodeProgress = withContext(Dispatchers.IO) {
                                        repository.loadEpisodeProgress(record.playlistId, record.seriesId)
                                    }
                                    seriesTmdb = withContext(Dispatchers.IO) {
                                        runCatching { repository.tmdbSeriesDetails(details.name) }.getOrNull()
                                    }
                                    seriesDetails = record.playlistId to details
                                }.onFailure { seriesDownloadMessage = it.message ?: "No se pudo abrir la serie." }
                            } else if (record.contentType == "m3u" && record.itemKey != null) {
                                repository.loadChannel(record.playlistId, record.itemKey)?.let { channel ->
                                        m3uVodDetails = record.playlistId to channel
                                        m3uVodTmdb = withContext(Dispatchers.IO) {
                                            runCatching { repository.tmdbMovieDetails(channel.name) }.getOrNull()
                                        }
                                        m3uVodDownloadId = null
                                        m3uVodDownloadMessage = null
                                }
                            } else {
                                withContext(Dispatchers.IO) { repository.loadVodItem(record.playlistId, record.vodId) }?.let { item ->
                                    vodProviderDetails = withContext(Dispatchers.IO) { repository.xtreamVodDetails(record.playlistId, item) }
                                    vodTmdb = withContext(Dispatchers.IO) { runCatching { repository.tmdbMovieDetails(item.name) }.getOrNull() }
                                    vodDetails = record.playlistId to item
                                }
                            }
                        }
                    },
                )
                    }
                }
            }
            }
        }
        if (initialSourcesLoading) {
            Box(
                modifier = Modifier.fillMaxSize().background(TvBackground.copy(alpha = 0.96f)),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    CircularProgressIndicator(color = tvColor(Color(0xFF78ADFF)))
                    Text("Cargando tus playlists…", color = TvText, fontSize = 18.sp)
                }
            }
        }
        sourceNoticeMessage?.let { message ->
            Text(
                text = message,
                color = Color.White,
                fontSize = 16.sp,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 28.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(tvColor(Color(0xFF303644)))
                    .padding(horizontal = 24.dp, vertical = 14.dp),
            )
        }
        }
    }

    playlistPendingDelete?.let { playlist ->
        val deletePlaylist = {
            repository.deletePlaylist(playlist.id)
            playlists = playlists.filterNot { it.id == playlist.id }
            favorites = runCatching { repository.loadFavorites() }.getOrDefault(favorites)
            history = runCatching { repository.loadHistory() }.getOrDefault(history)
            epgByChannel = runCatching { repository.loadEpgSnapshot(playlists) }.getOrDefault(emptyMap())
            playlistPendingDelete = null
            sourceMessage = "Fuente eliminada: ${playlist.name}"
        }
        TvAlertDialog(
            onDismissRequest = { playlistPendingDelete = null },
            title = { Text("Eliminar fuente") },
            text = { Text("¿Quieres eliminar «${playlist.name}» y sus datos guardados?") },
            confirmButton = {
                TvButton(
                    onClick = deletePlaylist,
                    modifier = Modifier.tvDpadClick(deletePlaylist),
                ) { Text("Eliminar") }
            },
            dismissButton = {
                TvButton(onClick = { playlistPendingDelete = null }, modifier = Modifier.tvDpadClick { playlistPendingDelete = null }) {
                    Text("Cancelar")
                }
            },
        )
    }

    playlistPendingRename?.let { playlist ->
        val renameBringIntoViewRequester = remember { BringIntoViewRequester() }
        val renameFieldFocusRequester = remember { FocusRequester() }
        val renamePlaylist = {
            val nextName = renameDraft.trim()
            if (nextName.isNotBlank()) {
                scope.launch {
                    runCatching { withContext(Dispatchers.IO) { repository.renamePlaylist(playlist.id, nextName) } }
                        .onSuccess {
                            playlists = withContext(Dispatchers.IO) { repository.loadStored() }
                            sourceMessage = "Fuente renombrada: $nextName"
                            playlistPendingRename = null
                        }
                        .onFailure { sourceMessage = it.message ?: "No se pudo renombrar la fuente" }
                }
            }
        }
        LaunchedEffect(Unit) {
            // The platform dialog is a separate window; retry until its text
            // field is attached so rename starts in a usable TV/IME state.
            repeat(8) {
                delay(100)
                runCatching { renameFieldFocusRequester.requestFocus() }
            }
        }
        TvAlertDialog(
            onDismissRequest = { playlistPendingRename = null },
            title = { Text("Renombrar playlist") },
            text = {
                Column(modifier = Modifier.imePadding()) {
                    TvOutlinedTextField(
                        value = renameDraft,
                        onValueChange = { renameDraft = it },
                        label = { Text("Nombre") },
                        singleLine = true,
                        modifier = Modifier
                            .focusRequester(renameFieldFocusRequester)
                            .bringIntoViewRequester(renameBringIntoViewRequester),
                    )
                }
            },
            confirmButton = {
                TvButton(onClick = renamePlaylist, modifier = Modifier.tvDpadClick(renamePlaylist), enabled = renameDraft.isNotBlank()) {
                    Text("Guardar")
                }
            },
            dismissButton = {
                TvButton(onClick = { playlistPendingRename = null }, modifier = Modifier.tvDpadClick { playlistPendingRename = null }) {
                    Text("Cancelar")
                }
            },
        )
    }

    playlistInfo?.let { playlist ->
        TvAlertDialog(
            onDismissRequest = { playlistInfo = null; playlistInfoCounts = null },
            title = { Text("Información de playlist") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Text(playlist.name, color = TvText, fontSize = 18.sp)
                    Text("Tipo: ${playlistType(playlist)}", color = TvMuted, fontSize = 14.sp)
                    playlistInfoCounts?.let { counts ->
                        Text("Canales: ${counts.channels}", color = TvMuted, fontSize = 14.sp)
                        Text("Películas: ${counts.vod}", color = TvMuted, fontSize = 14.sp)
                        Text("Series: ${counts.series}", color = TvMuted, fontSize = 14.sp)
                    } ?: Text("Contando catálogo…", color = TvMuted, fontSize = 14.sp)
                    Text("EPG: ${if (playlist.epgUrl.isNullOrBlank()) "No configurado" else "Configurado"}", color = TvMuted, fontSize = 14.sp)
                    playlist.sourceUrl?.let { Text("Fuente: ${redactTvSourceUrl(it)}", color = TvMuted, fontSize = 12.sp, maxLines = 2) }
                }
            },
            confirmButton = {
                TvButton(onClick = { playlistInfo = null; playlistInfoCounts = null }, modifier = Modifier.tvDpadClick { playlistInfo = null; playlistInfoCounts = null }) {
                    Text("Cerrar")
                }
            },
        )
    }

    epgMappingTarget?.let { (playlistId, channel) ->
        val epgMappingBringIntoViewRequester = remember { BringIntoViewRequester() }
        val epgMappingKeyboardController = LocalSoftwareKeyboardController.current
        val epgMappingFieldFocusRequester = remember { FocusRequester() }
        val epgMappingCancelFocusRequester = remember { FocusRequester() }
        val epgMappingSaveFocusRequester = remember { FocusRequester() }
        LaunchedEffect(Unit) {
            // AlertDialog attaches in its own window. A single early request
            // can leave the field visually present but unreachable by IME.
            repeat(8) {
                delay(100)
                runCatching { epgMappingFieldFocusRequester.requestFocus() }
            }
        }
        val saveMapping = {
            scope.launch {
                withContext(Dispatchers.IO) {
                    repository.setEpgMapping(playlistId, channel.id, epgMappingDraft)
                }
                epgByChannel = withContext(Dispatchers.IO) { repository.loadEpgSnapshot(playlists) }
                sourceMessage = if (epgMappingDraft.isBlank()) {
                    "Mapeo EPG eliminado: ${channel.name}"
                } else {
                    "Mapeo EPG guardado: ${channel.name}"
                }
                epgMappingTarget = null
            }
        }
        TvAlertDialog(
            onDismissRequest = { epgMappingTarget = null },
            title = { Text("Mapear EPG") },
            text = {
                Column(
                    modifier = Modifier.imePadding(),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text(channel.name, color = TvText, fontSize = 18.sp)
                    Text("Introduce el identificador channel-id del XMLTV. Déjalo vacío para volver al mapeo automático.", color = TvMuted, fontSize = 10.sp)
                    TvOutlinedTextField(
                        value = epgMappingDraft,
                        onValueChange = { epgMappingDraft = it },
                        label = { Text("ID XMLTV") },
                        textStyle = LocalTextStyle.current.copy(fontSize = 14.sp, color = TvText),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = {
                            epgMappingKeyboardController?.hide()
                            epgMappingSaveFocusRequester.requestFocus()
                        }),
                        modifier = Modifier
                            .focusRequester(epgMappingFieldFocusRequester)
                            .focusProperties { down = epgMappingSaveFocusRequester }
                            .onPreviewKeyEvent { event ->
                                if (event.type == KeyEventType.KeyDown && event.nativeKeyEvent.keyCode == KeyEvent.KEYCODE_DPAD_DOWN) {
                                    epgMappingSaveFocusRequester.requestFocus()
                                    true
                                } else {
                                    false
                                }
                            }
                            .onKeyEvent { event ->
                                if (event.type == KeyEventType.KeyDown && event.nativeKeyEvent.keyCode == KeyEvent.KEYCODE_DPAD_DOWN) {
                                    epgMappingSaveFocusRequester.requestFocus()
                                    true
                                } else {
                                    false
                                }
                            }
                            .bringIntoViewRequester(epgMappingBringIntoViewRequester),
                    )
                }
            },
            confirmButton = {
                TvButton(
                    onClick = { saveMapping() },
                    modifier = Modifier
                        .focusRequester(epgMappingSaveFocusRequester)
                        .focusProperties { left = epgMappingCancelFocusRequester; up = epgMappingFieldFocusRequester }
                        .tvDpadClick { saveMapping() },
                ) {
                    Text("Guardar")
                }
            },
            dismissButton = {
                TvButton(
                    onClick = { epgMappingTarget = null },
                    modifier = Modifier
                        .focusRequester(epgMappingCancelFocusRequester)
                        .focusProperties { right = epgMappingSaveFocusRequester; up = epgMappingFieldFocusRequester }
                        .tvDpadClick { epgMappingTarget = null },
                ) {
                    Text("Cancelar")
                }
            },
        )
    }

    accountInfoPlaylist?.let { playlist ->
        TvAccountInfoDialog(
            playlist = playlist,
            xtream = accountInfo,
            stalker = accountStalkerSession,
            loading = accountInfoLoading,
            error = accountInfoError,
            onDismiss = {
                accountInfoPlaylist = null
                accountInfo = null
                accountStalkerSession = null
                accountInfoError = null
            },
            onRetry = { openAccountInfo(playlist) },
        )
    }
}

@Composable
private fun TvAccountInfoDialog(
    playlist: StoredPlaylist,
    xtream: XtreamAccountInfo?,
    stalker: StalkerSession?,
    loading: Boolean,
    error: String?,
    onDismiss: () -> Unit,
    onRetry: () -> Unit,
) {
    TvAlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Información de cuenta") },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(playlist.name, color = TvText, fontSize = 18.sp)
                Text("Proveedor: ${playlistType(playlist)}", color = TvMuted, fontSize = 13.sp)
                when {
                    loading -> {
                        CircularProgressIndicator(color = tvColor(Color(0xFF78ADFF)))
                        Text("Consultando el portal…", color = TvMuted, fontSize = 13.sp)
                    }
                    error != null -> {
                        Text("Portal no disponible", color = tvColor(Color(0xFFFFB4AB)), fontSize = 16.sp)
                        Text(error, color = TvMuted, fontSize = 12.sp)
                    }
                    xtream != null -> {
                        AccountInfoRow("Estado", xtream.status ?: if (xtream.authenticated) "activo" else "no autenticado")
                        AccountInfoRow("Usuario", xtream.username ?: "—")
                        AccountInfoRow("Servidor", redactTvSourceUrl(xtream.serverUrl ?: playlist.sourceUrl ?: "—"))
                        AccountInfoRow("Expiración", formatAccountExpiration(xtream.expirationEpochSeconds))
                        AccountInfoRow("Conexiones", if (xtream.activeConnections != null && xtream.maxConnections != null) "${xtream.activeConnections}/${xtream.maxConnections}" else "—")
                        AccountInfoRow("Formatos", xtream.allowedOutputFormats.ifEmpty { listOf("—") }.joinToString(", "))
                    }
                    stalker != null -> {
                        AccountInfoRow("Estado", stalker.profileStatus ?: "conectado")
                        stalker.accountLogin?.let { AccountInfoRow("Usuario", it) }
                        stalker.tariffPlanName?.let { AccountInfoRow("Plan", it) }
                        AccountInfoRow("Expiración", stalker.expirationEpochSeconds?.let {
                            formatAccountExpiration(it)
                        } ?: "Sin fecha de expiración")
                        AccountInfoRow("MAC", stalker.credentials.macAddress)
                        AccountInfoRow("Portal", redactTvSourceUrl(stalker.credentials.portalUrl))
                        stalker.credentials.serialNumber?.let { AccountInfoRow("Serie", it) }
                        stalker.profileMessage?.let { AccountInfoRow("Mensaje", it) }
                    }
                }
            }
        },
        confirmButton = {
            if (error != null && !loading) {
                TvButton(onClick = onRetry, modifier = Modifier.tvDpadClick(onRetry)) { Text("Reintentar") }
            } else {
                TvButton(onClick = onDismiss, modifier = Modifier.tvDpadClick(onDismiss)) { Text("Cerrar") }
            }
        },
        dismissButton = if (error != null && !loading) {
            { TvButton(onClick = onDismiss, modifier = Modifier.tvDpadClick(onDismiss)) { Text("Cancelar") } }
        } else null,
    )
}

@Composable
private fun AccountInfoRow(label: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, color = TvMuted, fontSize = 11.sp)
        Text(value, color = TvText, fontSize = 14.sp, maxLines = 2)
    }
}

private fun formatAccountExpiration(epochSeconds: Long?): String = epochSeconds?.let {
    SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.getDefault()).format(Date(it * 1_000L))
} ?: "Sin fecha de expiración"

internal enum class TvSection(val label: String) {
    Home("Inicio"),
    Sources("Fuentes"),
    Recent("Recientes"),
    Live("TV en directo"),
    Radio("Radio"),
    Vod("Películas"),
    Series("Series"),
    RecentlyAdded("Novedades"),
    Search("Buscar"),
    Guide("Guía TV"),
    Favorites("Favoritos"),
    Settings("Ajustes"),
    Downloads("Descargas"),
}

internal fun homeHeroFallbackDestination(
    hasSource: Boolean,
    hasTvChannels: Boolean,
    hasRadio: Boolean,
    hasVod: Boolean,
    hasSeries: Boolean,
): TvSection? {
    if (!hasSource) return null
    return when {
        hasTvChannels -> TvSection.Live
        hasRadio -> TvSection.Radio
        hasVod -> TvSection.Vod
        hasSeries -> TvSection.Series
        else -> TvSection.Sources
    }
}

@Composable
private fun TvSidebar(
    section: TvSection,
    showDashboard: Boolean,
    selectedPlaylist: StoredPlaylist?,
    activeDownloadCount: Int,
    hasDownloads: Boolean,
    hasRecordings: Boolean,
    rightFocusRequester: FocusRequester,
    firstFocusRequester: FocusRequester,
    activeFocusRequester: FocusRequester,
    onSectionSelected: (TvSection) -> Unit,
) {
    val counts = selectedPlaylist?.catalogCounts
    val hasChannels = selectedPlaylist?.let(::playlistHasTvChannels) == true
    val hasRadio = (counts?.radio ?: selectedPlaylist?.channels?.count { it.radio } ?: 0) > 0
    val hasVod = (counts?.vod ?: selectedPlaylist?.vod?.size ?: 0) > 0
    val hasSeries = (counts?.series ?: selectedPlaylist?.series?.size ?: 0) > 0
    val hasGuide = selectedPlaylist?.epgUrl?.isNotBlank() == true || hasChannels
    val entries = buildList {
        if (showDashboard) add(TvSection.Home)
        addAll(listOf(TvSection.Sources, TvSection.Search, TvSection.Favorites, TvSection.Recent))
        if (hasChannels) add(TvSection.Live)
        if (hasRadio) add(TvSection.Radio)
        if (hasVod) add(TvSection.Vod)
        if (hasSeries) add(TvSection.Series)
        if (hasVod || hasSeries) add(TvSection.RecentlyAdded)
        if (hasGuide) add(TvSection.Guide)
        // Keep Downloads reachable for both transfers and TV recordings; a
        // recording must remain visible in its manager after leaving playback.
        if (tvSidebarIncludesDownloads(section, hasDownloads, hasRecordings)) add(TvSection.Downloads)
        add(TvSection.Settings)
    }
    val focusRequesters = remember(entries) { List(entries.size) { FocusRequester() } }
    val bringIntoViewRequesters = remember(entries) { List(entries.size) { BringIntoViewRequester() } }
    val sidebarScope = rememberCoroutineScope()
    var railHasFocus by remember { mutableStateOf(false) }
    var railFocusInitialized by remember { mutableStateOf(false) }
    LaunchedEffect(section, entries) {
        // Live and Radio own a lazily populated three-pane screen. Restoring
        // focus to the rail here can race its delayed content request and
        // leave D-pad users on the navigation icon instead of the first group.
        if (section == TvSection.Live || section == TvSection.Radio) {
            // Live owns its own initial focus; count it as the rail's first
            // hand-off so later section changes never pull focus back here.
            railFocusInitialized = true
            return@LaunchedEffect
        }
        // Compose TV may not have attached the sidebar during the first frame.
        // Requesting the active item after one frame keeps the focus indicator
        // and the selected section aligned when a section is opened from the
        // toolbar or another non-sidebar action.
        delay(200)
        // Only align focus with the active item on first launch or while the
        // rail already owns focus. Confirming a section hands focus to its
        // content ~100ms earlier; re-focusing the rail here used to steal it
        // back and forced an extra RIGHT press on every section change.
        if (railFocusInitialized && !railHasFocus) return@LaunchedEffect
        railFocusInitialized = true
        val selectedIndex = entries.indexOf(section)
        if (selectedIndex == 0) {
            firstFocusRequester.requestFocus()
        } else if (selectedIndex > 0) {
            focusRequesters[selectedIndex].requestFocus()
        } else {
            firstFocusRequester.requestFocus()
        }
    }
    val railWidth by androidx.compose.animation.core.animateDpAsState(
        targetValue = if (railHasFocus) 196.dp else 56.dp,
        animationSpec = androidx.compose.animation.core.tween(180),
        label = "tvRailWidth",
    )
    val deep = tvTone(TvTone.Deep)
    val accent = tvTone(TvTone.Accent)
    Box(
        modifier = Modifier
            .width(56.dp)
            .fillMaxHeight()
            .zIndex(2f),
        contentAlignment = Alignment.TopStart,
    ) {
        if (railHasFocus) {
            // Dim the content behind the expanded rail so labels read
            // cleanly at ten feet without pushing the layout sideways.
            Box(
                Modifier
                    .wrapContentWidth(Alignment.Start, unbounded = true)
                    .width(520.dp)
                    .fillMaxHeight()
                    .background(Brush.horizontalGradient(listOf(deep.copy(alpha = 0.92f), Color.Transparent))),
            )
        }
        Column(
            modifier = Modifier
                .wrapContentWidth(Alignment.Start, unbounded = true)
                .width(railWidth)
                .fillMaxHeight()
                .background(deep)
                .onFocusChanged { railHasFocus = it.hasFocus }
                // Entering the rail from content (D-pad LEFT) always lands
                // on the active section, never on whichever icon happens to
                // be geometrically closest to the focused content.
                .focusProperties {
                    onEnter = {
                        val activeIndex = entries.indexOf(section)
                        val target = when {
                            activeIndex <= 0 -> firstFocusRequester
                            else -> focusRequesters[activeIndex]
                        }
                        if (target.requestFocus()) cancelFocusChange()
                    }
                }
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 8.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Row(
                modifier = Modifier.height(34.dp).padding(start = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TvBrandMark()
                if (railHasFocus) {
                    Column(Modifier.padding(start = 10.dp)) {
                        Text("IPTVnator", color = tvTone(TvTone.Text), fontFamily = TvType.Display, fontSize = 14.sp, lineHeight = 15.sp, maxLines = 1)
                        TvEyebrow("Google TV", color = tvTone(TvTone.Muted))
                    }
                }
            }
            Spacer(Modifier.height(14.dp))
            entries.forEachIndexed { index, item ->
                val isActive = item == section
                var itemFocused by remember(item) { mutableStateOf(false) }
                TvCard(
                    onClick = { onSectionSelected(item) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(36.dp)
                        .focusRequester(if (index == 0) firstFocusRequester else focusRequesters[index])
                        .then(if (isActive) Modifier.focusRequester(activeFocusRequester) else Modifier)
                        .bringIntoViewRequester(bringIntoViewRequesters[index])
                        .focusProperties {
                            if (index > 0) up = if (index == 1) firstFocusRequester else focusRequesters[index - 1]
                            if (index < focusRequesters.lastIndex) down = focusRequesters[index + 1]
                            right = rightFocusRequester
                        }
                        .onFocusChanged { focusState ->
                            itemFocused = focusState.isFocused
                            if (focusState.isFocused) {
                                sidebarScope.launch { bringIntoViewRequesters[index].bringIntoView() }
                            }
                        }
                        .onPreviewKeyEvent { event ->
                            if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                            when (event.nativeKeyEvent.keyCode) {
                                KeyEvent.KEYCODE_DPAD_UP -> if (index > 0) {
                                    if (index == 1) firstFocusRequester.requestFocus()
                                    else focusRequesters[index - 1].requestFocus()
                                    true
                                } else false
                                KeyEvent.KEYCODE_DPAD_DOWN -> if (index < focusRequesters.lastIndex) {
                                    focusRequesters[index + 1].requestFocus()
                                    true
                                } else false
                                KeyEvent.KEYCODE_DPAD_RIGHT -> rightFocusRequester.requestFocus()
                                else -> false
                            }
                        }
                        .tvDpadClick { onSectionSelected(item) },
                    shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(12.dp)),
                    scale = androidx.tv.material3.CardDefaults.scale(focusedScale = 1f),
                    colors = androidx.tv.material3.CardDefaults.colors(
                        containerColor = if (isActive) tvTone(TvTone.Selected) else Color.Transparent,
                        focusedContainerColor = tvTone(TvTone.Focused),
                    ),
                ) {
                    Row(
                        modifier = Modifier.fillMaxSize(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier
                                .width(3.dp)
                                .height(16.dp)
                                .background(if (isActive) accent else Color.Transparent, RoundedCornerShape(2.dp)),
                        )
                        Box(Modifier.width(37.dp), contentAlignment = Alignment.Center) {
                            SidebarGlyph(
                                item,
                                when {
                                    itemFocused -> tvTone(TvTone.Text)
                                    isActive -> accent
                                    else -> tvTone(TvTone.Muted)
                                },
                            )
                            if (item == TvSection.Downloads && activeDownloadCount > 0) {
                                Box(
                                    modifier = Modifier
                                        .align(Alignment.TopEnd)
                                        .padding(top = 2.dp, end = 4.dp)
                                        .width(14.dp)
                                        .height(14.dp)
                                        .background(tvTone(TvTone.Live), RoundedCornerShape(7.dp)),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(activeDownloadCount.coerceAtMost(99).toString(), color = tvTone(TvTone.AccentInk), fontSize = 7.sp, lineHeight = 8.sp)
                                }
                            }
                        }
                        if (railHasFocus) {
                            Text(
                                item.label,
                                modifier = Modifier.padding(start = 6.dp),
                                color = when {
                                    itemFocused -> tvTone(TvTone.Text)
                                    isActive -> accent
                                    else -> tvTone(TvTone.TextSoft)
                                },
                                fontFamily = if (isActive || itemFocused) TvType.BodyMedium else TvType.Body,
                                fontSize = 11.sp,
                                maxLines = 1,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** IPTVnator mark: an amber tile with a broadcast play wedge. */
@Composable
internal fun TvBrandMark(sizeDp: Int = 28) {
    val accent = tvTone(TvTone.Accent)
    val ink = tvTone(TvTone.AccentInk)
    Canvas(Modifier.width(sizeDp.dp).height(sizeDp.dp)) {
        val r = size.minDimension * 0.28f
        drawRoundRect(
            Brush.linearGradient(listOf(accent, accent.copy(red = (accent.red * 0.92f)), Color(0xFFFF7A3D))),
            cornerRadius = CornerRadius(r, r),
        )
        val w = size.width
        val h = size.height
        val wedge = Path().apply {
            moveTo(w * 0.38f, h * 0.28f)
            lineTo(w * 0.74f, h * 0.5f)
            lineTo(w * 0.38f, h * 0.72f)
            close()
        }
        drawPath(wedge, ink, style = androidx.compose.ui.graphics.drawscope.Fill)
        drawPath(wedge, ink, style = androidx.compose.ui.graphics.drawscope.Stroke(width = w * 0.06f, join = StrokeJoin.Round))
        drawCircle(ink, radius = w * 0.06f, center = androidx.compose.ui.geometry.Offset(w * 0.78f, h * 0.24f))
    }
}

@Composable
private fun SidebarGlyph(section: TvSection, color: Color) {
    Canvas(Modifier.width(20.dp).height(20.dp)) {
        val stroke = 1.8.dp.toPx()
        val cap = StrokeCap.Round
        val join = StrokeJoin.Round
        val w = size.width
        val h = size.height
        when (section) {
            TvSection.Home -> {
                // House: pitched roof over a body with an arched doorway.
                val d = 1.dp.toPx()
                val house = Path().apply {
                    moveTo(2.5f * d, 9.5f * d)
                    lineTo(w / 2f, 2.5f * d)
                    lineTo(w - 2.5f * d, 9.5f * d)
                    moveTo(4.5f * d, 8f * d)
                    lineTo(4.5f * d, h - 2.5f * d)
                    lineTo(w - 4.5f * d, h - 2.5f * d)
                    lineTo(w - 4.5f * d, 8f * d)
                }
                drawPath(house, color, style = androidx.compose.ui.graphics.drawscope.Stroke(stroke, cap = cap, join = join))
                val door = Path().apply {
                    moveTo(8f * d, h - 2.5f * d)
                    lineTo(8f * d, 13f * d)
                    quadraticTo(w / 2f, 10.5f * d, 12f * d, 13f * d)
                    lineTo(12f * d, h - 2.5f * d)
                }
                drawPath(door, color, style = androidx.compose.ui.graphics.drawscope.Stroke(stroke, cap = cap, join = join))
            }
            TvSection.Sources -> repeat(3) { row ->
                val y = 4.dp.toPx() + row * 6.dp.toPx()
                drawLine(color, androidx.compose.ui.geometry.Offset(2.dp.toPx(), y), androidx.compose.ui.geometry.Offset(5.dp.toPx(), y), stroke, cap)
                drawLine(color, androidx.compose.ui.geometry.Offset(8.dp.toPx(), y), androidx.compose.ui.geometry.Offset(w - 2.dp.toPx(), y), stroke, cap)
            }
            TvSection.Search -> {
                drawCircle(color, 6.dp.toPx(), androidx.compose.ui.geometry.Offset(8.dp.toPx(), 8.dp.toPx()), style = androidx.compose.ui.graphics.drawscope.Stroke(stroke))
                drawLine(color, androidx.compose.ui.geometry.Offset(12.5.dp.toPx(), 12.5.dp.toPx()), androidx.compose.ui.geometry.Offset(18.dp.toPx(), 18.dp.toPx()), stroke, cap)
            }
            TvSection.Favorites -> {
                val p = Path().apply {
                    moveTo(w / 2f, h - 2.dp.toPx())
                    cubicTo(2.dp.toPx(), 10.dp.toPx(), 2.dp.toPx(), 3.dp.toPx(), 6.dp.toPx(), 3.dp.toPx())
                    cubicTo(8.dp.toPx(), 3.dp.toPx(), 9.dp.toPx(), 4.dp.toPx(), w / 2f, 7.dp.toPx())
                    cubicTo(11.dp.toPx(), 4.dp.toPx(), 12.dp.toPx(), 3.dp.toPx(), 14.dp.toPx(), 3.dp.toPx())
                    cubicTo(18.dp.toPx(), 3.dp.toPx(), 18.dp.toPx(), 10.dp.toPx(), w / 2f, h - 2.dp.toPx())
                }
                drawPath(p, color, style = androidx.compose.ui.graphics.drawscope.Stroke(stroke, join = join))
            }
            TvSection.Guide -> {
                val gap = 2.5.dp.toPx()
                drawRoundRect(color, androidx.compose.ui.geometry.Offset(1.dp.toPx(), 2.dp.toPx()), androidx.compose.ui.geometry.Size(w - 2.dp.toPx(), h - 4.dp.toPx()), CornerRadius(2.dp.toPx()), style = androidx.compose.ui.graphics.drawscope.Stroke(stroke))
                val rowY = listOf(7.dp.toPx(), 11.dp.toPx(), 15.dp.toPx())
                rowY.forEachIndexed { row, y ->
                    val split = if (row % 2 == 0) w * 0.45f else w * 0.62f
                    drawLine(color, androidx.compose.ui.geometry.Offset(4.dp.toPx(), y), androidx.compose.ui.geometry.Offset(split - gap, y), stroke, cap)
                    drawLine(color, androidx.compose.ui.geometry.Offset(split + gap, y), androidx.compose.ui.geometry.Offset(w - 4.dp.toPx(), y), stroke, cap)
                }
            }
            TvSection.Recent -> {
                drawCircle(color, 7.dp.toPx(), androidx.compose.ui.geometry.Offset(w / 2f, h / 2f), style = androidx.compose.ui.graphics.drawscope.Stroke(stroke))
                drawLine(color, androidx.compose.ui.geometry.Offset(w / 2f, h / 2f), androidx.compose.ui.geometry.Offset(w / 2f, 5.dp.toPx()), stroke, cap)
                drawLine(color, androidx.compose.ui.geometry.Offset(w / 2f, h / 2f), androidx.compose.ui.geometry.Offset(14.dp.toPx(), h / 2f), stroke, cap)
            }
            TvSection.Live -> {
                drawRoundRect(color, androidx.compose.ui.geometry.Offset(2.dp.toPx(), 3.dp.toPx()), androidx.compose.ui.geometry.Size(w - 4.dp.toPx(), h - 6.dp.toPx()), CornerRadius(1.dp.toPx()), style = androidx.compose.ui.graphics.drawscope.Stroke(stroke))
                drawLine(color, androidx.compose.ui.geometry.Offset(7.dp.toPx(), h - 1.dp.toPx()), androidx.compose.ui.geometry.Offset(w - 7.dp.toPx(), h - 1.dp.toPx()), stroke, cap)
            }
            TvSection.Radio -> {
                drawLine(color, androidx.compose.ui.geometry.Offset(6.dp.toPx(), 4.dp.toPx()), androidx.compose.ui.geometry.Offset(6.dp.toPx(), 17.dp.toPx()), stroke, cap)
                drawLine(color, androidx.compose.ui.geometry.Offset(6.dp.toPx(), 5.dp.toPx()), androidx.compose.ui.geometry.Offset(15.dp.toPx(), 3.dp.toPx()), stroke, cap)
                drawLine(color, androidx.compose.ui.geometry.Offset(10.dp.toPx(), 9.dp.toPx()), androidx.compose.ui.geometry.Offset(17.dp.toPx(), 9.dp.toPx()), stroke, cap)
                drawLine(color, androidx.compose.ui.geometry.Offset(14.dp.toPx(), 9.dp.toPx()), androidx.compose.ui.geometry.Offset(14.dp.toPx(), 16.dp.toPx()), stroke, cap)
            }
            TvSection.Vod -> {
                // Film clapperboard: slate body plus an angled striped clapper.
                fun o(x: Float, y: Float) = androidx.compose.ui.geometry.Offset(x, y)
                val bodyTop = 8.dp.toPx()
                drawRoundRect(color, o(2.dp.toPx(), bodyTop), androidx.compose.ui.geometry.Size(w - 4.dp.toPx(), h - bodyTop - 2.dp.toPx()), CornerRadius(2.dp.toPx()), style = androidx.compose.ui.graphics.drawscope.Stroke(stroke))
                val clapper = Path().apply {
                    moveTo(2.dp.toPx(), 7.dp.toPx())
                    lineTo(w - 3.dp.toPx(), 2.dp.toPx())
                    lineTo(w - 2.dp.toPx(), 5.5.dp.toPx())
                    lineTo(3.dp.toPx(), 10.5.dp.toPx())
                    close()
                }
                drawPath(clapper, color, style = androidx.compose.ui.graphics.drawscope.Stroke(stroke, join = join))
                listOf(0.32f, 0.56f, 0.8f).forEach { f ->
                    val x = w * f
                    val yTop = 7.dp.toPx() - (x - 2.dp.toPx()) * (5.dp.toPx() / (w - 5.dp.toPx()))
                    drawLine(color, o(x - 1.5.dp.toPx(), yTop + 3.dp.toPx()), o(x + 1.dp.toPx(), yTop), stroke, cap)
                }
                drawLine(color, o(2.dp.toPx(), 13.dp.toPx()), o(w - 2.dp.toPx(), 13.dp.toPx()), stroke, cap)
            }
            TvSection.Series -> {
                // Stacked episodes: a screen with a play wedge and two cards
                // peeking behind it.
                fun o(x: Float, y: Float) = androidx.compose.ui.geometry.Offset(x, y)
                drawLine(color, o(5.dp.toPx(), 2.dp.toPx()), o(w - 5.dp.toPx(), 2.dp.toPx()), stroke, cap)
                drawLine(color, o(3.5.dp.toPx(), 5.dp.toPx()), o(w - 3.5.dp.toPx(), 5.dp.toPx()), stroke, cap)
                drawRoundRect(color, o(2.dp.toPx(), 8.dp.toPx()), androidx.compose.ui.geometry.Size(w - 4.dp.toPx(), h - 10.dp.toPx()), CornerRadius(2.dp.toPx()), style = androidx.compose.ui.graphics.drawscope.Stroke(stroke))
                val cx = w / 2f
                val cy = 8.dp.toPx() + (h - 10.dp.toPx()) / 2f
                val play = Path().apply {
                    moveTo(cx - 2.dp.toPx(), cy - 3.dp.toPx())
                    lineTo(cx + 3.dp.toPx(), cy)
                    lineTo(cx - 2.dp.toPx(), cy + 3.dp.toPx())
                    close()
                }
                drawPath(play, color)
            }
            TvSection.RecentlyAdded -> {
                drawLine(color, androidx.compose.ui.geometry.Offset(3.dp.toPx(), h / 2f), androidx.compose.ui.geometry.Offset(w - 3.dp.toPx(), h / 2f), stroke, cap)
                drawLine(color, androidx.compose.ui.geometry.Offset(w / 2f, 3.dp.toPx()), androidx.compose.ui.geometry.Offset(w / 2f, h - 3.dp.toPx()), stroke, cap)
                drawCircle(color, 3.dp.toPx(), androidx.compose.ui.geometry.Offset(w / 2f, h / 2f), style = androidx.compose.ui.graphics.drawscope.Stroke(stroke))
            }
            TvSection.Downloads -> {
                drawLine(color, androidx.compose.ui.geometry.Offset(w / 2f, 2.dp.toPx()), androidx.compose.ui.geometry.Offset(w / 2f, 14.dp.toPx()), stroke, cap)
                drawLine(color, androidx.compose.ui.geometry.Offset(5.dp.toPx(), 11.dp.toPx()), androidx.compose.ui.geometry.Offset(w / 2f, 16.dp.toPx()), stroke, cap)
                drawLine(color, androidx.compose.ui.geometry.Offset(w - 5.dp.toPx(), 11.dp.toPx()), androidx.compose.ui.geometry.Offset(w / 2f, 16.dp.toPx()), stroke, cap)
                drawLine(color, androidx.compose.ui.geometry.Offset(3.dp.toPx(), h - 2.dp.toPx()), androidx.compose.ui.geometry.Offset(w - 3.dp.toPx(), h - 2.dp.toPx()), stroke, cap)
            }
            TvSection.Settings -> {
                val c = androidx.compose.ui.geometry.Offset(w / 2f, h / 2f)
                drawCircle(color, 5.5.dp.toPx(), c, style = androidx.compose.ui.graphics.drawscope.Stroke(stroke))
                drawCircle(color, 2.dp.toPx(), c, style = androidx.compose.ui.graphics.drawscope.Stroke(stroke))
                repeat(6) { i ->
                    val angle = i * Math.PI / 3 + Math.PI / 6
                    val inner = 6.dp.toPx()
                    val outer = 9.dp.toPx()
                    drawLine(
                        color,
                        androidx.compose.ui.geometry.Offset(c.x + kotlin.math.cos(angle).toFloat() * inner, c.y + kotlin.math.sin(angle).toFloat() * inner),
                        androidx.compose.ui.geometry.Offset(c.x + kotlin.math.cos(angle).toFloat() * outer, c.y + kotlin.math.sin(angle).toFloat() * outer),
                        stroke * 1.9f,
                        cap,
                    )
                }
            }
        }
    }
}

@Composable
private fun SourceGlyph(kind: String, color: Color, modifier: Modifier = Modifier.width(24.dp).height(24.dp)) {
    Canvas(modifier) {
        val stroke = 1.8.dp.toPx()
        val cap = StrokeCap.Round
        val w = size.width
        val h = size.height
        when (kind) {
            "ADD" -> {
                drawLine(color, androidx.compose.ui.geometry.Offset(w / 2f, 2.dp.toPx()), androidx.compose.ui.geometry.Offset(w / 2f, h - 2.dp.toPx()), stroke, cap)
                drawLine(color, androidx.compose.ui.geometry.Offset(2.dp.toPx(), h / 2f), androidx.compose.ui.geometry.Offset(w - 2.dp.toPx(), h / 2f), stroke, cap)
            }
            "M3U" -> {
                val top = 5.dp.toPx()
                val left = 3.dp.toPx()
                val right = w - 3.dp.toPx()
                val bottom = h - 4.dp.toPx()
                drawLine(color, androidx.compose.ui.geometry.Offset(left, top + 3.dp.toPx()), androidx.compose.ui.geometry.Offset(left, bottom), stroke, cap)
                drawLine(color, androidx.compose.ui.geometry.Offset(left, bottom), androidx.compose.ui.geometry.Offset(right, bottom), stroke, cap)
                drawLine(color, androidx.compose.ui.geometry.Offset(right, bottom), androidx.compose.ui.geometry.Offset(right, top + 5.dp.toPx()), stroke, cap)
                drawLine(color, androidx.compose.ui.geometry.Offset(left, top + 3.dp.toPx()), androidx.compose.ui.geometry.Offset(10.dp.toPx(), top + 3.dp.toPx()), stroke, cap)
                drawLine(color, androidx.compose.ui.geometry.Offset(10.dp.toPx(), top + 3.dp.toPx()), androidx.compose.ui.geometry.Offset(13.dp.toPx(), top), stroke, cap)
                drawLine(color, androidx.compose.ui.geometry.Offset(13.dp.toPx(), top), androidx.compose.ui.geometry.Offset(right, top), stroke, cap)
                drawLine(color, androidx.compose.ui.geometry.Offset(right, top), androidx.compose.ui.geometry.Offset(right, top + 5.dp.toPx()), stroke, cap)
            }
            else -> {
                val base = h - 6.dp.toPx()
                drawCircle(color, 5.dp.toPx(), androidx.compose.ui.geometry.Offset(8.dp.toPx(), base - 3.dp.toPx()), style = androidx.compose.ui.graphics.drawscope.Stroke(stroke))
                drawCircle(color, 6.dp.toPx(), androidx.compose.ui.geometry.Offset(13.dp.toPx(), base - 5.dp.toPx()), style = androidx.compose.ui.graphics.drawscope.Stroke(stroke))
                drawCircle(color, 4.dp.toPx(), androidx.compose.ui.geometry.Offset(18.dp.toPx(), base - 2.dp.toPx()), style = androidx.compose.ui.graphics.drawscope.Stroke(stroke))
                drawLine(color, androidx.compose.ui.geometry.Offset(4.dp.toPx(), base), androidx.compose.ui.geometry.Offset(21.dp.toPx(), base), stroke, cap)
            }
        }
    }
}

@Composable
private fun KeyboardGlyph(color: Color) {
    Canvas(Modifier.width(20.dp).height(18.dp)) {
        val stroke = 1.6.dp.toPx()
        drawRoundRect(
            color,
            androidx.compose.ui.geometry.Offset(1.dp.toPx(), 2.dp.toPx()),
            androidx.compose.ui.geometry.Size(size.width - 2.dp.toPx(), size.height - 4.dp.toPx()),
            CornerRadius(2.dp.toPx()),
            style = androidx.compose.ui.graphics.drawscope.Stroke(stroke),
        )
        repeat(4) { column ->
            drawCircle(color, 0.7.dp.toPx(), androidx.compose.ui.geometry.Offset(5.dp.toPx() + column * 3.dp.toPx(), 6.dp.toPx()))
        }
        drawLine(color, androidx.compose.ui.geometry.Offset(5.dp.toPx(), 13.dp.toPx()), androidx.compose.ui.geometry.Offset(15.dp.toPx(), 13.dp.toPx()), stroke, StrokeCap.Round)
    }
}

@Composable
private fun TrashGlyph(color: Color) {
    Canvas(Modifier.width(18.dp).height(20.dp)) {
        val stroke = 1.6.dp.toPx()
        val cap = StrokeCap.Round
        drawRoundRect(
            color,
            androidx.compose.ui.geometry.Offset(4.dp.toPx(), 6.dp.toPx()),
            androidx.compose.ui.geometry.Size(10.dp.toPx(), 11.dp.toPx()),
            CornerRadius(1.dp.toPx()),
            style = androidx.compose.ui.graphics.drawscope.Stroke(stroke),
        )
        drawLine(color, androidx.compose.ui.geometry.Offset(3.dp.toPx(), 4.dp.toPx()), androidx.compose.ui.geometry.Offset(15.dp.toPx(), 4.dp.toPx()), stroke, cap)
        drawLine(color, androidx.compose.ui.geometry.Offset(7.dp.toPx(), 2.dp.toPx()), androidx.compose.ui.geometry.Offset(11.dp.toPx(), 2.dp.toPx()), stroke, cap)
        drawLine(color, androidx.compose.ui.geometry.Offset(7.dp.toPx(), 9.dp.toPx()), androidx.compose.ui.geometry.Offset(7.dp.toPx(), 14.dp.toPx()), stroke, cap)
        drawLine(color, androidx.compose.ui.geometry.Offset(11.dp.toPx(), 9.dp.toPx()), androidx.compose.ui.geometry.Offset(11.dp.toPx(), 14.dp.toPx()), stroke, cap)
    }
}

@Composable
internal fun SourcesContent(
    playlists: List<StoredPlaylist>,
    customOrder: List<String>,
    busyPlaylistId: String?,
    statusMessage: String?,
    firstFocusRequester: FocusRequester? = null,
    onMoveCustom: (String, Int) -> Unit,
    onOpen: (StoredPlaylist) -> Unit,
    onAdd: () -> Unit,
    onRefresh: (StoredPlaylist) -> Unit,
    onDelete: (StoredPlaylist) -> Unit,
    onEdit: (StoredPlaylist) -> Unit,
    onRename: (StoredPlaylist) -> Unit,
) {
    var filter by remember { mutableStateOf("Todos") }
    var sort by remember { mutableStateOf("Más recientes") }
    val filterOptions = tvSourceFilterOptions(playlists)
    val filtered = playlists.filter { playlist ->
        when (filter) {
            "M3U" -> playlistType(playlist) == "M3U"
            "Xtream" -> playlistType(playlist) == "Xtream"
            "Stalker" -> playlistType(playlist) == "Stalker"
            else -> true
        }
    }
    val ordered = orderTvSources(filtered, customOrder, sort)
    Row(modifier = Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
        Column(
            modifier = Modifier.width(220.dp).fillMaxSize().verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            TvScreenTitle("Fuentes")
            Text("Filtrar y ordenar playlists", color = TvMuted, fontSize = 14.sp)
            Spacer(Modifier.height(12.dp))
            Text("TIPO", color = TvMuted, fontSize = 11.sp)
            filterOptions.forEach { option ->
                TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                    onClick = { filter = option },
                    modifier = Modifier.fillMaxWidth().height(40.dp).tvDpadClick { filter = option },
                    colors = androidx.tv.material3.CardDefaults.colors(
                        containerColor = if (filter == option) tvColor(Color(0xFF304A75)) else Color.Transparent,
                        focusedContainerColor = tvColor(Color(0xFF536A9F)),
                    ),
                ) {
                    Row(modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(option, color = TvText, fontSize = 14.sp)
                        Spacer(Modifier.weight(1f))
                        Text(if (option == "Todos") playlists.size.toString() else filteredSourceCount(playlists, option).toString(), color = TvMuted, fontSize = 12.sp)
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            Text("ORDENAR", color = TvMuted, fontSize = 11.sp)
            listOf("Más recientes", "Más antiguas", "Nombre A-Z", "Nombre Z-A", "Personalizado").forEach { option ->
                TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                    onClick = { sort = option },
                    modifier = Modifier.fillMaxWidth().height(36.dp).tvDpadClick { sort = option },
                    colors = androidx.tv.material3.CardDefaults.colors(
                        containerColor = if (sort == option) tvColor(Color(0xFF304A75)) else Color.Transparent,
                        focusedContainerColor = tvColor(Color(0xFF536A9F)),
                    ),
                ) {
                    Text(option, color = TvText, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 12.dp, vertical = 9.dp))
                }
            }
            Spacer(Modifier.weight(1f))
            TvButton(
                onClick = onAdd,
                modifier = Modifier
                    .fillMaxWidth()
                    .then(firstFocusRequester?.takeIf { ordered.isEmpty() }?.let { Modifier.focusRequester(it) } ?: Modifier)
                    .tvDpadClick(onAdd),
            ) { Text("+  Añadir playlist") }
        }
        Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Todas las playlists", color = TvText, fontSize = 22.sp, fontFamily = TvType.Display)
                Text("  ${filtered.size} ${if (filtered.size == 1) "fuente" else "fuentes"}", color = TvMuted, fontSize = 13.sp)
            }
            statusMessage?.let { Text(it, color = TvMuted, fontSize = 14.sp) }
            if (ordered.isEmpty()) {
                Text("No hay fuentes en este filtro.", color = TvMuted, fontSize = 16.sp)
            } else {
                ordered.forEach { playlist ->
                    var selectedActionIndex by remember(playlist.id) { mutableStateOf(0) }
                    val sourceActions = listOf<() -> Unit>(
                        { onOpen(playlist) },
                        { if (playlistHasRefreshableSource(playlist) && busyPlaylistId == null) onRefresh(playlist) },
                        {
                            sort = sourceSortModeAfterManualMove(sort)
                            onMoveCustom(playlist.id, -1)
                        },
                        {
                            sort = sourceSortModeAfterManualMove(sort)
                            onMoveCustom(playlist.id, 1)
                        },
                        { onEdit(playlist) },
                        { onRename(playlist) },
                        { onDelete(playlist) },
                    )
                    val sourceActionLabels = listOf("↻", "↑", "↓", "✎", "Aa", "")
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(64.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(tvColor(Color(0xFF202532)))
                            .padding(horizontal = 8.dp)
                            .onPreviewKeyEvent { event ->
                                if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                                val keyCode = event.nativeKeyEvent.keyCode
                                when {
                                    keyCode == KeyEvent.KEYCODE_DPAD_RIGHT && selectedActionIndex < sourceActions.lastIndex -> {
                                        selectedActionIndex += 1
                                        true
                                    }
                                    keyCode == KeyEvent.KEYCODE_DPAD_LEFT && selectedActionIndex > 0 -> {
                                        selectedActionIndex -= 1
                                        true
                                    }
                                    isInitialTvSelect(keyCode, event.nativeKeyEvent.repeatCount) && selectedActionIndex > 0 -> {
                                        sourceActions[selectedActionIndex]()
                                        true
                                    }
                                    else -> false
                                }
                            }
                            .then(firstFocusRequester?.takeIf { ordered.firstOrNull()?.id == playlist.id }?.let { Modifier.focusRequester(it) } ?: Modifier)
                            .tvDpadClick(
                                action = { sourceActions[selectedActionIndex.coerceIn(sourceActions.indices)]() },
                                onFocusChange = { focused -> if (focused) selectedActionIndex = 0 },
                            ),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(
                            modifier = Modifier
                                .weight(1f)
                                .fillMaxHeight()
                                .padding(horizontal = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            SourceGlyph(if (playlistType(playlist) == "M3U") "M3U" else "CLOUD", tvColor(Color(0xFF6F91CE)))
                            Column(modifier = Modifier.padding(start = 14.dp).weight(1f)) {
                                Text(playlist.name, color = TvText, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(
                                    "${playlistType(playlist)} · ${playlistChannelCount(playlist)} canales",
                                    color = TvMuted,
                                    fontSize = 12.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                        sourceActionLabels.forEachIndexed { index, label ->
                                    val actionIndex = index + 1
                                    TvSourceAction(
                                        label = if (actionIndex == 1 && busyPlaylistId == playlist.id) "…" else label,
                                        enabled = actionIndex != 1 || (playlistHasRefreshableSource(playlist) && busyPlaylistId == null),
                                        selected = selectedActionIndex == actionIndex,
                                        content = if (actionIndex == 6) ({ TrashGlyph(TvText) }) else null,
                                    )
                                }
                    }
                }
            }
        }
    }
}

internal fun tvSidebarIncludesDownloads(
    section: TvSection,
    hasDownloads: Boolean,
    hasRecordings: Boolean = false,
): Boolean = hasDownloads || hasRecordings || section == TvSection.Downloads

@Composable
private fun TvSourceAction(
    label: String? = null,
    enabled: Boolean = true,
    selected: Boolean = false,
    content: (@Composable () -> Unit)? = null,
) {
    Box(
        modifier = Modifier
            .width(44.dp)
            .height(44.dp)
            .clip(RoundedCornerShape(22.dp))
            .background(if (selected) tvColor(Color(0xFF35496E)) else Color.Transparent)
            .then(if (selected) Modifier.border(2.dp, tvColor(Color(0xFF9BC4FF)), RoundedCornerShape(22.dp)) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        if (content != null) content() else Text(label.orEmpty(), color = if (enabled) TvText else TvMuted, fontSize = 20.sp)
    }
}

private fun filteredSourceCount(playlists: List<StoredPlaylist>, filter: String): Int = playlists.count { playlist ->
    when (filter) {
        "M3U" -> playlistType(playlist) == "M3U"
        "Xtream" -> playlistType(playlist) == "Xtream"
        "Stalker" -> playlistType(playlist) == "Stalker"
        else -> true
    }
}

internal fun tvSourceFilterOptions(playlists: List<StoredPlaylist>): List<String> = buildList {
    add("Todos")
    listOf("M3U", "Xtream", "Stalker")
        .filter { type -> playlists.any { playlistType(it) == type } }
        .forEach(::add)
}

private fun playlistChannelCount(playlist: StoredPlaylist): Int =
    playlist.catalogCounts?.channels ?: playlist.channels.size

private fun playlistMenuMeta(playlist: StoredPlaylist): String {
    if (playlistType(playlist) == "M3U") return "M3U · ${playlistChannelCount(playlist)} canales"
    val provider = if (playlistType(playlist) == "Xtream") "Xtream Code" else "Stalker Portal"
    val updated = playlist.importedAtMs?.let {
        SimpleDateFormat("dd/MM/yyyy, HH:mm", Locale.getDefault()).format(Date(it))
    }
    return listOfNotNull(provider, updated).joinToString(" · ")
}

private fun playlistType(playlist: StoredPlaylist): String = when {
    playlist.channels.any { it.id.startsWith("stalker:") } ||
        playlist.vod.any { it.providerType.equals("stalker", true) } ||
        playlist.series.any { it.providerType.equals("stalker", true) } -> "Stalker"
    playlist.channels.any { it.id.startsWith("xtream:") } ||
        playlist.vod.any { it.providerType.equals("xtream", true) } ||
        playlist.series.any { it.providerType.equals("xtream", true) } -> "Xtream"
    else -> "M3U"
}

private fun playlistHasTvChannels(playlist: StoredPlaylist): Boolean =
    playlist.catalogCounts?.let { it.channels > it.radio } ?: playlist.channels.any { !it.radio }

private fun isRemotePlaylistSource(url: String?): Boolean =
    url?.startsWith("http://", true) == true || url?.startsWith("https://", true) == true

private fun isLocalPlaylistFile(url: String?): Boolean =
    url?.startsWith("content://", true) == true || url?.startsWith("file://", true) == true

private fun playlistHasRefreshableSource(playlist: StoredPlaylist): Boolean =
    isRemotePlaylistSource(playlist.sourceUrl) || isLocalPlaylistFile(playlist.sourceUrl)

private fun playlistCanEditConnection(playlist: StoredPlaylist): Boolean =
    playlistType(playlist) != "M3U" || isRemotePlaylistSource(playlist.sourceUrl)

private fun playlistCanReplaceLocalFile(playlist: StoredPlaylist): Boolean =
    playlistType(playlist) == "M3U" && !isRemotePlaylistSource(playlist.sourceUrl)

@Composable
internal fun RecentContent(
    history: List<TvSavedItem>,
    favorites: List<TvSavedItem>,
    playlistNames: Map<String, String>,
    selectedPlaylistId: String?,
    searchQuery: androidx.compose.runtime.State<String>,
    sectionFilterFocusRequester: FocusRequester? = null,
    initialFocusRequester: FocusRequester,
    onToggleFavorite: (TvSavedItem, Boolean) -> Unit,
    onRemoveFromHistory: (TvSavedItem) -> Unit,
    onClearHistory: (String?) -> Unit,
    onToggleWatched: (TvSavedItem, Boolean) -> Unit,
    onItemClick: (TvSavedItem, List<TvChannelZapEntry>) -> Unit,
) {
    val context = LocalContext.current
    val collectionPreferences = remember(context) {
        context.getSharedPreferences("iptvnator-tv-ui", Context.MODE_PRIVATE)
    }
    var allPlaylists by remember(collectionPreferences) {
        mutableStateOf(loadTvCollectionScopeIsAll(collectionPreferences, TvCollectionScopeView.RECENT))
    }
    val setAllPlaylists: (Boolean) -> Unit = { all ->
        allPlaylists = all
        if (selectedPlaylistId != null) {
            saveTvCollectionScopeIsAll(collectionPreferences, TvCollectionScopeView.RECENT, all)
        }
    }
    var confirmClearHistory by remember { mutableStateOf(false) }
    var historyActionsItem by remember { mutableStateOf<TvSavedItem?>(null) }
    val hasSelectedPlaylist = selectedPlaylistId != null
    val normalizedSearchQuery = searchQuery.value.trim()
    val visibleHistory by produceState(
        initialValue = emptyList<TvSavedItem>(),
        history,
        playlistNames,
        allPlaylists,
        hasSelectedPlaylist,
        selectedPlaylistId,
        normalizedSearchQuery,
    ) {
        // Histories are intentionally unbounded for M3U/Stalker. Keep title
        // filtering off the Compose/UI dispatcher so typing stays responsive
        // even when the saved history is large.
        value = withContext(Dispatchers.Default) {
            history.filter { item ->
                val inPlaylistScope = allPlaylists || !hasSelectedPlaylist || item.playlistId == selectedPlaylistId
                inPlaylistScope && (
                    normalizedSearchQuery.isBlank() ||
                        item.title.contains(normalizedSearchQuery, ignoreCase = true)
                    )
            }
        }
    }
    val favoriteKeys = remember(favorites) {
        favorites.mapTo(HashSet()) { Triple(it.playlistId, it.itemType, it.itemKey) }
    }
    val visibleChannelZapQueue = remember(visibleHistory) {
        tvSavedChannelZapQueue(visibleHistory)
    }
    val recentPlaylistScopeFocusRequester = remember { FocusRequester() }
    val recentAllScopeFocusRequester = remember { FocusRequester() }
    val firstHistoryFocusRequester = initialFocusRequester
    LaunchedEffect(history.size, hasSelectedPlaylist, allPlaylists) {
        // Filtering must not steal focus from the header field as its result
        // count changes. Only initial data/scope changes establish list focus.
        if (normalizedSearchQuery.isNotBlank()) return@LaunchedEffect
        if (visibleHistory.isNotEmpty()) {
            delay(100)
            firstHistoryFocusRequester.requestFocus()
        } else if (hasSelectedPlaylist) {
            // With no history rows, keep the section's D-pad entry target on
            // the scope selector instead of leaving focus on a removed row or
            // relying on the parent route's previous focus owner.
            delay(100)
            recentPlaylistScopeFocusRequester.requestFocus()
        }
    }
    Row(modifier = Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
        Column(
            modifier = Modifier.width(300.dp).fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                TvScreenTitle("Recientemente visto")
                Spacer(Modifier.weight(1f))
                if (visibleHistory.isNotEmpty()) {
                    TvCard(
                        onClick = { confirmClearHistory = true },
                        modifier = Modifier.size(40.dp).tvDpadClick { confirmClearHistory = true },
                        colors = androidx.tv.material3.CardDefaults.colors(
                            containerColor = Color.Transparent,
                            focusedContainerColor = tvColor(Color(0xFF536A9F)),
                        ),
                    ) {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text("▤", color = TvMuted, fontSize = 22.sp)
                        }
                    }
                }
            }
            if (hasSelectedPlaylist) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(false to "Esta playlist", true to "Todas las playlists").forEachIndexed { index, (all, label) ->
                        Row(
                            modifier = Modifier
                                .weight(1f)
                                .height(34.dp)
                                .clip(RoundedCornerShape(50))
                                .background(
                                    if (allPlaylists == all) tvColor(Color(0xFF304A75)) else tvColor(Color(0xFF202532)),
                                )
                                .then(
                                    when {
                                        index == 0 && visibleHistory.isEmpty() -> {
                                            Modifier.focusRequester(recentPlaylistScopeFocusRequester)
                                        }
                                        index == 1 -> Modifier.focusRequester(recentAllScopeFocusRequester)
                                        else -> Modifier
                                    },
                                )
                                .focusProperties {
                                    if (index == 0) right = recentAllScopeFocusRequester
                                }
                                .onPreviewKeyEvent { event ->
                                    if (event.type == KeyEventType.KeyDown &&
                                        isInitialTvSelect(
                                            event.nativeKeyEvent.keyCode,
                                            event.nativeKeyEvent.repeatCount,
                                        )
                                    ) {
                                        setAllPlaylists(all)
                                        true
                                    } else {
                                        false
                                    }
                                }
                                .tvDpadClick { setAllPlaylists(all) }
                                .padding(horizontal = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center,
                        ) {
                            Text(label, color = TvText, fontSize = 11.sp, maxLines = 1)
                        }
                    }
                }
            }
            LazyColumn(
                modifier = Modifier.fillMaxWidth().weight(1f),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                items(
                    items = visibleHistory,
                    key = { Triple(it.playlistId, it.itemType, it.itemKey) },
                ) { item ->
                    val isFirstHistoryItem = item == visibleHistory.firstOrNull()
                    val rowFocusRequester = if (isFirstHistoryItem) {
                        firstHistoryFocusRequester
                    } else {
                        remember(item.playlistId, item.itemType, item.itemKey) { FocusRequester() }
                    }
                    val favoriteFocusRequester = remember(item.playlistId, item.itemType, item.itemKey) { FocusRequester() }
                    val actionsFocusRequester = remember(item.playlistId, item.itemType, item.itemKey) { FocusRequester() }
                    val isFavorite = Triple(item.playlistId, item.itemType, item.itemKey) in favoriteKeys
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(58.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(tvColor(Color(0xFF202532)))
                            .padding(horizontal = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(
                            modifier = Modifier
                                .weight(1f)
                                .fillMaxHeight()
                                .focusRequester(rowFocusRequester)
                                .focusProperties {
                                    right = favoriteFocusRequester
                                    if (isFirstHistoryItem && sectionFilterFocusRequester != null) {
                                        up = sectionFilterFocusRequester
                                    }
                                }
                                .tvDpadClick { onItemClick(item, visibleChannelZapQueue) },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(modifier = Modifier.width(38.dp).height(38.dp).clip(RoundedCornerShape(6.dp)).background(tvColor(Color(0xFF29334B))), contentAlignment = Alignment.Center) {
                                item.coverUrl?.takeIf(String::isNotBlank)?.let { url ->
                                    AsyncImage(model = url, contentDescription = item.title, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                                } ?: Text(if (item.itemType == com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL) "TV" else "▶", color = tvColor(Color(0xFF6F91CE)), fontSize = 12.sp)
                            }
                            Column(modifier = Modifier.padding(start = 9.dp).weight(1f)) {
                                Text(item.title, color = TvText, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(
                                    buildString {
                                        append(playlistNames[item.playlistId] ?: "Fuente desconocida")
                                        append(" · ")
                                        append(if (item.resumePositionMs > 0) "Continuar · ${formatResumePosition(item.resumePositionMs)}" else "Sin información de programa")
                                    },
                                    color = TvMuted,
                                    fontSize = 10.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                        TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                                onClick = { onToggleFavorite(item, !isFavorite) },
                                modifier = Modifier
                                    .width(32.dp)
                                    .height(32.dp)
                                    .focusRequester(favoriteFocusRequester)
                                    .focusProperties { left = rowFocusRequester; right = actionsFocusRequester }
                                    .tvDpadClick { onToggleFavorite(item, !isFavorite) },
                                colors = androidx.tv.material3.CardDefaults.colors(
                                    containerColor = Color.Transparent,
                                    focusedContainerColor = tvColor(Color(0xFF536A9F)),
                                ),
                            ) {
                                Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                                    Text(if (isFavorite) "★" else "☆", color = if (isFavorite) tvColor(Color(0xFFFFD166)) else TvMuted, fontSize = 18.sp)
                                }
                            }
                        TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                                onClick = { historyActionsItem = item },
                                modifier = Modifier
                                    .width(32.dp)
                                    .height(32.dp)
                                    .focusRequester(actionsFocusRequester)
                                    .focusProperties { left = favoriteFocusRequester }
                                    .tvDpadClick { historyActionsItem = item },
                                colors = androidx.tv.material3.CardDefaults.colors(
                                    containerColor = Color.Transparent,
                                    focusedContainerColor = tvColor(Color(0xFF536A9F)),
                                ),
                        ) {
                            Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                                Text("⋮", color = TvMuted, fontSize = 18.sp)
                            }
                        }
                    }
                }
                if (visibleHistory.isEmpty()) {
                    item(key = "recent-history-empty") {
                        Text(
                            if (normalizedSearchQuery.isNotBlank()) {
                                "Sin coincidencias para «${searchQuery.value}»."
                            } else {
                                "Aún no hay historial."
                            },
                            color = TvMuted,
                            fontSize = 15.sp,
                        )
                    }
                }
            }
        }
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            TvPlayerStandby(
                "Selecciona un canal para iniciar la reproducción",
                modifier = Modifier.widthIn(max = 520.dp).padding(horizontal = 24.dp),
                hints = listOf("OK" to "Reproducir", "▲▼" to "Recorrer"),
            )
        }
    }
    if (confirmClearHistory) {
        val clearHistory = {
            onClearHistory(if (allPlaylists || !hasSelectedPlaylist) null else selectedPlaylistId)
            confirmClearHistory = false
        }
        TvAlertDialog(
            onDismissRequest = { confirmClearHistory = false },
            title = { Text("Borrar historial") },
            text = { Text(if (allPlaylists || !hasSelectedPlaylist) "¿Quieres borrar todo el historial reciente? Los favoritos y el estado de visto se conservarán." else "¿Quieres borrar el historial reciente de esta playlist? Los favoritos y el estado de visto se conservarán.") },
            confirmButton = {
                TvButton(onClick = clearHistory, modifier = Modifier.tvDpadClick(clearHistory)) { Text("Borrar") }
            },
            dismissButton = {
                TvTextButton(onClick = { confirmClearHistory = false }, modifier = Modifier.tvDpadClick { confirmClearHistory = false }) { Text("Cancelar") }
            },
        )
    }
    historyActionsItem?.let { item ->
        TvAlertDialog(
            onDismissRequest = { historyActionsItem = null },
            title = { Text(item.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            text = { Text("Acciones del historial") },
            confirmButton = {
                TvTextButton(
                    onClick = {
                        onToggleWatched(item, !item.isWatched)
                        historyActionsItem = null
                    },
                    modifier = Modifier.tvDpadClick {
                        onToggleWatched(item, !item.isWatched)
                        historyActionsItem = null
                    },
                ) { Text(if (item.isWatched) "Marcar como no visto" else "Marcar como visto") }
            },
            dismissButton = {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TvTextButton(
                        onClick = {
                            onRemoveFromHistory(item)
                            historyActionsItem = null
                        },
                        modifier = Modifier.tvDpadClick {
                            onRemoveFromHistory(item)
                            historyActionsItem = null
                        },
                    ) { Text("Quitar de recientes") }
                    TvTextButton(
                        onClick = { historyActionsItem = null },
                        modifier = Modifier.tvDpadClick { historyActionsItem = null },
                    ) { Text("Cancelar") }
                }
            },
        )
    }
}

@Composable
private fun TvPlaylistMenu(
    playlists: List<StoredPlaylist>,
    selectedPlaylistId: String?,
    onSelect: (String) -> Unit,
    onDismiss: () -> Unit,
    onAdd: () -> Unit,
    onRename: (StoredPlaylist) -> Unit,
    onEdit: (StoredPlaylist) -> Unit,
    onDelete: (StoredPlaylist) -> Unit,
    onInfo: () -> Unit,
    onAccountInfo: (StoredPlaylist) -> Unit,
) {
    val context = LocalContext.current
    var showSearch by remember { mutableStateOf(false) }
    // The OK key-up that opened the menu lands on its first row; ignore
    // activations briefly so it does not immediately select and close.
    val openedAt = remember { android.os.SystemClock.uptimeMillis() }
    fun ready() = android.os.SystemClock.uptimeMillis() - openedAt > 400
    val menuPreferences = remember(context) {
        context.getSharedPreferences("tv_playlist_menu", Context.MODE_PRIVATE)
    }
    // The original drawer opens with the complete source list each time. A
    // stale query persisted across sessions could make playlists and their
    // type tags appear to have disappeared without any visible filter state.
    var query by remember { mutableStateOf("") }
    var actionPlaylist by remember { mutableStateOf<StoredPlaylist?>(null) }
    val availableTypes = remember(playlists) {
        listOf("M3U", "Stalker", "Xtream").filter { type ->
            playlists.any { playlistType(it) == type }
        }
    }
    var enabledTypes by remember(availableTypes) {
        val stored = menuPreferences.getStringSet("enabled_types", emptySet()).orEmpty()
        mutableStateOf((stored intersect availableTypes.toSet()).ifEmpty { availableTypes.toSet() })
    }
    val visible = playlists.filter { playlist ->
        (availableTypes.size <= 1 || playlistType(playlist) in enabledTypes) &&
            (query.isBlank() || playlist.name.contains(query.trim(), ignoreCase = true))
    }
    val selectedPlaylist = playlists.firstOrNull { it.id == selectedPlaylistId }
    val initialPlaylistId = visible.firstOrNull { it.id == selectedPlaylistId }?.id
        ?: visible.firstOrNull()?.id
    val firstPlaylistFocusRequester = remember { FocusRequester() }
    val playlistSearchFocusRequester = remember { FocusRequester() }
    val addPlaylistFocusRequester = remember { FocusRequester() }
    val playlistRowFocusRequesters = remember(visible.map { it.id }) {
        visible.map { FocusRequester() }
    }
    val playlistActionFocusRequesters = remember(visible.map { it.id }) {
        visible.map { FocusRequester() }
    }
    val actionDialogFocusRequester = remember(actionPlaylist?.id) { FocusRequester() }
    LaunchedEffect(Unit) {
        delay(100)
        val target = visible.firstOrNull { it.id == selectedPlaylistId } ?: visible.firstOrNull()
        if (target != null) firstPlaylistFocusRequester.requestFocus()
        else addPlaylistFocusRequester.requestFocus()
    }
    LaunchedEffect(actionPlaylist?.id) {
        if (actionPlaylist != null) {
            delay(100)
            actionDialogFocusRequester.requestFocus()
        }
    }
    LaunchedEffect(showSearch) {
        if (showSearch) {
            delay(100)
            playlistSearchFocusRequester.requestFocus()
        }
    }
    Surface(
        modifier = Modifier
            .padding(start = 18.dp, top = 58.dp)
            .width(300.dp)
            .clip(RoundedCornerShape(18.dp))
            .tvHairline(tvTone(TvTone.SurfaceTop), 18f),
        colors = androidx.tv.material3.SurfaceDefaults.colors(containerColor = tvTone(TvTone.SurfaceHigh)),
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                TvEyebrow("Mis playlists", color = TvMuted)
                Spacer(Modifier.weight(1f))
                Text(
                    "⌕",
                    color = if (showSearch) tvColor(Color(0xFF9CC1FF)) else TvMuted,
                    fontSize = 16.sp,
                    modifier = Modifier.tvDpadClick { showSearch = !showSearch },
                )
            }
            if (showSearch) {
                TvOutlinedTextField(
                    value = query,
                    onValueChange = {
                        query = it
                    },
                    label = { Text("Buscar playlist") },
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp)
                        .focusRequester(playlistSearchFocusRequester)
                        .focusProperties {
                            down = if (visible.isNotEmpty()) firstPlaylistFocusRequester else addPlaylistFocusRequester
                        },
                )
            }
            if (availableTypes.size > 1) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    availableTypes.forEach { option ->
                        val selected = option in enabledTypes
                        val toggle = {
                            val next = if (selected && enabledTypes.size > 1) {
                                enabledTypes - option
                            } else if (selected) {
                                availableTypes.toSet()
                            } else {
                                enabledTypes + option
                            }
                            enabledTypes = next
                            menuPreferences.edit().putStringSet("enabled_types", next).apply()
                        }
                    TvCard(
                        onClick = toggle,
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                        modifier = Modifier.height(26.dp).tvDpadClick(toggle),
                        colors = androidx.tv.material3.CardDefaults.colors(
                            containerColor = if (selected) tvTone(TvTone.Selected) else tvTone(TvTone.SurfaceTop),
                            focusedContainerColor = tvTone(TvTone.Focused),
                        ),
                    ) {
                        Box(Modifier.fillMaxHeight().padding(horizontal = 11.dp), contentAlignment = Alignment.Center) {
                            Text(
                                option,
                                color = if (selected) tvTone(TvTone.Accent) else TvMuted,
                                fontFamily = TvType.BodyMedium,
                                fontSize = 9.sp,
                            )
                        }
                    }
                    }
                }
            }
            visible.forEachIndexed { index, playlist ->
                val rowFocusRequester = playlistRowFocusRequesters.getOrNull(index)
                val actionFocusRequester = playlistActionFocusRequesters.getOrNull(index)
                TvCard(
                    onClick = { if (ready()) onSelect(playlist.id) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(45.dp)
                        .then(rowFocusRequester?.let { Modifier.focusRequester(it) } ?: Modifier)
                        .then(if (playlist.id == initialPlaylistId) Modifier.focusRequester(firstPlaylistFocusRequester) else Modifier)
                        .focusProperties {
                            if (playlist.id == initialPlaylistId && showSearch) up = playlistSearchFocusRequester
                            if (actionFocusRequester != null) right = actionFocusRequester
                            if (index > 0) up = playlistRowFocusRequesters[index - 1]
                            if (index < visible.lastIndex) down = playlistRowFocusRequesters[index + 1]
                        }
                        .tvDpadClick { if (ready()) onSelect(playlist.id) },
                    shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(12.dp)),
                    colors = androidx.tv.material3.CardDefaults.colors(
                        containerColor = if (playlist.id == selectedPlaylistId) tvTone(TvTone.Selected) else Color.Transparent,
                        focusedContainerColor = tvTone(TvTone.Focused),
                    ),
                ) {
                    Row(modifier = Modifier.fillMaxSize().padding(horizontal = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                        SourceGlyph(if (playlistType(playlist) == "M3U") "M3U" else "CLOUD", if (playlist.id == selectedPlaylistId) tvTone(TvTone.Accent) else TvMuted)
                        Column(modifier = Modifier.padding(start = 8.dp).weight(1f)) {
                            Text(playlist.name, color = TvText, fontSize = 11.sp, maxLines = 1)
                            Text(playlistMenuMeta(playlist), color = TvMuted, fontSize = 8.sp, maxLines = 1)
                        }
                        Box(
                            modifier = Modifier
                                .width(28.dp)
                                .height(36.dp)
                                .then(actionFocusRequester?.let { Modifier.focusRequester(it) } ?: Modifier)
                                .focusProperties {
                                    rowFocusRequester?.let { left = it }
                                    if (index > 0) up = playlistActionFocusRequesters[index - 1]
                                    if (index < visible.lastIndex) down = playlistActionFocusRequesters[index + 1]
                                }
                                .tvDpadClick { if (ready()) actionPlaylist = playlist },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("⋮", color = TvMuted, fontSize = 16.sp)
                        }
                    }
                }
            }
            if (playlists.isEmpty()) Text("No hay playlists todavía", color = TvMuted, fontSize = 11.sp)
            TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                onClick = { if (ready()) onAdd() },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(38.dp)
                    .focusRequester(addPlaylistFocusRequester)
                    .tvDpadClick { if (ready()) onAdd() },
                colors = androidx.tv.material3.CardDefaults.colors(
                    containerColor = Color.Transparent,
                    focusedContainerColor = tvColor(Color(0xFF30405D)),
                ),
            ) { Text("＋  Añadir playlist", color = TvText, fontSize = 11.sp, modifier = Modifier.padding(horizontal = 9.dp, vertical = 10.dp)) }
            TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                onClick = onInfo,
                modifier = Modifier.fillMaxWidth().height(34.dp).tvDpadClick(onInfo),
                colors = androidx.tv.material3.CardDefaults.colors(containerColor = Color.Transparent, focusedContainerColor = tvColor(Color(0xFF30405D))),
            ) { Text("ⓘ  Información de playlist", color = TvMuted, fontSize = 10.sp, modifier = Modifier.padding(horizontal = 9.dp, vertical = 9.dp)) }
            if (selectedPlaylist != null && playlistType(selectedPlaylist) != "M3U") {
                TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                    onClick = { onAccountInfo(selectedPlaylist) },
                    modifier = Modifier.fillMaxWidth().height(34.dp).tvDpadClick { onAccountInfo(selectedPlaylist) },
                    colors = androidx.tv.material3.CardDefaults.colors(
                        containerColor = Color.Transparent,
                        focusedContainerColor = tvColor(Color(0xFF30405D)),
                    ),
                ) {
                    Text("♙  Información de cuenta", color = TvMuted, fontSize = 10.sp, modifier = Modifier.padding(horizontal = 9.dp, vertical = 9.dp))
                }
            }
        }
    }
    actionPlaylist?.let { playlist ->
        val firstAction = when {
            playlistType(playlist) != "M3U" -> "account"
            playlistCanEditConnection(playlist) || playlistCanReplaceLocalFile(playlist) -> "edit"
            else -> "rename"
        }
        TvAlertDialog(
            onDismissRequest = { actionPlaylist = null },
            title = { Text(playlist.name) },
            text = { Text("Gestiona esta playlist") },
            confirmButton = {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (playlistType(playlist) != "M3U") {
                        TvButton(
                            onClick = {
                                actionPlaylist = null
                                onAccountInfo(playlist)
                            },
                            modifier = Modifier.fillMaxWidth()
                                .then(if (firstAction == "account") Modifier.focusRequester(actionDialogFocusRequester) else Modifier)
                                .tvDpadClick {
                                actionPlaylist = null
                                onAccountInfo(playlist)
                            },
                        ) { Text("Cuenta") }
                    }
                    if (playlistCanEditConnection(playlist) || playlistCanReplaceLocalFile(playlist)) {
                        TvButton(
                            onClick = {
                                actionPlaylist = null
                                onEdit(playlist)
                            },
                            modifier = Modifier.fillMaxWidth()
                                .then(if (firstAction == "edit") Modifier.focusRequester(actionDialogFocusRequester) else Modifier)
                                .tvDpadClick {
                                actionPlaylist = null
                                onEdit(playlist)
                            },
                        ) { Text(if (playlistCanReplaceLocalFile(playlist)) "Seleccionar archivo" else "Editar") }
                    }
                    TvButton(
                        onClick = {
                            actionPlaylist = null
                            onRename(playlist)
                        },
                        modifier = Modifier.fillMaxWidth()
                            .then(if (firstAction == "rename") Modifier.focusRequester(actionDialogFocusRequester) else Modifier)
                            .tvDpadClick {
                            actionPlaylist = null
                            onRename(playlist)
                        },
                    ) { Text("Renombrar") }
                    TvButton(
                        onClick = {
                            actionPlaylist = null
                            onDelete(playlist)
                        },
                        modifier = Modifier.fillMaxWidth().tvDpadClick {
                            actionPlaylist = null
                            onDelete(playlist)
                        },
                    ) { Text("Eliminar") }
                    TvButton(
                        onClick = { actionPlaylist = null },
                        modifier = Modifier.fillMaxWidth().tvDpadClick { actionPlaylist = null },
                    ) { Text("Cancelar") }
                }
            },
        )
    }
}

@Composable
private fun TvTopBar(
    playlists: List<StoredPlaylist>,
    selectedPlaylistId: String?,
    selectedSection: TvSection,
    sectionSearchQuery: androidx.compose.runtime.MutableState<String>?,
    sectionFilterFocusRequester: FocusRequester,
    initialFocusRequester: FocusRequester,
    leftFocusRequester: FocusRequester,
    onPlaylistMenu: () -> Unit,
    onSearchSubmit: (String) -> Unit,
    onDownloads: () -> Unit,
    onAddPlaylist: () -> Unit,
) {
    val selectedPlaylist = playlists.firstOrNull { it.id == selectedPlaylistId } ?: playlists.firstOrNull()
    var searchActive by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }
    val isFilteringSection = selectedSection == TvSection.Recent || selectedSection == TvSection.Favorites
    val visibleSearchQuery = if (isFilteringSection) sectionSearchQuery?.value.orEmpty() else searchQuery
    val searchPlaceholder = if (isFilteringSection) "Filtrar esta sección…" else "Buscar en todas las playlists…"
    val searchFocusRequester = remember { FocusRequester() }
    BackHandler(enabled = searchActive) {
        searchActive = false
        searchQuery = ""
        if (isFilteringSection) sectionSearchQuery?.value = ""
    }
    LaunchedEffect(selectedSection) {
        searchActive = false
        searchQuery = ""
    }
    LaunchedEffect(searchActive) {
        if (searchActive) {
            (if (isFilteringSection) sectionFilterFocusRequester else searchFocusRequester).requestFocus()
        }
    }
    val pillShape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50))
    val noScale = androidx.tv.material3.CardDefaults.scale(focusedScale = 1f)
    val chipColors = androidx.tv.material3.CardDefaults.colors(
        containerColor = tvTone(TvTone.Surface).copy(alpha = 0.88f),
        focusedContainerColor = tvTone(TvTone.Focused),
    )
    val iconColors = androidx.tv.material3.CardDefaults.colors(
        containerColor = Color.Transparent,
        focusedContainerColor = tvTone(TvTone.Focused),
    )
    androidx.compose.runtime.CompositionLocalProvider(LocalTvFocusRadius provides 999.dp) {
    Row(
        modifier = Modifier.fillMaxWidth().height(60.dp).padding(start = 18.dp, end = 22.dp, top = 10.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        TvCard(
            onClick = onPlaylistMenu,
            modifier = Modifier
                .widthIn(min = 150.dp, max = 210.dp)
                .height(40.dp)
                .focusRequester(initialFocusRequester)
                .focusProperties { left = leftFocusRequester }
                .tvDpadClick(onPlaylistMenu),
            shape = pillShape,
            scale = noScale,
            colors = chipColors,
        ) {
            Row(modifier = Modifier.fillMaxHeight().padding(start = 5.dp, end = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier
                        .width(30.dp)
                        .height(30.dp)
                        .background(tvTone(TvTone.Accent).copy(alpha = 0.16f), RoundedCornerShape(50)),
                    contentAlignment = Alignment.Center,
                ) {
                    SourceGlyph(
                        if (selectedPlaylist?.let(::playlistType) == "M3U") "M3U" else "CLOUD",
                        tvTone(TvTone.Accent),
                        Modifier.width(17.dp).height(17.dp),
                    )
                }
                Column(modifier = Modifier.padding(start = 9.dp).weight(1f, fill = false)) {
                    Text(
                        selectedPlaylist?.name ?: "Sin fuente",
                        color = tvTone(TvTone.Text),
                        fontFamily = TvType.BodyMedium,
                        fontSize = 11.sp,
                        lineHeight = 13.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        "${selectedPlaylist?.let(::playlistChannelCount) ?: 0} canales · ${selectedPlaylist?.let(::playlistType) ?: "—"}",
                        color = tvTone(TvTone.Muted),
                        fontSize = 8.sp,
                        lineHeight = 10.sp,
                        maxLines = 1,
                    )
                }
                TvChevronDown(tvTone(TvTone.Muted), Modifier.padding(start = 10.dp))
            }
        }
        if (searchActive) {
            TvOutlinedTextField(
                value = visibleSearchQuery,
                onValueChange = {
                    searchQuery = it
                    if (isFilteringSection) sectionSearchQuery?.value = it
                },
                placeholder = { Text(searchPlaceholder, color = TvMuted, fontSize = 10.sp) },
                leadingIcon = { SidebarGlyph(if (isFilteringSection) selectedSection else TvSection.Search, tvTone(TvTone.Accent)) },
                trailingIcon = { Text("OK", color = TvMuted, fontSize = 8.sp) },
                singleLine = true,
                shape = RoundedCornerShape(50),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = {
                    if (isFilteringSection) {
                        searchActive = false
                    } else {
                        onSearchSubmit(searchQuery)
                        searchActive = false
                    }
                }),
                modifier = Modifier
                    .weight(1f)
                    .height(40.dp)
                    .focusRequester(if (isFilteringSection) sectionFilterFocusRequester else searchFocusRequester),
            )
        } else {
            TvCard(
                onClick = { searchActive = true },
                modifier = Modifier
                    .weight(1f)
                    .height(36.dp)
                    .focusRequester(if (isFilteringSection) sectionFilterFocusRequester else searchFocusRequester)
                    .tvDpadClick { searchActive = true },
                shape = pillShape,
                scale = noScale,
                colors = chipColors,
            ) {
                Row(modifier = Modifier.fillMaxSize().padding(start = 14.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    SidebarGlyph(if (isFilteringSection) selectedSection else TvSection.Search, tvTone(TvTone.Muted))
                    Text(
                        if (isFilteringSection && sectionSearchQuery?.value?.isNotBlank() == true) sectionSearchQuery.value else searchPlaceholder,
                        color = if (isFilteringSection && sectionSearchQuery?.value?.isNotBlank() == true) TvText else TvMuted,
                        fontSize = 10.sp,
                        maxLines = 1,
                        modifier = Modifier.padding(start = 9.dp),
                    )
                    Spacer(Modifier.weight(1f))
                    Box(
                        Modifier
                            .background(tvTone(TvTone.SurfaceTop), RoundedCornerShape(6.dp))
                            .padding(horizontal = 7.dp, vertical = 2.dp),
                    ) {
                        Text("OK", color = tvTone(TvTone.TextSoft), fontFamily = TvType.BodyMedium, fontSize = 7.sp, lineHeight = 9.sp, letterSpacing = 0.8.sp)
                    }
                }
            }
        }
        TvCard(
            onClick = { searchActive = true },
            modifier = Modifier.width(36.dp).height(36.dp).tvDpadClick { searchActive = true },
            shape = pillShape,
            scale = noScale,
            colors = iconColors,
        ) {
            Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                KeyboardGlyph(tvTone(TvTone.TextSoft))
            }
        }
        TvCard(
            onClick = onAddPlaylist,
            modifier = Modifier.width(36.dp).height(36.dp).tvDpadClick(onAddPlaylist),
            shape = pillShape,
            scale = noScale,
            colors = androidx.tv.material3.CardDefaults.colors(
                containerColor = tvTone(TvTone.Accent).copy(alpha = 0.14f),
                focusedContainerColor = tvTone(TvTone.Focused),
            ),
        ) { Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) { Text("+", color = tvTone(TvTone.Accent), fontSize = 19.sp, lineHeight = 20.sp) } }
        TvCard(
            onClick = onDownloads,
            modifier = Modifier.width(36.dp).height(36.dp).tvDpadClick(onDownloads),
            shape = pillShape,
            scale = noScale,
            colors = iconColors,
        ) {
            Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                SidebarGlyph(TvSection.Downloads, tvTone(TvTone.TextSoft))
            }
        }
        TvClock(Modifier.padding(start = 6.dp))
    }
    }
}

@Composable
internal fun TvChevronDown(color: Color, modifier: Modifier = Modifier) {
    Canvas(modifier.width(10.dp).height(6.dp)) {
        val stroke = 1.8.dp.toPx()
        drawLine(color, androidx.compose.ui.geometry.Offset(stroke, stroke), androidx.compose.ui.geometry.Offset(size.width / 2f, size.height - stroke / 2f), stroke, StrokeCap.Round)
        drawLine(color, androidx.compose.ui.geometry.Offset(size.width / 2f, size.height - stroke / 2f), androidx.compose.ui.geometry.Offset(size.width - stroke, stroke), stroke, StrokeCap.Round)
    }
}

/** Wall clock in the top bar; a TV UI without a clock hides how late the film is running. */
@Composable
private fun TvClock(modifier: Modifier = Modifier) {
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            delay(60_000L - now % 60_000L)
        }
    }
    val formatter = remember { java.text.SimpleDateFormat("HH:mm", Locale.getDefault()) }
    Text(
        formatter.format(java.util.Date(now)),
        modifier = modifier,
        color = tvTone(TvTone.Text),
        fontFamily = TvType.DisplayMedium,
        fontSize = 17.sp,
        letterSpacing = 0.5.sp,
    )
}

@Composable
private fun SearchContent(
    playlists: List<StoredPlaylist>,
    repository: TvPlaylistRepository,
    initialQuery: String = "",
    stripCountryPrefixes: Boolean = false,
    onPlay: (String, TvChannel, List<TvChannelZapEntry>) -> Unit,
    onPlayVod: (String, TvVodItem) -> Unit,
    onOpenSeries: (String, TvSeriesItem) -> Unit,
) {
    var query by remember(initialQuery) { mutableStateOf(initialQuery) }
    var includeLive by remember { mutableStateOf(true) }
    var includeMovies by remember { mutableStateOf(false) }
    var includeSeries by remember { mutableStateOf(false) }
    var visibleCategoriesOnly by remember { mutableStateOf(false) }
    var excludeHiddenGroups by remember { mutableStateOf(false) }
    var groupByPlaylist by remember { mutableStateOf(true) }
    var searchedVod by remember { mutableStateOf<Map<String, List<TvVodItem>>>(emptyMap()) }
    var searchedSeries by remember { mutableStateOf<Map<String, List<TvSeriesItem>>>(emptyMap()) }
    var searchedChannels by remember { mutableStateOf<Map<String, List<TvChannel>>>(emptyMap()) }
    val queryFocusRequester = remember { FocusRequester() }
    val toggleFocusRequesters = remember { List(6) { FocusRequester() } }
    val resultsFocusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        // Let the section transition finish before taking focus from the
        // shared toolbar and putting it where Search is immediately usable.
        delay(300)
        queryFocusRequester.requestFocus()
    }
    LaunchedEffect(query.trim(), playlists.map { it.id }) {
        val normalized = query.trim()
        if (normalized.length < 2) {
            searchedChannels = emptyMap()
            searchedVod = emptyMap()
            searchedSeries = emptyMap()
        } else {
            val ids = playlists.map { it.id }
            searchedChannels = withContext(Dispatchers.IO) {
                ids.associateWith { repository.searchChannels(it, normalized) }
            }
            searchedVod = withContext(Dispatchers.IO) {
                ids.associateWith { repository.searchVod(it, normalized) }
            }
            searchedSeries = withContext(Dispatchers.IO) {
                ids.associateWith { repository.searchSeries(it, normalized) }
            }
        }
    }
    val allResults = if (query.trim().length >= 2) {
        searchPlaylists(
            playlists,
            query,
            searchedChannels,
            searchedVod,
            searchedSeries,
            excludeHiddenGroups = excludeHiddenGroups,
        )
    } else {
        emptyList()
    }
    val enabledTypes = buildSet {
        if (includeLive) add(TvSearchResultType.CHANNEL)
        if (includeMovies) add(TvSearchResultType.VOD)
        if (includeSeries) add(TvSearchResultType.SERIES)
    }
    val results = allResults.filter { result ->
        result.type in enabledTypes &&
            (!visibleCategoriesOnly || result.hasCategory)
    }.let { matching ->
        if (groupByPlaylist) matching.sortedWith(compareBy<TvSearchResult> { it.subtitle.lowercase() }.thenBy { it.title.lowercase() })
        else matching.sortedWith(compareBy<TvSearchResult> { it.title.lowercase() })
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        TvScreenTitle("Buscar")
        Text("La búsqueda global incluye todas tus fuentes IPTV", color = TvMuted, fontSize = 14.sp)
        TvOutlinedTextField(
            value = query,
            onValueChange = { query = it },
            label = { Text("Buscar en todas las playlists") },
            textStyle = LocalTextStyle.current.copy(fontSize = 14.sp, color = TvText),
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            modifier = Modifier
                .fillMaxWidth()
                .focusRequester(queryFocusRequester)
                .focusProperties { down = toggleFocusRequesters.first() }
                .onPreviewKeyEvent { event ->
                    if (event.type == KeyEventType.KeyDown &&
                        event.nativeKeyEvent.keyCode == KeyEvent.KEYCODE_DPAD_DOWN
                    ) {
                        toggleFocusRequesters.first().requestFocus()
                        true
                    } else {
                        false
                    }
                },
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SearchToggle(
                "TV en directo", includeLive, { includeLive = !includeLive },
                requester = toggleFocusRequesters[0],
                up = queryFocusRequester,
                right = toggleFocusRequesters[1],
                down = resultsFocusRequester.takeIf { results.isNotEmpty() },
            )
            SearchToggle(
                "Películas", includeMovies, { includeMovies = !includeMovies },
                requester = toggleFocusRequesters[1],
                up = queryFocusRequester,
                left = toggleFocusRequesters[0], right = toggleFocusRequesters[2],
                down = resultsFocusRequester.takeIf { results.isNotEmpty() },
            )
            SearchToggle(
                "Series", includeSeries, { includeSeries = !includeSeries },
                requester = toggleFocusRequesters[2],
                up = queryFocusRequester,
                left = toggleFocusRequesters[1], right = toggleFocusRequesters[3],
                down = resultsFocusRequester.takeIf { results.isNotEmpty() },
            )
            SearchToggle(
                "Solo categorías", visibleCategoriesOnly, { visibleCategoriesOnly = !visibleCategoriesOnly },
                requester = toggleFocusRequesters[3],
                up = queryFocusRequester,
                left = toggleFocusRequesters[2], right = toggleFocusRequesters[4],
                down = resultsFocusRequester.takeIf { results.isNotEmpty() },
            )
            SearchToggle(
                "Excluir grupos ocultos", excludeHiddenGroups, { excludeHiddenGroups = !excludeHiddenGroups },
                requester = toggleFocusRequesters[4],
                up = queryFocusRequester,
                left = toggleFocusRequesters[3], right = toggleFocusRequesters[5],
                down = resultsFocusRequester.takeIf { results.isNotEmpty() },
            )
            SearchToggle(
                "Agrupar por fuente", groupByPlaylist, { groupByPlaylist = !groupByPlaylist },
                requester = toggleFocusRequesters[5],
                up = queryFocusRequester,
                left = toggleFocusRequesters[4],
                down = resultsFocusRequester.takeIf { results.isNotEmpty() },
            )
        }
        when {
            query.isBlank() -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                TvEmptyState(
                    title = "Buscar contenido",
                    message = "Escribe al menos 2 caracteres para buscar en tus fuentes.",
                    glyph = TvSection.Search,
                    modifier = Modifier.padding(bottom = 60.dp),
                )
            }
            query.trim().length < 2 -> TvEmptyState("Sigue escribiendo", "Escribe al menos 2 caracteres para buscar.", TvSection.Search)
            results.isEmpty() -> TvEmptyState("Sin resultados", "Prueba con otro nombre o activa más tipos de contenido.", TvSection.Search)
            else -> {
                TvRailTitle("Resultados · ${if (groupByPlaylist) "agrupados por fuente" else "todas las fuentes"}", results.size)
                TvRail(
                    // Search is already bounded per source/type at the SQLite
                    // boundary. Do not hide valid matches again at the TV UI;
                    // TvRail is lazy and keeps D-pad traversal available for
                    // the complete result set.
                    items = results.map {
                        val title = if (it.type == TvSearchResultType.CHANNEL) {
                            displayTvChannelName(it.title, stripCountryPrefixes)
                        } else it.title
                        "$title · ${it.subtitle}"
                    },
                    initialFocusRequester = resultsFocusRequester,
                    onItemClick = { index ->
                        results.getOrNull(index)?.let { result ->
                            when (result.type) {
                                TvSearchResultType.CHANNEL -> result.channel?.let { channel ->
                                    val zapQueue = tvSearchChannelZapQueue(results)
                                    onPlay(result.playlistId, channel, zapQueue)
                                }
                                TvSearchResultType.VOD -> result.vod?.let { onPlayVod(result.playlistId, it) }
                                TvSearchResultType.SERIES -> result.series?.let { onOpenSeries(result.playlistId, it) }
                            }
                        }
                    },
                )
            }
        }
    }
}

@Composable
private fun SearchToggle(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    requester: FocusRequester? = null,
    up: FocusRequester? = null,
    left: FocusRequester? = null,
    right: FocusRequester? = null,
    down: FocusRequester? = null,
) {
    androidx.compose.runtime.CompositionLocalProvider(LocalTvFocusRadius provides 999.dp) {
    TvCard(
        onClick = onClick,
        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
        modifier = Modifier
            .height(32.dp)
            .then(requester?.let { Modifier.focusRequester(it) } ?: Modifier)
            .focusProperties {
                up?.let { this.up = it }
                left?.let { this.left = it }
                right?.let { this.right = it }
                down?.let { this.down = it }
            }
            .tvDpadClick(onClick),
        colors = androidx.tv.material3.CardDefaults.colors(
            containerColor = if (selected) tvTone(TvTone.Selected) else tvTone(TvTone.Surface).copy(alpha = 0.9f),
            focusedContainerColor = tvTone(TvTone.Focused),
        ),
    ) {
        Row(modifier = Modifier.fillMaxHeight().padding(horizontal = 13.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .width(7.dp)
                    .height(7.dp)
                    .background(if (selected) tvTone(TvTone.Accent) else Color.Transparent, RoundedCornerShape(50))
                    .tvHairline(if (selected) tvTone(TvTone.Accent) else tvTone(TvTone.Faint), 4f),
            )
            Text(label, modifier = Modifier.padding(start = 7.dp), color = if (selected) TvText else TvMuted, fontSize = 10.sp)
        }
    }
    }
}

@Composable
private fun TvHeader(section: TvSection, onSectionSelected: (TvSection) -> Unit) {
    val initialFocusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) { initialFocusRequester.requestFocus() }
    LazyRow(
        modifier = Modifier.fillMaxWidth(),
        contentPadding = PaddingValues(vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            Text(
                text = "IPTVnator",
                color = TvText,
                fontSize = 30.sp,
                modifier = Modifier.padding(end = 12.dp, top = 10.dp),
            )
        }
        itemsIndexed(TvSection.entries) { _, item ->
            TvCard(
                onClick = { onSectionSelected(item) },
                modifier = Modifier
                    .then(if (item == TvSection.Home) Modifier.focusRequester(initialFocusRequester) else Modifier)
                    .focusable()
                    .tvDpadClick { onSectionSelected(item) },
                colors = androidx.tv.material3.CardDefaults.colors(
                    containerColor = if (item == section) tvColor(Color(0xFF2C3445)) else Color.Transparent,
                    focusedContainerColor = tvColor(Color(0xFF536A9F)),
                ),
            ) {
                Text(
                    text = item.label,
                    color = TvText,
                    fontSize = 15.sp,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                )
            }
        }
    }
}

@Composable
private fun HomeContent(
    playlists: List<StoredPlaylist>,
    selectedPlaylistId: String?,
    liveChannelOverrides: Map<String, List<TvChannel>> = emptyMap(),
    history: List<TvSavedItem>,
    favorites: List<TvSavedItem>,
    showContinueWatching: Boolean,
    showRecentSources: Boolean,
    showLiveFavorites: Boolean,
    showRecentlyWatchedLive: Boolean,
    showFavoriteMoviesAndSeries: Boolean,
    favoriteVod: Map<String, List<TvVodItem>> = emptyMap(),
    favoriteSeries: Map<String, List<TvSeriesItem>> = emptyMap(),
    tmdbTrending: List<TmdbSearchResult>,
    tmdbRecommendations: List<TmdbSearchResult>,
    showXtreamRecentlyAdded: Boolean,
    recentlyAddedVod: Map<String, List<TvVodItem>>,
    recentlyAddedSeries: Map<String, List<TvSeriesItem>>,
    onSeeAll: (TvSection) -> Unit,
    onRenamePlaylist: (StoredPlaylist) -> Unit,
    onEditPlaylist: (StoredPlaylist) -> Unit,
    onDeletePlaylist: (StoredPlaylist) -> Unit,
    onInfoPlaylist: (StoredPlaylist) -> Unit,
    onAccountInfo: (StoredPlaylist) -> Unit,
    onRefreshPlaylist: (StoredPlaylist) -> Unit,
    onHistoryClick: (TvSavedItem) -> Unit,
    onToggleFavorite: (TvSavedItem, Boolean) -> Unit,
    onToggleWatched: (TvSavedItem, Boolean) -> Unit,
    onRemoveFromHistory: (TvSavedItem) -> Unit,
    onAddPlaylist: (TvSourceType?) -> Unit,
    onOpenPlaylist: (StoredPlaylist) -> Unit,
    onPlay: (String, TvChannel) -> Unit,
    onPlayVod: (String, TvVodItem) -> Unit,
    onOpenSeries: (String, TvSeriesItem) -> Unit,
) {
    var sourceActionPlaylist by remember { mutableStateOf<StoredPlaylist?>(null) }
    var historyActionItem by remember { mutableStateOf<TvSavedItem?>(null) }
    val sourceActionDialogFocusRequester = remember(sourceActionPlaylist?.id) { FocusRequester() }
    val historyActionDialogFocusRequester = remember(
        historyActionItem?.let { "${it.playlistId}:${it.itemType}:${it.itemKey}" },
    ) { FocusRequester() }
    val recentLiveHistory = remember(history) { tvDashboardRecentLiveHistory(history) }
    // D-pad DOWN from the full-width hero must land on the first card of
    // the first rail; geometric search would pick whatever sits under the
    // hero's centre (often a "Ver todo" tile).
    val firstRailFocusRequester = remember { FocusRequester() }
    val historyRailLeads = showRecentlyWatchedLive && recentLiveHistory.isNotEmpty()
    val sourceRailLeads = !historyRailLeads && showRecentSources && playlists.isNotEmpty()
    LaunchedEffect(sourceActionPlaylist?.id) {
        if (sourceActionPlaylist != null) {
            delay(100)
            sourceActionDialogFocusRequester.requestFocus()
        }
    }
    LaunchedEffect(historyActionItem?.let { "${it.playlistId}:${it.itemType}:${it.itemKey}" }) {
        if (historyActionItem != null) {
            delay(100)
            historyActionDialogFocusRequester.requestFocus()
        }
    }
    // The dashboard can contain many independent rails (and large Xtream
    // catalogues). Keep the horizontal rails intact, but make the dashboard
    // itself vertically scrollable so the lower rails are reachable at
    // 1080p instead of being clipped at the bottom of the TV viewport.
    val homeScrollState = rememberScrollState()
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(homeScrollState),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        fun resolveTmdbItem(result: TmdbSearchResult): Pair<String, Any>? {
            val wanted = normalizeTmdbTitle(result.title)
            return playlists.asSequence().flatMap { playlist ->
                if (result.mediaType == "tv") {
                    playlist.series.asSequence()
                        .filter { normalizeTmdbTitle(it.name) == wanted }
                        .map { playlist.id to it }
                } else {
                    playlist.vod.asSequence()
                        .filter { normalizeTmdbTitle(it.name) == wanted }
                        .map { playlist.id to it }
                }
            }.firstOrNull()
        }
        val playableTrending = tmdbTrending.mapNotNull { result -> resolveTmdbItem(result)?.let { result to it } }
        val playableRecommendations = tmdbRecommendations.mapNotNull { result -> resolveTmdbItem(result)?.let { result to it } }
        val featured = history.firstOrNull()
        if (showContinueWatching) {
            val heroPlaylist = playlists.firstOrNull { it.id == selectedPlaylistId } ?: playlists.firstOrNull()
            val heroDestination = homeHeroFallbackDestination(
                hasSource = heroPlaylist != null,
                hasTvChannels = heroPlaylist?.let(::playlistHasTvChannels) == true,
                hasRadio = heroPlaylist?.let { playlist ->
                    (playlist.catalogCounts?.radio ?: playlist.channels.count { it.radio }) > 0
                } == true,
                hasVod = heroPlaylist?.let { (it.catalogCounts?.vod ?: it.vod.size) > 0 } == true,
                hasSeries = heroPlaylist?.let { (it.catalogCounts?.series ?: it.series.size) > 0 } == true,
            )
            TvContinueHero(
                item = featured,
                downFocusRequester = if (historyRailLeads || sourceRailLeads) firstRailFocusRequester else null,
                emptyTitle = heroDestination?.label ?: "Empieza a ver algo",
                emptyDescription = heroPlaylist?.let { "${it.name} · ${playlistType(it)}" }
                    ?: "Añade una fuente para empezar",
                emptyActionLabel = heroDestination?.let { "Abrir ${it.label}" } ?: "Añadir fuente",
                onClick = {
                    if (featured != null) {
                        onHistoryClick(featured)
                    } else if (heroDestination != null) {
                        onSeeAll(heroDestination)
                    } else {
                        onAddPlaylist(null)
                    }
                },
            )
        }
        if (showRecentlyWatchedLive && recentLiveHistory.isNotEmpty()) {
            HomeSectionHeading(
                "Vistos recientemente · TV en directo",
                TvSection.Recent,
                onSeeAll,
                count = recentLiveHistory.size,
            )
            TvHistoryRail(
                items = recentLiveHistory.take(12),
                playlistTypes = playlists.associate { it.id to playlistType(it) },
                onItemClick = { index -> recentLiveHistory.getOrNull(index)?.let(onHistoryClick) },
                onAction = { historyActionItem = it },
                onSeeAll = { onSeeAll(TvSection.Recent) },
                firstItemFocusRequester = if (historyRailLeads) firstRailFocusRequester else null,
            )
        }
        if (showRecentSources) {
            HomeSectionHeading("Fuentes utilizadas", TvSection.Sources, onSeeAll, count = playlists.size)
            TvSourceRail(
                playlists = playlists,
                onOpen = onOpenPlaylist,
                onMenu = { sourceActionPlaylist = it },
                onSeeAll = { onSeeAll(TvSection.Sources) },
                firstItemFocusRequester = if (sourceRailLeads) firstRailFocusRequester else null,
            )
        }
        if (showLiveFavorites) {
            playlists.forEach { playlist ->
                val favoriteKeys = favorites
                    .filter { it.playlistId == playlist.id && it.itemType == com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL }
                    .map { it.itemKey }
                    .toSet()
                val favoriteChannels = (playlist.channels + liveChannelOverrides[playlist.id].orEmpty())
                    .distinctBy { it.id }
                    .filter { it.id in favoriteKeys }
                if (favoriteChannels.isNotEmpty()) {
                    TvRailTitle("Canales favoritos · ${playlist.name}", modifier = Modifier.padding(top = 6.dp))
                    TvChannelRail(
                        items = favoriteChannels,
                        onItemClick = { index -> favoriteChannels.getOrNull(index)?.let { onPlay(playlist.id, it) } },
                        onLongClick = { index -> favoriteChannels.getOrNull(index)?.let { channel ->
                            val item = channel.toSavedItem(playlist.id)
                            onToggleFavorite(item, false)
                        } },
                    )
                }
            }
        }
        if (showFavoriteMoviesAndSeries) {
            playlists.forEach { playlist ->
                val playlistFavoriteVod = favoriteVod[playlist.id].orEmpty()
                if (playlistFavoriteVod.isNotEmpty()) {
                    TvRailTitle("Películas favoritas · ${playlist.name}", modifier = Modifier.padding(top = 6.dp))
                    TvPosterRail(
                        items = playlistFavoriteVod.map { TvPosterItem(it.name, it.coverUrl, "Película") },
                        onItemClick = { index -> playlistFavoriteVod.getOrNull(index)?.let { onPlayVod(playlist.id, it) } },
                        onLongClick = { index -> playlistFavoriteVod.getOrNull(index)?.let { vod ->
                            val item = vod.toSavedItem(playlist.id)
                            onToggleFavorite(item, false)
                        } },
                    )
                }
                val playlistFavoriteSeries = favoriteSeries[playlist.id].orEmpty()
                if (playlistFavoriteSeries.isNotEmpty()) {
                    TvRailTitle("Series favoritas · ${playlist.name}", modifier = Modifier.padding(top = 6.dp))
                    TvPosterRail(
                        items = playlistFavoriteSeries.map { TvPosterItem(it.name, it.coverUrl, "Serie") },
                        onItemClick = { index -> playlistFavoriteSeries.getOrNull(index)?.let { onOpenSeries(playlist.id, it) } },
                        onLongClick = { index -> playlistFavoriteSeries.getOrNull(index)?.let { series ->
                            val item = series.toSavedItem(playlist.id)
                            onToggleFavorite(item, false)
                        } },
                    )
                }
            }
        }
        if (showXtreamRecentlyAdded) {
            val recentVodItems = recentlyAddedVod.flatMap { (playlistId, items) ->
                items.map { playlistId to it }
            }.sortedByDescending { it.second.addedAtMs ?: Long.MIN_VALUE }.take(12)
            if (recentVodItems.isNotEmpty()) {
                TvRailTitle("Añadido recientemente · Películas", modifier = Modifier.padding(top = 6.dp))
                TvPosterRail(
                    items = recentVodItems.map { TvPosterItem(it.second.name, it.second.coverUrl, "Película") },
                    onItemClick = { index -> recentVodItems.getOrNull(index)?.let { onPlayVod(it.first, it.second) } },
                    onLongClick = { index -> recentVodItems.getOrNull(index)?.let { pair ->
                        val saved = pair.second.toSavedItem(pair.first)
                        onToggleFavorite(saved, favorites.none { it.playlistId == saved.playlistId && it.itemType == saved.itemType && it.itemKey == saved.itemKey })
                    } },
                )
            }
            val recentSeriesItems = recentlyAddedSeries.flatMap { (playlistId, items) ->
                items.map { playlistId to it }
            }.sortedByDescending { it.second.addedAtMs ?: Long.MIN_VALUE }.take(12)
            if (recentSeriesItems.isNotEmpty()) {
                TvRailTitle("Añadido recientemente · Series", modifier = Modifier.padding(top = 6.dp))
                TvPosterRail(
                    items = recentSeriesItems.map { TvPosterItem(it.second.name, it.second.coverUrl, "Serie") },
                    onItemClick = { index -> recentSeriesItems.getOrNull(index)?.let { onOpenSeries(it.first, it.second) } },
                    onLongClick = { index -> recentSeriesItems.getOrNull(index)?.let { pair ->
                        val saved = pair.second.toSavedItem(pair.first)
                        onToggleFavorite(saved, favorites.none { it.playlistId == saved.playlistId && it.itemType == saved.itemType && it.itemKey == saved.itemKey })
                    } },
                )
            }
        }
        if (playableTrending.isNotEmpty()) {
            TvRailTitle("Tendencias TMDB", modifier = Modifier.padding(top = 6.dp))
            TvPosterRail(
                items = playableTrending.map { (_, resolved) ->
                    TvPosterItem(
                        title = when (val item = resolved.second) {
                            is TvVodItem -> item.name
                            is TvSeriesItem -> item.name
                            else -> ""
                        },
                        imageUrl = when (val item = resolved.second) {
                            is TvVodItem -> item.coverUrl
                            is TvSeriesItem -> item.coverUrl
                            else -> null
                        },
                    )
                },
                onItemClick = { index ->
                    playableTrending.getOrNull(index)?.let { (_, resolved) ->
                        when (val item = resolved.second) {
                            is TvVodItem -> onPlayVod(resolved.first, item)
                            is TvSeriesItem -> onOpenSeries(resolved.first, item)
                        }
                    }
                },
                onLongClick = {},
            )
        }
        if (playableRecommendations.isNotEmpty()) {
            TvRailTitle("Recomendaciones TMDB", modifier = Modifier.padding(top = 6.dp))
            TvPosterRail(
                items = playableRecommendations.map { (_, resolved) ->
                    TvPosterItem(
                        title = when (val item = resolved.second) {
                            is TvVodItem -> item.name
                            is TvSeriesItem -> item.name
                            else -> ""
                        },
                        imageUrl = when (val item = resolved.second) {
                            is TvVodItem -> item.coverUrl
                            is TvSeriesItem -> item.coverUrl
                            else -> null
                        },
                    )
                },
                onItemClick = { index ->
                    playableRecommendations.getOrNull(index)?.let { (_, resolved) ->
                        when (val item = resolved.second) {
                            is TvVodItem -> onPlayVod(resolved.first, item)
                            is TvSeriesItem -> onOpenSeries(resolved.first, item)
                        }
                    }
                },
                onLongClick = {},
            )
        }
        playlists.forEach { playlist ->
            TvRailTitle("Canales · ${playlist.name}", modifier = Modifier.padding(top = 6.dp))
            TvChannelRail(
                items = playlist.channels.take(12),
                onItemClick = { index -> playlist.channels.getOrNull(index)?.let { onPlay(playlist.id, it) } },
                onLongClick = { index -> playlist.channels.getOrNull(index)?.let { channel ->
                    val item = channel.toSavedItem(playlist.id)
                    onToggleFavorite(item, favorites.none { it.playlistId == item.playlistId && it.itemType == item.itemType && it.itemKey == item.itemKey })
                } },
            )
            if (playlist.vod.isNotEmpty()) {
                TvRailTitle("Películas · ${playlist.name}", modifier = Modifier.padding(top = 6.dp))
                TvPosterRail(
                    items = playlist.vod.take(12).map { TvPosterItem(it.name, it.coverUrl, "Película") },
                    onItemClick = { index -> playlist.vod.getOrNull(index)?.let { onPlayVod(playlist.id, it) } },
                    onLongClick = { index -> playlist.vod.getOrNull(index)?.let { vod ->
                        val item = vod.toSavedItem(playlist.id)
                        onToggleFavorite(item, favorites.none { it.playlistId == item.playlistId && it.itemType == item.itemType && it.itemKey == item.itemKey })
                    } },
                )
            }
            if (playlist.series.isNotEmpty()) {
                TvRailTitle("Series · ${playlist.name}", modifier = Modifier.padding(top = 6.dp))
                TvPosterRail(
                    items = playlist.series.take(12).map { TvPosterItem(it.name, it.coverUrl, "Serie") },
                    onItemClick = { index -> playlist.series.getOrNull(index)?.let { onOpenSeries(playlist.id, it) } },
                    onLongClick = { index -> playlist.series.getOrNull(index)?.let { series ->
                        val item = series.toSavedItem(playlist.id)
                        onToggleFavorite(item, favorites.none { it.playlistId == item.playlistId && it.itemType == item.itemType && it.itemKey == item.itemKey })
                    } },
                )
            }
        }
    }
    sourceActionPlaylist?.let { playlist ->
        val firstAction = when {
            playlistHasRefreshableSource(playlist) -> "refresh"
            else -> "info"
        }
        TvAlertDialog(
            onDismissRequest = { sourceActionPlaylist = null },
            title = { Text(playlist.name) },
            text = { Text("Gestiona esta playlist") },
            confirmButton = {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (playlistHasRefreshableSource(playlist)) {
                        TvButton(
                            onClick = {
                                sourceActionPlaylist = null
                                onRefreshPlaylist(playlist)
                            },
                            modifier = Modifier.fillMaxWidth()
                                .then(if (firstAction == "refresh") Modifier.focusRequester(sourceActionDialogFocusRequester) else Modifier)
                                .tvDpadClick {
                                    sourceActionPlaylist = null
                                    onRefreshPlaylist(playlist)
                                },
                        ) { Text("Actualizar") }
                    }
                    TvButton(
                        onClick = {
                            sourceActionPlaylist = null
                            onInfoPlaylist(playlist)
                        },
                        modifier = Modifier.fillMaxWidth()
                            .then(if (firstAction == "info") Modifier.focusRequester(sourceActionDialogFocusRequester) else Modifier)
                            .tvDpadClick {
                            sourceActionPlaylist = null
                            onInfoPlaylist(playlist)
                        },
                    ) { Text("Información") }
                    if (playlistType(playlist) != "M3U") {
                        TvButton(
                            onClick = {
                                sourceActionPlaylist = null
                                onAccountInfo(playlist)
                            },
                            modifier = Modifier.fillMaxWidth().tvDpadClick {
                                sourceActionPlaylist = null
                                onAccountInfo(playlist)
                            },
                        ) { Text("Cuenta") }
                    }
                    if (playlistCanEditConnection(playlist) || playlistCanReplaceLocalFile(playlist)) {
                        TvButton(
                            onClick = {
                                sourceActionPlaylist = null
                                onEditPlaylist(playlist)
                            },
                            modifier = Modifier.fillMaxWidth().tvDpadClick {
                                sourceActionPlaylist = null
                                onEditPlaylist(playlist)
                            },
                        ) { Text(if (playlistCanReplaceLocalFile(playlist)) "Seleccionar archivo" else "Editar") }
                    }
                    TvButton(
                        onClick = {
                            sourceActionPlaylist = null
                            onRenamePlaylist(playlist)
                        },
                        modifier = Modifier.fillMaxWidth().tvDpadClick {
                            sourceActionPlaylist = null
                            onRenamePlaylist(playlist)
                        },
                    ) { Text("Renombrar") }
                    TvButton(
                        onClick = {
                            sourceActionPlaylist = null
                            onDeletePlaylist(playlist)
                        },
                        modifier = Modifier.fillMaxWidth().tvDpadClick {
                            sourceActionPlaylist = null
                            onDeletePlaylist(playlist)
                        },
                    ) { Text("Eliminar") }
                    TvButton(
                        onClick = { sourceActionPlaylist = null },
                        modifier = Modifier.fillMaxWidth().tvDpadClick { sourceActionPlaylist = null },
                    ) { Text("Cancelar") }
                }
            },
        )
    }
    historyActionItem?.let { item ->
        TvAlertDialog(
            onDismissRequest = { historyActionItem = null },
            title = { Text(item.title) },
            text = { Text("Gestiona este elemento del historial") },
            confirmButton = {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    TvButton(
                        onClick = {
                            historyActionItem = null
                            onHistoryClick(item)
                        },
                        modifier = Modifier.fillMaxWidth()
                            .focusRequester(historyActionDialogFocusRequester)
                            .tvDpadClick {
                                historyActionItem = null
                                onHistoryClick(item)
                            },
                    ) { Text(if (item.itemType == com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL) "Abrir canal" else "Reanudar") }
                    TvButton(
                        onClick = {
                            historyActionItem = null
                            onToggleWatched(item, !item.isWatched)
                        },
                        modifier = Modifier.fillMaxWidth().tvDpadClick {
                            historyActionItem = null
                            onToggleWatched(item, !item.isWatched)
                        },
                    ) { Text(if (item.isWatched) "Marcar como no visto" else "Marcar como visto") }
                    TvButton(
                        onClick = {
                            historyActionItem = null
                            onRemoveFromHistory(item)
                        },
                        modifier = Modifier.fillMaxWidth().tvDpadClick {
                            historyActionItem = null
                            onRemoveFromHistory(item)
                        },
                    ) { Text("Quitar del historial") }
                    TvButton(
                        onClick = { historyActionItem = null },
                        modifier = Modifier.fillMaxWidth().tvDpadClick { historyActionItem = null },
                    ) { Text("Cancelar") }
                }
            },
        )
    }
}

@Composable
private fun HomeSectionHeading(
    title: String,
    section: TvSection,
    onSeeAll: (TvSection) -> Unit,
    count: Int? = null,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TvRailTitle(title, count)
        // "Ver todo" lives at the end of the rail as a tile, so D-pad DOWN
        // from the hero lands on the first card instead of a right-aligned
        // link, and the rail reads left-to-right like the rest of Google TV.
    }
}

/** Rail heading: condensed title, split on "·" into a title and a muted qualifier, plus a count. */
@Composable
internal fun TvRailTitle(title: String, count: Int? = null, modifier: Modifier = Modifier) {
    val parts = title.split(" · ", limit = 2)
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        Text(
            parts[0],
            color = tvTone(TvTone.Text),
            fontFamily = TvType.Display,
            fontSize = 17.sp,
            letterSpacing = 0.2.sp,
            maxLines = 1,
        )
        if (parts.size > 1) {
            Text(
                "  ${parts[1]}",
                color = tvTone(TvTone.Muted),
                fontFamily = TvType.DisplayMedium,
                fontSize = 15.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        count?.let { total ->
            TvTag(total.toString(), modifier = Modifier.padding(start = 10.dp), tone = TvTone.Accent)
        }
    }
}

@Composable
private fun TvContinueHero(
    item: TvSavedItem?,
    downFocusRequester: FocusRequester? = null,
    emptyTitle: String,
    emptyDescription: String,
    emptyActionLabel: String,
    onClick: () -> Unit,
) {
    val isChannel = item?.itemType == com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL
    val artwork = item?.coverUrl?.takeIf(String::isNotBlank)
    val canvas = tvTone(TvTone.Canvas)
    val surface = tvTone(TvTone.SurfaceHigh)
    val accent = tvTone(TvTone.Accent)
    var heroFocused by remember { mutableStateOf(false) }
    val navRail = LocalTvNavRailFocus.current
    TvCard(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .height(206.dp)
            .focusProperties {
                navRail?.let { left = it }
                downFocusRequester?.let { down = it }
            }
            .tvDpadClick(onClick, { heroFocused = it }),
        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(12.dp)),
        scale = androidx.tv.material3.CardDefaults.scale(focusedScale = 1f),
        colors = androidx.tv.material3.CardDefaults.colors(
            containerColor = surface,
            focusedContainerColor = surface,
        ),
    ) {
        Box(Modifier.fillMaxSize().clip(RoundedCornerShape(12.dp))) {
            // Backdrop: the artwork itself, enlarged and blurred, tinted
            // towards the canvas so any logo or poster becomes ambience.
            if (artwork != null) {
                AsyncImage(
                    model = artwork,
                    contentDescription = null,
                    modifier = Modifier
                        .fillMaxSize()
                        .graphicsLayer { scaleX = 1.6f; scaleY = 1.6f; alpha = 0.55f }
                        .blur(40.dp),
                    contentScale = ContentScale.Crop,
                )
            }
            Box(
                Modifier.fillMaxSize().background(
                    Brush.horizontalGradient(
                        0f to canvas.copy(alpha = 0.96f),
                        0.55f to canvas.copy(alpha = 0.78f),
                        1f to canvas.copy(alpha = 0.35f),
                    ),
                ),
            )
            Box(
                Modifier.fillMaxSize().background(
                    Brush.radialGradient(
                        listOf(accent.copy(alpha = 0.22f), Color.Transparent),
                        center = androidx.compose.ui.geometry.Offset(0f, 0f),
                        radius = 900f,
                    ),
                ),
            )
            Row(
                modifier = Modifier.fillMaxSize().padding(start = 26.dp, end = 22.dp, top = 20.dp, bottom = 20.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TvEyebrow(if (item == null) "Para empezar" else "Continuar viendo")
                        if (isChannel) TvLiveBadge()
                    }
                    Text(
                        item?.title ?: emptyTitle,
                        color = tvTone(TvTone.Text),
                        fontFamily = TvType.Display,
                        fontSize = 30.sp,
                        lineHeight = 32.sp,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        if (item == null) {
                            emptyDescription
                        } else {
                            when (item.itemType) {
                                com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL -> "Canal en directo"
                                com.iptvnator.googletv.playlist.TvSavedItemType.VOD -> "Película"
                                com.iptvnator.googletv.playlist.TvSavedItemType.SERIES -> "Serie"
                            }
                        },
                        color = tvTone(TvTone.TextSoft),
                        fontSize = 11.sp,
                        maxLines = 1,
                    )
                    Spacer(Modifier.height(6.dp))
                    // Visual call to action only: the whole hero is the
                    // single D-pad target, so one OK always resumes.
                    Row(
                        modifier = Modifier
                            .height(36.dp)
                            .background(
                                if (heroFocused) tvTone(TvTone.AccentSoft) else accent,
                                RoundedCornerShape(50),
                            )
                            .padding(start = 14.dp, end = 18.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("▶", color = tvTone(TvTone.AccentInk), fontSize = 10.sp)
                        Text(
                            if (item == null) emptyActionLabel else "Continuar viendo",
                            modifier = Modifier.padding(start = 8.dp),
                            color = tvTone(TvTone.AccentInk),
                            fontFamily = TvType.BodyMedium,
                            fontSize = 11.sp,
                        )
                    }
                }
                Box(
                    modifier = Modifier
                        .padding(start = 20.dp)
                        .width(if (isChannel || item == null) 240.dp else 112.dp)
                        .fillMaxHeight()
                        .clip(RoundedCornerShape(10.dp))
                        .background(tvTone(TvTone.Deep).copy(alpha = 0.55f)),
                    contentAlignment = Alignment.Center,
                ) {
                    if (artwork != null) {
                        AsyncImage(
                            model = artwork,
                            contentDescription = item?.title,
                            modifier = Modifier.fillMaxSize().padding(if (isChannel) 22.dp else 0.dp),
                            contentScale = if (isChannel) ContentScale.Fit else ContentScale.Crop,
                        )
                    } else {
                        TvBrandMark(sizeDp = 56)
                    }
                }
            }
        }
    }
}

@Composable
private fun TvHistoryRail(
    items: List<TvSavedItem>,
    playlistTypes: Map<String, String>,
    onItemClick: (Int) -> Unit,
    onAction: (TvSavedItem) -> Unit,
    onSeeAll: (() -> Unit)? = null,
    firstItemFocusRequester: FocusRequester? = null,
) {
    if (items.isEmpty()) return
    val navRail = LocalTvNavRailFocus.current
    LazyRow(contentPadding = PaddingValues(vertical = 10.dp, horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        itemsIndexed(items) { index, item ->
            val isChannel = item.itemType == com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL
            val cardRequester = remember { FocusRequester() }
            val menuRequester = remember { FocusRequester() }
            Column(Modifier.width(212.dp)) {
                Box {
                    TvCard(
                        onClick = { onItemClick(index) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(119.dp)
                            .then(if (index == 0 && firstItemFocusRequester != null) Modifier.focusRequester(firstItemFocusRequester) else Modifier)
                            .focusRequester(cardRequester)
                            .focusProperties {
                                if (index == 0) navRail?.let { left = it }
                                // The ⋮ action sits over the card; route RIGHT
                                // through it so it is reachable with the remote.
                                right = menuRequester
                            }
                            .onKeyEvent { event ->
                                // Long-press OK opens the same actions menu.
                                if (event.type == KeyEventType.KeyDown &&
                                    isTvSelectKey(event.nativeKeyEvent.keyCode) &&
                                    event.nativeKeyEvent.repeatCount == 1
                                ) {
                                    onAction(item); true
                                } else false
                            }
                            .tvDpadClick { onItemClick(index) },
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(12.dp)),
                        scale = androidx.tv.material3.CardDefaults.scale(focusedScale = 1f),
                        colors = androidx.tv.material3.CardDefaults.colors(
                            containerColor = tvTone(TvTone.SurfaceHigh),
                            focusedContainerColor = tvTone(TvTone.SurfaceTop),
                        ),
                    ) {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            item.coverUrl?.takeIf(String::isNotBlank)?.let { url ->
                                AsyncImage(
                                    model = url,
                                    contentDescription = item.title,
                                    modifier = Modifier.fillMaxSize().padding(if (isChannel) 24.dp else 0.dp),
                                    contentScale = if (isChannel) ContentScale.Fit else ContentScale.Crop,
                                )
                            } ?: Text(
                                item.title.take(2).uppercase(),
                                color = tvTone(TvTone.Faint),
                                fontFamily = TvType.Display,
                                fontSize = 30.sp,
                            )
                            if (isChannel) {
                                TvLiveBadge(Modifier.align(Alignment.TopStart).padding(8.dp), label = "DIRECTO")
                            } else if (item.resumePositionMs > 0L && !item.isWatched) {
                                Box(
                                    Modifier
                                        .align(Alignment.BottomStart)
                                        .fillMaxWidth()
                                        .height(3.dp)
                                        .background(tvTone(TvTone.Accent)),
                                )
                            }
                        }
                    }
                    androidx.compose.runtime.CompositionLocalProvider(LocalTvFocusRadius provides 999.dp) {
                        TvCard(
                            onClick = { onAction(item) },
                            modifier = Modifier
                                .align(Alignment.TopEnd)
                                .padding(6.dp)
                                .width(26.dp)
                                .height(26.dp)
                                .focusRequester(menuRequester)
                                .focusProperties { left = cardRequester }
                                .tvDpadClick { onAction(item) },
                            shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                            scale = androidx.tv.material3.CardDefaults.scale(focusedScale = 1f),
                            colors = androidx.tv.material3.CardDefaults.colors(
                                containerColor = tvTone(TvTone.Deep).copy(alpha = 0.7f),
                                focusedContainerColor = tvTone(TvTone.Focused),
                            ),
                        ) {
                            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                Text("⋮", color = tvTone(TvTone.Text), fontSize = 14.sp)
                            }
                        }
                    }
                }
                Text(
                    item.title,
                    modifier = Modifier.padding(top = 8.dp, start = 2.dp),
                    color = tvTone(TvTone.Text),
                    fontFamily = TvType.BodyMedium,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                val sourceType = playlistTypes[item.playlistId] ?: "M3U"
                val detail = when (item.itemType) {
                    com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL -> "Canal"
                    com.iptvnator.googletv.playlist.TvSavedItemType.VOD ->
                        if (item.resumePositionMs > 0L && !item.isWatched) "Película · ${formatResumePosition(item.resumePositionMs)}" else "Película"
                    com.iptvnator.googletv.playlist.TvSavedItemType.SERIES -> "Serie"
                }
                Text(
                    "$detail · $sourceType",
                    modifier = Modifier.padding(start = 2.dp),
                    color = tvTone(TvTone.Muted),
                    fontSize = 9.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        onSeeAll?.let { seeAll ->
            item(key = "see-all") { TvSeeAllTile(onClick = seeAll, width = 132.dp, height = 119.dp) }
        }
    }
}

@Composable
private fun TvSourceRail(
    playlists: List<StoredPlaylist>,
    onOpen: (StoredPlaylist) -> Unit,
    onMenu: (StoredPlaylist) -> Unit,
    onSeeAll: (() -> Unit)? = null,
    firstItemFocusRequester: FocusRequester? = null,
) {
    LazyRow(contentPadding = PaddingValues(vertical = 10.dp, horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        itemsIndexed(playlists) { index, playlist ->
            val type = playlistType(playlist)
            TvSourceCard(
                playlist.name,
                "${playlistChannelCount(playlist)} canales",
                isFirst = index == 0,
                focusRequester = if (index == 0) firstItemFocusRequester else null,
                if (type == "M3U") "M3U" else type,
                { onOpen(playlist) },
                onMenu = { onMenu(playlist) },
                typeLabel = type,
            )
        }
        onSeeAll?.let { seeAll ->
            item(key = "see-all") { TvSeeAllTile(onClick = seeAll, width = 132.dp, height = 96.dp) }
        }
    }
}

@Composable
private fun TvSourceCard(
    title: String,
    subtitle: String,
    isFirst: Boolean = false,
    focusRequester: FocusRequester? = null,
    icon: String,
    onClick: () -> Unit,
    onMenu: (() -> Unit)? = null,
    typeLabel: String? = null,
) {
    val navRail = LocalTvNavRailFocus.current
    val cardRequester = remember { FocusRequester() }
    val menuRequester = remember { FocusRequester() }
    Box(Modifier.width(212.dp).height(96.dp)) {
        TvCard(
            onClick = onClick,
            modifier = Modifier
                .fillMaxSize()
                .then(focusRequester?.let { Modifier.focusRequester(it) } ?: Modifier)
                .focusRequester(cardRequester)
                .focusProperties {
                    if (isFirst) navRail?.let { left = it }
                    if (onMenu != null) right = menuRequester
                }
                .onKeyEvent { event ->
                    if (onMenu != null && event.type == KeyEventType.KeyDown &&
                        isTvSelectKey(event.nativeKeyEvent.keyCode) &&
                        event.nativeKeyEvent.repeatCount == 1
                    ) {
                        onMenu(); true
                    } else false
                }
                .tvDpadClick(onClick),
            shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(12.dp)),
            scale = androidx.tv.material3.CardDefaults.scale(focusedScale = 1f),
            colors = androidx.tv.material3.CardDefaults.colors(
                containerColor = tvTone(TvTone.SurfaceHigh),
                focusedContainerColor = tvTone(TvTone.SurfaceTop),
            ),
        ) {
            Row(
                modifier = Modifier.fillMaxSize().padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier
                        .width(44.dp)
                        .height(44.dp)
                        .background(tvTone(TvTone.Accent).copy(alpha = 0.14f), RoundedCornerShape(12.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    SourceGlyph(icon, tvTone(TvTone.Accent), Modifier.width(24.dp).height(24.dp))
                }
                Column(Modifier.padding(start = 12.dp, end = 18.dp).weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(title, color = tvTone(TvTone.Text), fontFamily = TvType.BodyMedium, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(subtitle, color = tvTone(TvTone.Muted), fontSize = 9.sp, maxLines = 1)
                    typeLabel?.let { TvTag(it, tone = TvTone.Accent) }
                }
            }
        }
        onMenu?.let { menu ->
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(4.dp)
                    .width(24.dp)
                    .height(26.dp)
                    .focusRequester(menuRequester)
                    .focusProperties { left = cardRequester }
                    .tvDpadClick(menu),
                contentAlignment = Alignment.Center,
            ) {
                Text("⋮", color = tvTone(TvTone.TextSoft), fontSize = 14.sp)
            }
        }
    }
}

@Composable
@OptIn(ExperimentalLayoutApi::class)
internal fun LiveContent(
    playlists: List<StoredPlaylist>,
    topBarFocusRequester: FocusRequester? = null,
    repository: TvPlaylistRepository,
    sortPreferences: android.content.SharedPreferences,
    radioOnly: Boolean = false,
    epgOffsetMinutes: Int = 0,
    stripCountryPrefixes: Boolean = false,
    initialFocusRequester: FocusRequester? = null,
    epgByChannel: Map<String, List<TvEpgEntry>>,
    xtreamEpgPreviews: Map<String, TvXtreamEpgPreview> = emptyMap(),
    preferUploadedEpgOverXtream: Boolean = false,
    onXtreamEpgPreviewLoaded: (String, TvXtreamEpgPreview) -> Unit = { _, _ -> },
    favorites: List<TvSavedItem>,
    history: List<TvSavedItem>,
    onToggleFavorite: (TvSavedItem, Boolean) -> Unit,
    onEditEpg: (String, TvChannel) -> Unit,
    onSaveHiddenGroups: (String, List<String>) -> Unit,
    onPlay: (String, TvChannel, List<Pair<String, TvChannel>>, TvChannelZapScope) -> Unit,
    onGroupFocusChanged: (String, Boolean) -> Unit = { _, _ -> },
    onChannelFocusChanged: (String, Boolean) -> Unit = { _, _ -> },
) {
    val imeVisible = WindowInsets.isImeVisible
    var selectedGroup by remember { mutableStateOf("Todos") }
    val liveSortKey = if (radioOnly) "radio_sort_mode" else "live_sort_mode"
    var liveSort by remember(radioOnly) {
        mutableStateOf(
            TvLiveSort.entries.firstOrNull { it.name == sortPreferences.getString(liveSortKey, null) }
                ?: TvLiveSort.SERVER,
        )
    }
    var groupSortMode by remember(sortPreferences) {
        mutableStateOf(TvCategorySortMode.restore(sortPreferences.getString(TV_CATEGORY_SORT_PREFERENCE_KEY, null)))
    }
    var groupSortMenuExpanded by remember { mutableStateOf(false) }
    val channelNameOrder = remember { tvChannelNameComparator() }
    var searchQuery by remember { mutableStateOf("") }
    var groupSearchOpen by remember { mutableStateOf(false) }
    var groupSearchQuery by remember { mutableStateOf("") }
    var numericBuffer by remember { mutableStateOf("") }
    var channelLimit by remember { mutableStateOf(100) }
    var loadingMoreChannels by remember { mutableStateOf(false) }
    var sourcePagesExhausted by remember { mutableStateOf(false) }
    var extraChannels by remember { mutableStateOf<Map<String, List<TvChannel>>>(emptyMap()) }
    var nameSortedChannels by remember { mutableStateOf<Map<String, List<TvChannel>>>(emptyMap()) }
    var nameSortedPagesHaveMore by remember { mutableStateOf(false) }
    var groupChannels by remember { mutableStateOf<Map<String, List<TvChannel>>>(emptyMap()) }
    var extraEpg by remember { mutableStateOf<Map<String, List<TvEpgEntry>>>(emptyMap()) }
    val stalkerPlaylistIds by produceState(emptySet<String>(), repository, playlists.map { it.id }, radioOnly) {
        value = if (radioOnly) emptySet() else withContext(Dispatchers.IO) {
            playlists.filter { repository.loadProviderAccount(it.id).stalker != null }.mapTo(mutableSetOf()) { it.id }
        }
    }
    val xtreamPlaylistIds by produceState(emptySet<String>(), repository, playlists.map { it.id }, radioOnly) {
        value = if (radioOnly) emptySet() else withContext(Dispatchers.IO) {
            playlists.filter { repository.loadProviderAccount(it.id).xtream != null }.mapTo(mutableSetOf()) { it.id }
        }
    }
    var visibleXtreamEpgPreviews by remember { mutableStateOf(xtreamEpgPreviews) }
    LaunchedEffect(xtreamEpgPreviews) { visibleXtreamEpgPreviews = xtreamEpgPreviews }
    var stalkerPreviewEpg by remember { mutableStateOf<Map<String, List<TvEpgEntry>>>(emptyMap()) }
    val stalkerPreviewFetchedAt = remember { mutableMapOf<String, Long>() }
    // The visible row gates preview reads on this offset. Keep it observable so
    // changing from an empty/stale cache to the fetched offset recomposes that
    // row and lets it consume the already-observable preview result.
    val stalkerPreviewFetchedOffset = remember {
        androidx.compose.runtime.mutableStateMapOf<String, Int>()
    }
    val stalkerPreviewSemaphore = remember { Semaphore(2) }
    val showChannelEpg = remember(playlists, epgByChannel, extraEpg, radioOnly, stalkerPlaylistIds, xtreamPlaylistIds) {
        !radioOnly && (
            stalkerPlaylistIds.isNotEmpty() || xtreamPlaylistIds.isNotEmpty() ||
                shouldShowTvLiveEpg(playlists, epgByChannel, extraEpg)
            )
    }
    var searchedChannels by remember { mutableStateOf<Map<String, List<TvChannel>>>(emptyMap()) }
    var savedChannels by remember { mutableStateOf<List<Pair<String, TvChannel>>>(emptyList()) }
    var totalChannelCount by remember { mutableStateOf(0) }
    var completeGroupCounts by remember { mutableStateOf<Map<String, Int>>(emptyMap()) }
    var channelListVisible by remember(radioOnly) { mutableStateOf(true) }
    var groupRailVisible by remember(radioOnly) { mutableStateOf(true) }
    var manageGroupsVisible by remember { mutableStateOf(false) }
    var manageCategoriesVisible by remember { mutableStateOf(false) }
    var hiddenCategoryOverrides by remember(playlists) {
        mutableStateOf(playlists.associate { it.id to it.hiddenCategories })
    }
    val firstGroupFocusRequester = initialFocusRequester ?: remember { FocusRequester() }
    val groupSearchButtonFocusRequester = remember { FocusRequester() }
    val groupSortButtonFocusRequester = remember { FocusRequester() }
    val groupSortOptionFocusRequesters = remember { List(TvCategorySortMode.entries.size) { FocusRequester() } }
    val groupSearchFieldFocusRequester = remember { FocusRequester() }
    val groupSearchCloseFocusRequester = remember { FocusRequester() }
    val manageGroupsFocusRequester = remember { FocusRequester() }
    val liveSearchPillFocusRequester = remember { FocusRequester() }
    val liveSearchFieldFocusRequester = remember { FocusRequester() }
    var liveSearchEditing by remember { mutableStateOf(false) }
    var liveSearchFieldHadFocus by remember { mutableStateOf(false) }
    val manageCategoriesFocusRequester = remember { FocusRequester() }
    val firstChannelFocusRequester = remember { FocusRequester() }
    val firstFavoriteFocusRequester = remember { FocusRequester() }
    val firstEpgFocusRequester = remember { FocusRequester() }
    var pendingFirstChannelFocus by remember { mutableStateOf(false) }
    fun requestFirstChannelFocus() {
        val focused = runCatching { firstChannelFocusRequester.requestFocus() }.getOrDefault(false)
        pendingFirstChannelFocus = !focused
    }
    val channelListState = rememberLazyListState()
    val groupRailListState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    fun closeGroupSortMenu() {
        groupSortMenuExpanded = false
        scope.launch {
            delay(80)
            // Opening the sort choices scrolls this LazyColumn down to the
            // selected option. The choices are then removed from its item
            // list, but LazyListState keeps that old index; after a second
            // open/close the first group can be off-composition and its D-pad
            // focus requester cannot restore focus to "Todos".
            runCatching { groupRailListState.scrollToItem(0) }
            repeat(10) {
                withFrameNanos { }
                if (runCatching { groupSortButtonFocusRequester.requestFocus() }.getOrDefault(false)) {
                    return@launch
                }
                delay(50)
            }
        }
    }
    fun selectGroupSortMode(mode: TvCategorySortMode) {
        groupSortMode = mode
        sortPreferences.edit().putString(TV_CATEGORY_SORT_PREFERENCE_KEY, mode.preferenceValue).apply()
        closeGroupSortMenu()
    }
    fun openGroupSortMenu() {
        groupSortMenuExpanded = true
    }
    BackHandler(enabled = groupSortMenuExpanded) { closeGroupSortMenu() }
    LaunchedEffect(groupSortMenuExpanded, groupSortMode) {
        if (!groupSortMenuExpanded) return@LaunchedEffect
        val selectedIndex = TvCategorySortMode.entries.indexOf(groupSortMode).coerceAtLeast(0)
        repeat(10) {
            if (runCatching { groupSortOptionFocusRequesters[selectedIndex].requestFocus() }.getOrDefault(false)) {
                return@LaunchedEffect
            }
            delay(50)
        }
    }
    val liveKeyboardController = LocalSoftwareKeyboardController.current
    LaunchedEffect(groupSearchOpen) {
        if (!groupSearchOpen) {
            liveKeyboardController?.hide()
            return@LaunchedEffect
        }
        delay(150)
        if (groupSearchOpen) {
            runCatching { groupSearchFieldFocusRequester.requestFocus() }
            liveKeyboardController?.show()
        }
    }
    fun closeGroupSearch() {
        groupSearchQuery = ""
        groupSearchOpen = false
        liveKeyboardController?.hide()
        scope.launch {
            delay(80)
            runCatching { groupSearchButtonFocusRequester.requestFocus() }
        }
    }
    fun currentChannelZapScope(): TvChannelZapScope {
        val captureVisibleOrder = searchQuery.isNotBlank() || selectedGroup == "Favoritos" ||
            selectedGroup == "Recientes"
        val order = when {
            captureVisibleOrder -> TvChannelZapOrder.CAPTURED
            liveSort == TvLiveSort.NAME_ASC -> TvChannelZapOrder.NAME_ASC
            liveSort == TvLiveSort.NAME_DESC -> TvChannelZapOrder.NAME_DESC
            else -> TvChannelZapOrder.SOURCE
        }
        val groupName = selectedGroup.takeUnless {
            it == "Todos" || it == "Favoritos" || it == "Recientes"
        }
        return TvChannelZapScope(
            order = order,
            playlistOrder = playlists.map { it.id }.takeIf { !captureVisibleOrder && it.size > 1 }.orEmpty(),
            groupName = groupName,
        )
    }
    fun isLiveCategoryHidden(playlistId: String, channel: TvChannel): Boolean =
        hiddenCategoryOverrides[playlistId].orEmpty().any { hidden ->
            hidden.type == "live" && (
                hidden.id.equals(channel.providerCategoryId, ignoreCase = true) ||
                    hidden.id.equals(channel.group, ignoreCase = true)
                )
        }
    val hiddenCategoryKey = hiddenCategoryOverrides.entries.joinToString("\u0001") { (id, values) ->
        "$id:${values.filter { it.type == "live" }.joinToString(",") { it.id }}"
    }
    val sourceEntries = remember(playlists, radioOnly, extraChannels, hiddenCategoryKey) {
        playlists.flatMap { playlist ->
            (playlist.channels + extraChannels[playlist.id].orEmpty())
                .distinctBy { it.id }
                .map { playlist.id to it }
        }
            .filter { it.second.radio == radioOnly }
            .filter { (playlistId, channel) -> !isLiveCategoryHidden(playlistId, channel) }
    }
    LaunchedEffect(
        playlists.map { it.id },
        favorites.map { "${it.playlistId}:${it.itemKey}:${it.itemType}" },
        history.map { "${it.playlistId}:${it.itemKey}:${it.itemType}" },
        radioOnly,
    ) {
        val keys = (favorites + history)
            .filter { it.itemType == com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL }
            .filter { saved -> playlists.any { it.id == saved.playlistId } }
            .distinctBy { "${it.playlistId}:${it.itemKey}" }
        savedChannels = withContext(Dispatchers.IO) {
            keys.mapNotNull { saved ->
                repository.loadChannel(saved.playlistId, saved.itemKey)
                    ?.takeIf { it.radio == radioOnly }
                    ?.let { saved.playlistId to it }
            }
        }
    }
    val displayEntries = remember(sourceEntries, savedChannels) {
        (sourceEntries + savedChannels).distinctBy { (playlistId, channel) -> "$playlistId:${channel.id}" }
    }
    val favoriteKeys = remember(favorites) {
        favorites
            .filter { it.itemType == com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL }
            .map { "${it.playlistId}:${it.itemKey}" }
            .toSet()
    }
    val recentOrder = remember(history) {
        history
            .filter { it.itemType == com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL }
            .map { "${it.playlistId}:${it.itemKey}" }
            .withIndex()
            .associate { it.value to it.index }
    }
    val hiddenGroupKey = playlists.joinToString("\u0001") { "${it.id}:${it.hiddenGroupTitles.joinToString("\u0002")}" }
    val availableGroups = remember(displayEntries, completeGroupCounts, hiddenGroupKey, groupSortMode, channelNameOrder) {
        val providerGroups = (completeGroupCounts.keys + displayEntries
            .mapNotNull { it.second.group?.takeIf(String::isNotBlank) }
            .map { it.trim() }
            )
            .distinct()
            .filter { group ->
                playlists.any { playlist ->
                    playlist.hiddenGroupTitles.none { it.equals(group, ignoreCase = true) }
                }
            }
        listOf("Todos", "Favoritos", "Recientes") + sortTvCategoryNames(providerGroups, groupSortMode, channelNameOrder)
    }
    val groupRailGroups = remember(availableGroups, groupSearchQuery) {
        val query = groupSearchQuery.trim()
        if (query.isEmpty()) availableGroups else availableGroups.filter { it.contains(query, ignoreCase = true) }
    }
    val groupRailFocusRequesters = remember(groupRailGroups) {
        List((groupRailGroups.size - 1).coerceAtLeast(0)) { FocusRequester() }
    }
    val groupMembershipKey = remember(availableGroups, channelNameOrder) {
        availableGroups.sortedWith(channelNameOrder).joinToString("\u0001")
    }
    LaunchedEffect(availableGroups) {
        if (selectedGroup !in availableGroups) selectedGroup = availableGroups.firstOrNull() ?: "Todos"
    }
    LaunchedEffect(selectedGroup, playlists.map { it.id }, radioOnly, searchQuery, liveSort) {
        channelLimit = 100
        groupChannels = emptyMap()
        if (selectedGroup != "Todos" || searchQuery.isNotBlank() || liveSort == TvLiveSort.SERVER) {
            nameSortedChannels = emptyMap()
            nameSortedPagesHaveMore = false
        }
        if (searchQuery.isNotBlank() || selectedGroup in setOf("Todos", "Favoritos", "Recientes")) return@LaunchedEffect
        val requestedGroup = selectedGroup
        loadingMoreChannels = true
        try {
            val pages = withContext(Dispatchers.IO) {
                playlists.associate { playlist ->
                    val page = repository.loadChannelGroupPage(
                        playlist.id,
                        selectedGroup,
                        offset = 0,
                        limit = 500,
                        radioOnly = radioOnly,
                        sortByName = liveSort != TvLiveSort.SERVER,
                        descending = liveSort == TvLiveSort.NAME_DESC,
                    )
                    playlist.id to page
                }
            }
            if (selectedGroup == requestedGroup && searchQuery.isBlank()) {
                groupChannels = pages
            }
            val epg = withContext(Dispatchers.IO) {
                playlists.associate { playlist ->
                    val page = pages[playlist.id].orEmpty()
                    playlist.id to repository.loadEpgSnapshot(listOf(playlist.copy(channels = page)))
                }.values.fold(emptyMap<String, List<TvEpgEntry>>()) { result, next -> result + next }
            }
            if (selectedGroup == requestedGroup && searchQuery.isBlank()) {
                extraEpg = extraEpg + epg
            }
        } finally {
            loadingMoreChannels = false
        }
    }
    LaunchedEffect(selectedGroup, searchQuery, playlists.map { it.id }, radioOnly, liveSort) {
        if (selectedGroup != "Todos" || searchQuery.isNotBlank() || liveSort == TvLiveSort.SERVER) {
            nameSortedChannels = emptyMap()
            nameSortedPagesHaveMore = false
            return@LaunchedEffect
        }
        channelLimit = 100
        nameSortedChannels = emptyMap()
        nameSortedPagesHaveMore = false
        loadingMoreChannels = true
        try {
            val pages = withContext(Dispatchers.IO) {
                playlists.associate { playlist ->
                    playlist.id to repository.loadChannelPage(
                        playlist.id,
                        offset = 0,
                        limit = 500,
                        radioOnly = radioOnly,
                        sortByName = true,
                        descending = liveSort == TvLiveSort.NAME_DESC,
                    )
                }
            }
            nameSortedChannels = pages
            nameSortedPagesHaveMore = pages.values.any { it.size == 500 }
            val epg = withContext(Dispatchers.IO) {
                playlists.associate { playlist ->
                    playlist.id to repository.loadEpgSnapshot(listOf(playlist.copy(channels = pages[playlist.id].orEmpty())))
                }.values.fold(emptyMap<String, List<TvEpgEntry>>()) { result, next -> result + next }
            }
            extraEpg = extraEpg + epg
        } finally {
            loadingMoreChannels = false
        }
    }
    LaunchedEffect(searchQuery, playlists.map { it.id }, radioOnly, channelLimit, liveSort) {
        val normalized = searchQuery.trim()
        if (normalized.isBlank()) {
            searchedChannels = emptyMap()
        } else {
            delay(150)
            searchedChannels = withContext(Dispatchers.IO) {
                playlists.associate { playlist ->
                    val window = tvLiveSearchWindow(channelLimit)
                    val previous = searchedChannels[playlist.id].orEmpty().take(window.keepPrevious)
                    playlist.id to repository.searchChannels(
                        playlist.id,
                        normalized,
                        // Grow the search with bounded SQLite pages. Keep one
                        // sentinel row to detect another page without COUNT(*).
                        limit = window.limit,
                        radioOnly = radioOnly,
                        offset = window.offset,
                        sortByName = liveSort != TvLiveSort.SERVER,
                        descending = liveSort == TvLiveSort.NAME_DESC,
                    ).let { previous + it }
                }
            }
        }
    }
    val searchableEntries = if (searchQuery.isBlank()) {
        if (selectedGroup == "Todos" && liveSort != TvLiveSort.SERVER) {
            playlists.flatMap { playlist -> nameSortedChannels[playlist.id].orEmpty().map { playlist.id to it } }
        } else if (selectedGroup in setOf("Todos", "Favoritos", "Recientes")) displayEntries
        else playlists.flatMap { playlist -> groupChannels[playlist.id].orEmpty().map { playlist.id to it } }
    } else {
        playlists.flatMap { playlist -> searchedChannels[playlist.id].orEmpty().map { playlist.id to it } }
    }
    val channels = remember(
        searchableEntries,
        hiddenCategoryKey,
        playlists,
        selectedGroup,
        favoriteKeys,
        recentOrder,
        liveSort,
        searchQuery,
    ) {
        searchableEntries
            .filter { (playlistId, channel) ->
                if (isLiveCategoryHidden(playlistId, channel)) return@filter false
                val hidden = playlists.firstOrNull { it.id == playlistId }
                    ?.hiddenGroupTitles.orEmpty()
                if (channel.group?.isNotBlank() == true && hidden.any { it.equals(channel.group, ignoreCase = true) }) {
                    return@filter false
                }
                when (selectedGroup) {
                    "Todos" -> true
                    "Favoritos" -> "$playlistId:${channel.id}" in favoriteKeys
                    "Recientes" -> "$playlistId:${channel.id}" in recentOrder
                    else -> channel.group.equals(selectedGroup, ignoreCase = true)
                }
            }
            .filter { tvChannelMatchesLiveSearch(it.second, searchQuery) }
            .let { visible ->
                when {
                    selectedGroup == "Recientes" -> visible.sortedBy { (playlistId, channel) -> recentOrder["$playlistId:${channel.id}"] ?: Int.MAX_VALUE }
                    selectedGroup == "Favoritos" && liveSort == TvLiveSort.NAME_ASC -> visible.sortedWith(compareBy(channelNameOrder) { it.second.name })
                    selectedGroup == "Favoritos" && liveSort == TvLiveSort.NAME_DESC -> visible.sortedWith(compareByDescending(channelNameOrder) { it.second.name })
                    else -> visible
                }
            }
    }
    val visibleChannels = remember(channels, channelLimit) { channels.take(channelLimit) }
    val namedGroup = selectedGroup !in setOf("Todos", "Favoritos", "Recientes")
    val namedGroupTotal = completeGroupCounts.entries
        .filter { it.key.equals(selectedGroup, ignoreCase = true) }
        .sumOf { it.value }
    val namedGroupLoaded = groupChannels.values.sumOf { it.size }
    val canLoadMoreChannels = if (searchQuery.isBlank() && namedGroup) {
        channels.size > channelLimit || namedGroupLoaded < namedGroupTotal
    } else if (searchQuery.isBlank() && selectedGroup == "Todos" && liveSort != TvLiveSort.SERVER) {
        channels.size > channelLimit || nameSortedPagesHaveMore
    } else if (searchQuery.isBlank()) {
        channels.size > channelLimit || (!sourcePagesExhausted && sourceEntries.size < totalChannelCount)
    } else {
        searchedChannels.values.any { it.size > channelLimit }
    }
    suspend fun loadMoreChannels() {
        if (loadingMoreChannels || !canLoadMoreChannels) return
        loadingMoreChannels = true
        try {
            if (searchQuery.isBlank() && namedGroup) {
                val nextLimit = channelLimit + 500
                if (namedGroupLoaded < namedGroupTotal) {
                    val loaded = withContext(Dispatchers.IO) {
                        val pages = playlists.associate { playlist ->
                            val existing = groupChannels[playlist.id].orEmpty()
                            val page = repository.loadChannelGroupPage(
                                playlist.id,
                                selectedGroup,
                                offset = existing.size,
                                limit = 500,
                                radioOnly = radioOnly,
                                sortByName = liveSort != TvLiveSort.SERVER,
                                descending = liveSort == TvLiveSort.NAME_DESC,
                            )
                            playlist.id to (existing + page)
                        }
                        val epg = playlists.associate { playlist ->
                            val added = pages[playlist.id].orEmpty().drop(groupChannels[playlist.id].orEmpty().size)
                            playlist.id to repository.loadEpgSnapshot(listOf(playlist.copy(channels = added)))
                        }.values.fold(emptyMap<String, List<TvEpgEntry>>()) { result, next -> result + next }
                        pages to epg
                    }
                    groupChannels = loaded.first
                    extraEpg = extraEpg + loaded.second
                }
                channelLimit = nextLimit
            } else if (searchQuery.isBlank() && selectedGroup == "Todos" && liveSort != TvLiveSort.SERVER) {
                val nextLimit = channelLimit + 500
                if (nextLimit > nameSortedChannels.values.sumOf { it.size } && nameSortedPagesHaveMore) {
                    val loaded = withContext(Dispatchers.IO) {
                        val pageResults = playlists.associate { playlist ->
                            val existing = nameSortedChannels[playlist.id].orEmpty()
                            val page = repository.loadChannelPage(
                                playlist.id,
                                offset = existing.size,
                                limit = 500,
                                radioOnly = radioOnly,
                                sortByName = true,
                                descending = liveSort == TvLiveSort.NAME_DESC,
                            )
                            playlist.id to ((existing + page) to page.size)
                        }
                        val epg = playlists.associate { playlist ->
                            val added = pageResults[playlist.id]?.first.orEmpty().drop(nameSortedChannels[playlist.id].orEmpty().size)
                            playlist.id to repository.loadEpgSnapshot(listOf(playlist.copy(channels = added)))
                        }.values.fold(emptyMap<String, List<TvEpgEntry>>()) { result, next -> result + next }
                        pageResults.mapValues { it.value.first } to (pageResults.values.any { it.second == 500 } to epg)
                    }
                    nameSortedChannels = loaded.first
                    nameSortedPagesHaveMore = loaded.second.first
                    extraEpg = extraEpg + loaded.second.second
                }
                channelLimit = nextLimit
            } else if (searchQuery.isBlank()) {
                // SQLite pages are 500 channels; fetch only as the focused TV
                // list approaches its end, rather than making users activate
                // a separate "load more" row for every page.
                val nextLimit = channelLimit + 500
                if (nextLimit > sourceEntries.size && !sourcePagesExhausted) {
                    val loaded = withContext(Dispatchers.IO) {
                        val target = extraChannels.toMutableMap()
                        val loadedEpg = mutableMapOf<String, List<TvEpgEntry>>()
                        var anyPageLoaded = false
                        playlists.forEach { playlist ->
                            val existing = target[playlist.id].orEmpty()
                            val page = repository.loadChannelPage(
                                playlist.id,
                                offset = playlist.channels.count { it.radio == radioOnly } + existing.size,
                                limit = 500,
                                radioOnly = radioOnly,
                            )
                            if (page.isNotEmpty()) {
                                anyPageLoaded = true
                                target[playlist.id] = existing + page
                                val pageEpg = repository.loadEpgSnapshot(listOf(playlist.copy(channels = page)))
                                loadedEpg.putAll(pageEpg)
                            }
                        }
                        Triple(target, loadedEpg, anyPageLoaded)
                    }
                    extraChannels = loaded.first
                    extraEpg = extraEpg + loaded.second
                    if (!loaded.third) sourcePagesExhausted = true
                }
                channelLimit = nextLimit
            } else {
                // Search results are queried directly from SQLite in bounded
                // 200-row pages; don't fetch unrelated unfiltered channels.
                channelLimit += 200
            }
        } finally {
            loadingMoreChannels = false
        }
    }
    LaunchedEffect(playlists.map { it.id to it.channels.size }, radioOnly) {
        selectedGroup = "Todos"
        searchQuery = ""
        numericBuffer = ""
        channelLimit = 100
        sourcePagesExhausted = false
        extraChannels = emptyMap()
        nameSortedChannels = emptyMap()
        nameSortedPagesHaveMore = false
        groupChannels = emptyMap()
        extraEpg = emptyMap()
        val stats = withContext(Dispatchers.IO) {
            val total = playlists.sumOf { playlist ->
                val counts = repository.loadPlaylistCounts(playlist.id)
                if (radioOnly) counts.radio else counts.channels - counts.radio
            }
            val groups = playlists
                .flatMap { playlist -> repository.loadChannelGroupCounts(playlist.id, radioOnly).entries }
                .groupBy { it.key }
                .mapValues { (_, entries) -> entries.sumOf { it.value } }
            total to groups
        }
        totalChannelCount = stats.first
        completeGroupCounts = stats.second
    }
    val firstChannelItemIndex =
        (if (!groupRailVisible && availableGroups.isNotEmpty()) 1 else 0) +
            1 + if (numericBuffer.isNotBlank()) 1 else 0
    val stalkerPreviewInFlight = remember { mutableSetOf<String>() }
    LaunchedEffect(
        stalkerPlaylistIds,
        visibleChannels,
        epgByChannel,
        extraEpg,
        channelListVisible,
        firstChannelItemIndex,
        radioOnly,
        epgOffsetMinutes,
    ) {
        if (radioOnly || stalkerPlaylistIds.isEmpty() || !channelListVisible) return@LaunchedEffect
        snapshotFlow {
            val now = epgProviderNowMs(System.currentTimeMillis(), epgOffsetMinutes)
            channelListState.layoutInfo.visibleItemsInfo.mapNotNull { visibleItem ->
                val channelIndex = visibleItem.index - firstChannelItemIndex
                val (playlistId, channel) = visibleChannels.getOrNull(channelIndex) ?: return@mapNotNull null
                if (playlistId !in stalkerPlaylistIds) return@mapNotNull null
                val key = "$playlistId:${channel.id}"
                val existingEntries = epgByChannel[key].orEmpty() + extraEpg[key].orEmpty()
                val hasCurrentProgram = existingEntries.any { it.startMs <= now && it.endMs > now }
                if (hasCurrentProgram) null else playlistId to channel
            }.distinctBy { (playlistId, channel) -> "$playlistId:${channel.id}" }
        // Keep an in-flight portal request alive as the LazyColumn publishes
        // transient viewport snapshots during row/layout recomposition. A
        // collectLatest cancellation here can discard a successfully fetched
        // short EPG before its result reaches the visible row.
        }.distinctUntilChanged().collect { targets ->
            val boundedTargets = targets.take(30)
            boundedTargets.forEachIndexed { index, (playlistId, channel) ->
                val key = "$playlistId:${channel.id}"
                val requestedAt = stalkerPreviewFetchedAt[key]
                    ?.takeIf { stalkerPreviewFetchedOffset[key] == epgOffsetMinutes }
                if (requestedAt == null || System.currentTimeMillis() - requestedAt >= 5 * 60_000L) {
                    while (!stalkerPreviewInFlight.add(key)) delay(100)
                    try {
                        val mappingOverrideExists = withContext(Dispatchers.IO) {
                            !repository.loadEpgMapping(playlistId, channel.id).isNullOrBlank()
                        }
                        if (mappingOverrideExists) {
                            stalkerPreviewFetchedAt[key] = System.currentTimeMillis()
                            stalkerPreviewFetchedOffset[key] = epgOffsetMinutes
                            return@forEachIndexed
                        }
                        val entries = stalkerPreviewSemaphore.withPermit {
                            withContext(Dispatchers.IO) {
                                repository.loadStalkerShortEpg(
                                    playlistId,
                                    channel.id,
                                    size = stalkerShortEpgWindowSize(epgOffsetMinutes),
                                )
                            }
                        }
                        stalkerPreviewFetchedAt[key] = System.currentTimeMillis()
                        stalkerPreviewFetchedOffset[key] = epgOffsetMinutes
                        if (entries.isNotEmpty()) {
                            stalkerPreviewEpg = stalkerPreviewEpg + (key to entries)
                        }
                    } catch (cancelled: kotlinx.coroutines.CancellationException) {
                        throw cancelled
                    } catch (_: Throwable) {
                        // A portal without short EPG is cached too, so row composition never retries it in a loop.
                        stalkerPreviewFetchedAt[key] = System.currentTimeMillis()
                        stalkerPreviewFetchedOffset[key] = epgOffsetMinutes
                    } finally {
                        stalkerPreviewInFlight.remove(key)
                    }
                }
                if (index < boundedTargets.lastIndex) delay(200)
            }
        }
    }
    val xtreamPreviewSemaphore = remember { Semaphore(2) }
    val xtreamPreviewInFlight = remember { mutableSetOf<String>() }
    LaunchedEffect(
        xtreamPlaylistIds,
        visibleChannels,
        epgByChannel,
        extraEpg,
        visibleXtreamEpgPreviews,
        channelListVisible,
        firstChannelItemIndex,
        radioOnly,
        epgOffsetMinutes,
        preferUploadedEpgOverXtream,
    ) {
        if (radioOnly || xtreamPlaylistIds.isEmpty() || !channelListVisible) return@LaunchedEffect
        snapshotFlow {
            val now = epgProviderNowMs(System.currentTimeMillis(), epgOffsetMinutes)
            channelListState.layoutInfo.visibleItemsInfo.mapNotNull { visibleItem ->
                val channelIndex = visibleItem.index - firstChannelItemIndex
                val (playlistId, channel) = visibleChannels.getOrNull(channelIndex) ?: return@mapNotNull null
                if (playlistId !in xtreamPlaylistIds) return@mapNotNull null
                val key = "$playlistId:${channel.id}"
                val manualEntries = epgByChannel[key].orEmpty() + extraEpg[key].orEmpty()
                val manualHasCurrent = manualEntries.any { it.startMs <= now && it.endMs > now }
                val cached = visibleXtreamEpgPreviews[key]
                val cacheIsFresh = isFreshXtreamEpgPreview(cached, epgOffsetMinutes)
                if ((preferUploadedEpgOverXtream && manualHasCurrent) || cacheIsFresh) null else playlistId to channel
            }.distinctBy { (playlistId, channel) -> "$playlistId:${channel.id}" }
        }.distinctUntilChanged().collect { targets ->
            val boundedTargets = targets.take(30)
            boundedTargets.forEachIndexed { index, (playlistId, channel) ->
                val key = "$playlistId:${channel.id}"
                if (xtreamPreviewInFlight.add(key)) {
                    val now = System.currentTimeMillis()
                    val preview = try {
                        val entries = xtreamPreviewSemaphore.withPermit {
                            withContext(Dispatchers.IO) {
                                repository.loadXtreamShortEpg(playlistId, channel.id, limit = 10)
                            }
                        }
                        TvXtreamEpgPreview(entries, now, epgOffsetMinutes)
                    } catch (cancelled: kotlinx.coroutines.CancellationException) {
                        throw cancelled
                    } catch (_: Throwable) {
                        TvXtreamEpgPreview(emptyList(), now, epgOffsetMinutes, failed = true)
                    } finally {
                        xtreamPreviewInFlight.remove(key)
                    }
                    visibleXtreamEpgPreviews = (visibleXtreamEpgPreviews - key + (key to preview))
                        .entries.toList().takeLast(500).associate { it.key to it.value }
                    onXtreamEpgPreviewLoaded(key, preview)
                }
                if (index < boundedTargets.lastIndex) delay(200)
            }
        }
    }
    LaunchedEffect(selectedGroup, searchQuery, channelListVisible) {
        if (channelListVisible) channelListState.scrollToItem(0)
    }
    LaunchedEffect(pendingFirstChannelFocus, selectedGroup, channelListVisible, visibleChannels.firstOrNull()) {
        if (!pendingFirstChannelFocus || !channelListVisible || visibleChannels.isEmpty()) return@LaunchedEffect
        repeat(20) {
            withFrameNanos { }
            val focused = runCatching { firstChannelFocusRequester.requestFocus() }.getOrDefault(false)
            if (focused) {
                pendingFirstChannelFocus = false
                return@LaunchedEffect
            }
            delay(50)
        }
        pendingFirstChannelFocus = false
    }
    LaunchedEffect(
        channelListVisible,
        groupRailVisible,
        numericBuffer,
        channelLimit,
        visibleChannels.size,
        sourceEntries.size,
        canLoadMoreChannels,
        loadingMoreChannels,
    ) {
        if (!channelListVisible || !canLoadMoreChannels || loadingMoreChannels) return@LaunchedEffect
        snapshotFlow { channelListState.layoutInfo.visibleItemsInfo.lastOrNull()?.index }
            .distinctUntilChanged()
            .collect { lastVisibleIndex ->
                if (shouldPrefetchLiveChannelPage(
                        lastVisibleItemIndex = lastVisibleIndex,
                        firstChannelItemIndex = firstChannelItemIndex,
                        visibleChannelCount = visibleChannels.size,
                        loadedChannelCount = channelLimit,
                        totalChannelCount = channelLimit + 1,
                    )
                ) {
                    loadMoreChannels()
                }
            }
    }
    LaunchedEffect(numericBuffer, channels) {
        if (numericBuffer.isBlank()) return@LaunchedEffect
        delay(TV_CHANNEL_NUMBER_INPUT_TIMEOUT_MS)
        val requested = numericBuffer.toIntOrNull()
        numericBuffer = ""
        if (requested == null || requested <= 0) return@LaunchedEffect
        val target = withContext(Dispatchers.IO) {
            val position = tvChannelPositionForNumber(requested) ?: return@withContext null
            playlists.singleOrNull()?.let { playlist ->
                // The displayed list may be grouped, filtered or alphabetised;
                // numeric entry must remain stable in the playlist's source order.
                repository.loadChannelAtPosition(playlist.id, position, radioOnly)
                    ?.let { playlist.id to it }
            }
        }
        target?.let { (playlistId, channel) -> onPlay(playlistId, channel, emptyList(), TvChannelZapScope()) }
    }
    LaunchedEffect(groupMembershipKey, completeGroupCounts, channels.isNotEmpty(), selectedGroup, searchQuery) {
        // A playlist can render its first 100 cached channels before the full
        // group counts finish loading. In that window the first group card is
        // not necessarily attached yet, so one early focus request can be
        // lost and leave the sidebar focused. Retry after the group model
        // changes and until Compose has attached the card. Once the user leaves
        // the default group or starts a search, never steal focus back here.
        if (selectedGroup == "Todos" && searchQuery.isBlank() && channels.isNotEmpty()) {
            // Cold starts attach the rail well after the first frame; keep
            // trying long enough that the remote never starts with no focus
            // (the first D-pad press would otherwise land in the search field
            // and pop the keyboard).
            repeat(30) {
                delay(100)
                val focused = runCatching { firstGroupFocusRequester.requestFocus() }.getOrDefault(false)
                if (focused) return@LaunchedEffect
            }
        }
    }
    // Keep the channel column visually subordinate to the live player, as in
    // the original three-pane layout. TV text and artwork are scaled up, so it
    // stays slightly wider than the desktop reference without taking over the
    // available playback surface on 1080p devices.
    val channelListWidth = if (LocalConfiguration.current.screenWidthDp >= 900) 240.dp else 220.dp
    // Read the menu state in the parent composition; the LazyColumn DSL is
    // subcomposed and must receive a fresh option list when this toggles.
    val showGroupSortOptions = groupSortMenuExpanded
    Column(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TvScreenTitle(
                if (radioOnly) "Radio" else "TV en directo",
                eyebrow = "${if (totalChannelCount > 0) totalChannelCount else channels.size} ${if (radioOnly) "emisoras" else "canales"}",
                modifier = Modifier.widthIn(max = 280.dp),
            )
            Spacer(Modifier.weight(1f))
            androidx.compose.runtime.CompositionLocalProvider(LocalTvFocusRadius provides 999.dp) {
                // The Google TV IME opens as soon as an editor gains focus, so
                // D-pad traversal lands on this pill instead; OK swaps in the
                // editor, and leaving the editor swaps the pill back with focus.
                LaunchedEffect(liveSearchEditing) {
                    if (liveSearchEditing) {
                        repeat(10) {
                            withFrameNanos { }
                            if (runCatching { liveSearchFieldFocusRequester.requestFocus() }.getOrDefault(false)) return@LaunchedEffect
                        }
                    } else if (liveSearchFieldHadFocus) {
                        liveSearchFieldHadFocus = false
                        repeat(10) {
                            withFrameNanos { }
                            if (runCatching { liveSearchPillFocusRequester.requestFocus() }.getOrDefault(false)) return@LaunchedEffect
                        }
                    }
                }
                val leaveSearchDown = {
                    liveSearchEditing = false
                    liveSearchFieldHadFocus = false
                    runCatching { (if (groupRailVisible) firstGroupFocusRequester else firstChannelFocusRequester).requestFocus() }
                }
                if (!liveSearchEditing) {
                    TvCard(
                        onClick = { liveSearchEditing = true },
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                        modifier = Modifier
                            .width(210.dp)
                            .height(48.dp)
                            .focusRequester(liveSearchPillFocusRequester)
                            .focusProperties {
                                if (channelListVisible) {
                                    down = if (groupRailVisible) firstGroupFocusRequester else firstChannelFocusRequester
                                }
                                topBarFocusRequester?.let { up = it }
                            }
                            .semantics { contentDescription = "Buscar canal" }
                            .tvDpadClick { liveSearchEditing = true },
                        colors = androidx.tv.material3.CardDefaults.colors(
                            containerColor = tvTone(TvTone.Surface).copy(alpha = 0.9f),
                            focusedContainerColor = tvTone(TvTone.SurfaceHigh),
                        ),
                    ) {
                        Row(Modifier.fillMaxSize().padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                            SidebarGlyph(TvSection.Search, TvMuted)
                            Text(
                                searchQuery.ifBlank { "Buscar canal" },
                                modifier = Modifier.padding(start = 10.dp).weight(1f),
                                color = if (searchQuery.isBlank()) TvMuted else TvText,
                                fontSize = 12.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            TvKeyHint("OK", "")
                        }
                    }
                } else {
                    TvOutlinedTextField(
                        value = searchQuery,
                        onValueChange = {
                            if (it != searchQuery) {
                                searchQuery = it
                                channelLimit = 100
                                searchedChannels = emptyMap()
                            }
                        },
                        placeholder = { Text("Buscar canal", color = TvMuted, fontSize = 12.sp, maxLines = 1) },
                        leadingIcon = { SidebarGlyph(TvSection.Search, tvTone(TvTone.Accent)) },
                        singleLine = true,
                        shape = RoundedCornerShape(50),
                        textStyle = androidx.compose.ui.text.TextStyle(fontSize = 12.sp, color = TvText),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        keyboardActions = KeyboardActions(onSearch = {
                            liveKeyboardController?.hide()
                            liveSearchEditing = false
                        }),
                        modifier = Modifier
                            .width(210.dp)
                            .height(48.dp)
                            .focusRequester(liveSearchFieldFocusRequester)
                            .onFocusChanged { state ->
                                if (state.isFocused) liveSearchFieldHadFocus = true
                                else if (liveSearchFieldHadFocus) liveSearchEditing = false
                            }
                            .onPreviewKeyEvent { event ->
                                if (event.type != KeyEventType.KeyDown || imeVisible) return@onPreviewKeyEvent false
                                when (event.nativeKeyEvent.keyCode) {
                                    KeyEvent.KEYCODE_DPAD_DOWN -> if (channelListVisible) {
                                        leaveSearchDown(); true
                                    } else false
                                    KeyEvent.KEYCODE_DPAD_UP -> {
                                        liveSearchEditing = false
                                        true
                                    }
                                    else -> false
                                }
                            },
                    )
                }
                TvToggleChip(
                    label = "Lista",
                    active = channelListVisible,
                    onClick = { channelListVisible = !channelListVisible },
                )
                TvToggleChip(
                    label = "Grupos",
                    active = groupRailVisible,
                    onClick = { groupRailVisible = !groupRailVisible },
                )
            }
            TvLiveSortControls(liveSort, onSortSelected = {
                liveSort = it
                sortPreferences.edit().putString(liveSortKey, it.name).apply()
            })
        }
        Row(modifier = Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            if (channelListVisible && groupRailVisible) androidx.compose.runtime.key(showGroupSortOptions) {
                LazyColumn(
                // Keep the group rail compact like the original three-panel
                // layout while reserving enough width for provider group names
                // and their separate counts on a ten-foot screen. IPTV
                // playlists can contain hundreds of categories, so compose
                // only the visible/focused rows instead of building the whole
                // rail on every screen entry.
                state = groupRailListState,
                modifier = Modifier.width(168.dp).fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                item(key = "live-groups-heading") {
                    if (groupSearchOpen) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            TvOutlinedTextField(
                                value = groupSearchQuery,
                                onValueChange = { groupSearchQuery = it },
                                placeholder = { Text("Buscar grupo", color = TvMuted, fontSize = 10.sp, maxLines = 1) },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                                keyboardActions = KeyboardActions(onSearch = { liveKeyboardController?.hide() }),
                                modifier = Modifier
                                    .weight(1f)
                                    .height(48.dp)
                                    .focusRequester(groupSearchFieldFocusRequester)
                                    .focusProperties {
                                        right = groupSearchCloseFocusRequester
                                        down = firstGroupFocusRequester
                                    }
                                    .onPreviewKeyEvent { event ->
                                        if (
                                            event.type == KeyEventType.KeyDown &&
                                            !imeVisible
                                        ) {
                                            when (event.nativeKeyEvent.keyCode) {
                                                KeyEvent.KEYCODE_DPAD_DOWN -> {
                                                    val target = if (groupRailGroups.isNotEmpty()) {
                                                        firstGroupFocusRequester
                                                    } else {
                                                        groupSearchCloseFocusRequester
                                                    }
                                                    runCatching { target.requestFocus() }
                                                    true
                                                }
                                                KeyEvent.KEYCODE_DPAD_RIGHT -> {
                                                    runCatching { groupSearchCloseFocusRequester.requestFocus() }
                                                    true
                                                }
                                                else -> false
                                            }
                                        } else {
                                            false
                                        }
                                    }
                                    .semantics { contentDescription = "Buscar grupos" },
                            )
                            TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                                onClick = ::closeGroupSearch,
                                modifier = Modifier
                                    .width(28.dp)
                                    .height(40.dp)
                                    .focusRequester(groupSearchCloseFocusRequester)
                                    .focusProperties {
                                        left = groupSearchFieldFocusRequester
                                        down = firstGroupFocusRequester
                                    }
                                    .tvDpadClick(::closeGroupSearch)
                                    .semantics { contentDescription = "Cerrar búsqueda de grupos" },
                                colors = androidx.tv.material3.CardDefaults.colors(
                                    containerColor = Color.Transparent,
                                    focusedContainerColor = tvColor(Color(0xFF2C3445)),
                                ),
                            ) {
                                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                    Text("×", color = TvText, fontSize = 18.sp)
                                }
                            }
                        }
                    } else {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            TvRailPill(
                                label = "Gestionar",
                                onClick = { manageGroupsVisible = true },
                                modifier = Modifier
                                    .weight(1f)
                                    .focusRequester(manageGroupsFocusRequester)
                                    .focusProperties {
                                        right = manageCategoriesFocusRequester
                                        down = groupSearchButtonFocusRequester
                                    },
                            )
                            TvRailPill(
                                label = "Categorías",
                                onClick = { manageCategoriesVisible = true },
                                modifier = Modifier
                                    .weight(1f)
                                    .focusRequester(manageCategoriesFocusRequester)
                                    .focusProperties {
                                        left = manageGroupsFocusRequester
                                        down = groupSortButtonFocusRequester
                                    },
                            )
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            TvEyebrow("Grupos", color = TvMuted, modifier = Modifier.padding(start = 4.dp))
                            Spacer(Modifier.weight(1f))
                            TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                                onClick = { groupSearchOpen = true },
                                modifier = Modifier
                                    .width(34.dp)
                                    .height(34.dp)
                                    .focusRequester(groupSearchButtonFocusRequester)
                                    .focusProperties {
                                        right = groupSortButtonFocusRequester
                                        up = manageGroupsFocusRequester
                                        down = firstGroupFocusRequester
                                    }
                                    .tvDpadClick { groupSearchOpen = true }
                                    .semantics { contentDescription = "Buscar grupos" },
                                colors = androidx.tv.material3.CardDefaults.colors(
                                    containerColor = Color.Transparent,
                                    focusedContainerColor = tvColor(Color(0xFF2C3445)),
                                ),
                            ) {
                                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                    SidebarGlyph(TvSection.Search, TvMuted)
                                }
                            }
                            TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                                onClick = ::openGroupSortMenu,
                                modifier = Modifier
                                    .width(40.dp)
                                    .height(34.dp)
                                    .focusRequester(groupSortButtonFocusRequester)
                                    .focusProperties {
                                        left = groupSearchButtonFocusRequester
                                        up = manageCategoriesFocusRequester
                                        down = firstGroupFocusRequester
                                    }
                                    .tvDpadClick(::openGroupSortMenu)
                                    .semantics {
                                        contentDescription = "Orden de grupos: ${groupSortMode.menuLabel}"
                                    },
                                colors = androidx.tv.material3.CardDefaults.colors(
                                    containerColor = Color.Transparent,
                                    focusedContainerColor = tvColor(Color(0xFF2C3445)),
                                ),
                            ) {
                                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                    Text(
                                        groupSortMode.buttonLabel,
                                        color = if (groupSortMode == TvCategorySortMode.SERVER) TvMuted else tvColor(Color(0xFF78ADFF)),
                                        fontSize = 8.sp,
                                        maxLines = 1,
                                    )
                                }
                            }
                        }
                        }
                    }
                }
                if (showGroupSortOptions) {
                    item(key = "live-group-sort-heading") {
                        Text("Ordenar grupos", color = TvMuted, fontSize = 10.sp, modifier = Modifier.padding(start = 6.dp, top = 4.dp))
                    }
                    itemsIndexed(
                        items = TvCategorySortMode.entries,
                        key = { _, mode -> "live-group-sort-${mode.name}" },
                    ) { index, mode ->
                        var optionFocused by remember(mode) { mutableStateOf(false) }
                        TvButton(
                            onClick = { selectGroupSortMode(mode) },
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(36.dp)
                                .focusRequester(groupSortOptionFocusRequesters[index])
                                .focusProperties {
                                    up = if (index == 0) groupSortButtonFocusRequester else groupSortOptionFocusRequesters[index - 1]
                                    down = if (index == groupSortOptionFocusRequesters.lastIndex) {
                                        firstGroupFocusRequester
                                    } else {
                                        groupSortOptionFocusRequesters[index + 1]
                                    }
                                }
                                .onFocusChanged { optionFocused = it.isFocused }
                                .tvDpadFocus()
                                .semantics {
                                    contentDescription = if (optionFocused) "${mode.menuLabel}, resaltado" else mode.menuLabel
                                },
                            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
                            colors = androidx.compose.material3.ButtonDefaults.buttonColors(
                                containerColor = if (mode == groupSortMode) tvColor(Color(0xFF304A75)) else tvColor(Color(0xFF20232C)),
                                contentColor = TvText,
                            ),
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(mode.menuLabel, modifier = Modifier.weight(1f), fontSize = 10.sp, maxLines = 1)
                                if (mode == groupSortMode) Text("✓", color = tvColor(Color(0xFF78ADFF)), fontSize = 13.sp)
                            }
                        }
                    }
                }
                itemsIndexed(
                    items = groupRailGroups,
                    key = { _, group -> "live-group-$group" },
                ) { groupIndex, group ->
                        var groupFocused by remember(group) { mutableStateOf(false) }
                        val groupFocusRequester = if (groupIndex == 0) {
                            firstGroupFocusRequester
                        } else {
                            groupRailFocusRequesters[groupIndex - 1]
                        }
                        val count = when (group) {
                        "Todos" -> if (searchQuery.isBlank()) totalChannelCount else channels.size
                        "Favoritos" -> displayEntries.count { (playlistId, channel) -> "$playlistId:${channel.id}" in favoriteKeys }
                        "Recientes" -> displayEntries.count { (playlistId, channel) -> "$playlistId:${channel.id}" in recentOrder }
                        else -> completeGroupCounts.entries
                            .filter { it.key.equals(group, ignoreCase = true) }
                            .sumOf { it.value }
                            .takeIf { it > 0 }
                            ?: displayEntries.count { it.second.group.equals(group, true) }
                    }
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(34.dp)
                            .focusRequester(groupFocusRequester)
                            .focusProperties {
                                right = firstChannelFocusRequester
                                up = when {
                                    groupIndex == 1 -> firstGroupFocusRequester
                                    groupIndex > 1 -> groupRailFocusRequesters[groupIndex - 2]
                                    groupSearchOpen -> groupSearchFieldFocusRequester
                                    else -> groupSearchButtonFocusRequester
                                }
                                if (groupIndex < groupRailGroups.lastIndex) {
                                    down = groupRailFocusRequesters[groupIndex]
                                }
                            }
                            .onPreviewKeyEvent { event ->
                                if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                                when {
                                    event.nativeKeyEvent.keyCode == KeyEvent.KEYCODE_DPAD_RIGHT -> {
                                        requestFirstChannelFocus()
                                        true
                                    }
                                    isInitialTvSelect(event.nativeKeyEvent.keyCode, event.nativeKeyEvent.repeatCount) -> {
                                        selectedGroup = group
                                        true
                                    }
                                    else -> false
                                }
                            }
                            .tvDpadClick(
                                action = { selectedGroup = group },
                                onFocusChange = { focused ->
                                    groupFocused = focused
                                    onGroupFocusChanged(group, focused)
                                },
                            ),
                        shape = RoundedCornerShape(10.dp),
                        colors = androidx.tv.material3.SurfaceDefaults.colors(
                            containerColor = when {
                                selectedGroup == group -> tvColor(Color(0xFF304A75))
                                groupFocused -> tvColor(Color(0xFF536A9F))
                                else -> Color.Transparent
                            },
                        ),
                    ) {
                        Row(modifier = Modifier.fillMaxSize().padding(horizontal = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                group,
                                modifier = Modifier.weight(1f),
                                color = TvText,
                                fontSize = 11.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(count.toString(), color = TvMuted, fontSize = 10.sp)
                        }
                    }
                }
                if (groupRailGroups.isEmpty()) {
                    item(key = "live-groups-search-empty") {
                        Text("Sin grupos coincidentes", color = TvMuted, fontSize = 10.sp)
                    }
                }
            }
            }
            if (channelListVisible) LazyColumn(
                state = channelListState,
                modifier = Modifier
                    // Keep the player as the largest pane while giving channel
                    // names enough room to remain useful from the sofa. At
                    // 1080p, 320dp still leaves a substantial playback surface;
                    // lower-resolution TVs retain the more compact width.
                    .width(channelListWidth)
                    .fillMaxSize()
                    .onPreviewKeyEvent { event ->
                        val digit = event.nativeKeyEvent.keyCode.toTvDigit()
                        if (event.type == KeyEventType.KeyDown && digit != null) {
                            numericBuffer = appendTvChannelNumberDigit(numericBuffer, ('0'.code + digit).toChar())
                            true
                        } else false
                    },
                verticalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                if (!groupRailVisible && availableGroups.isNotEmpty()) {
                    item(key = "live-group-switcher", contentType = "live-group-switcher") {
                        val selectedIndex = availableGroups.indexOf(selectedGroup).coerceAtLeast(0)
                        val nextGroup = availableGroups[(selectedIndex + 1) % availableGroups.size]
                        TvButton(
                            onClick = { selectedGroup = nextGroup },
                            modifier = Modifier.tvDpadFocus(),
                        ) { Text("Grupo: $selectedGroup  ›") }
                    }
                }
                item(key = "live-list-heading", contentType = "live-list-heading") {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(selectedGroup, color = TvText, fontSize = 18.sp)
                        Text("${channels.size} canales", color = TvMuted, fontSize = 11.sp)
                    }
                }
                if (numericBuffer.isNotBlank()) {
                    item(key = "live-channel-number-entry", contentType = "live-channel-number-entry") {
                        Text("Canal $numericBuffer", color = tvColor(Color(0xFF9CC1FF)), fontSize = 12.sp)
                    }
                }
                    itemsIndexed(
                        items = visibleChannels,
                        key = { _, entry -> "${entry.first}:${entry.second.id}" },
                        contentType = { _, _ -> "live-channel" },
                    ) { rowIndex, entry ->
                    val (playlistId, channel) = entry
                    val isFirstChannel = channels.firstOrNull() == (playlistId to channel)
                    val rowChannelFocusRequester = remember(playlistId, channel.id) { FocusRequester() }
                    val rowEpgFocusRequester = remember(playlistId, channel.id) { FocusRequester() }
                    val rowFavoriteFocusRequester = remember(playlistId, channel.id) { FocusRequester() }
                    var rowCardFocused by remember(playlistId, channel.id) { mutableStateOf(false) }
                    var focusedRowAction by remember(playlistId, channel.id) { mutableStateOf<String?>(null) }
                    val channelFocusRequester = if (isFirstChannel) firstChannelFocusRequester else rowChannelFocusRequester
                    val epgFocusRequester = if (isFirstChannel) firstEpgFocusRequester else rowEpgFocusRequester
                    val favoriteFocusRequester = if (isFirstChannel) firstFavoriteFocusRequester else rowFavoriteFocusRequester
                    val item = channel.toSavedItem(playlistId)
                    val isFavorite = "${item.playlistId}:${item.itemKey}" in favoriteKeys
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(52.dp)
                            .focusRequester(channelFocusRequester)
                            .focusProperties {
                                if (groupRailVisible) left = firstGroupFocusRequester
                                right = epgFocusRequester
                            }
                            .onPreviewKeyEvent { event ->
                                val keyCode = event.nativeKeyEvent.keyCode
                                if (focusedRowAction != null && isTvSelectKey(keyCode)) {
                                    if (event.type == KeyEventType.KeyDown &&
                                        isInitialTvSelect(keyCode, event.nativeKeyEvent.repeatCount)
                                    ) {
                                        when (focusedRowAction) {
                                            "epg" -> onEditEpg(playlistId, channel)
                                            "favorite" -> onToggleFavorite(item, !isFavorite)
                                        }
                                    }
                                    // Intercept both phases above the row's
                                    // activation target so one OK cannot run
                                    // the row action and start live playback.
                                    true
                                } else if (rowCardFocused && event.type == KeyEventType.KeyDown) {
                                    when (keyCode) {
                                        KeyEvent.KEYCODE_DPAD_LEFT -> if (groupRailVisible) {
                                            firstGroupFocusRequester.requestFocus()
                                            true
                                        } else false
                                        KeyEvent.KEYCODE_DPAD_RIGHT -> {
                                            epgFocusRequester.requestFocus()
                                            true
                                        }
                                        KeyEvent.KEYCODE_DPAD_CENTER,
                                        KeyEvent.KEYCODE_ENTER -> if (
                                            isInitialTvSelect(keyCode, event.nativeKeyEvent.repeatCount)
                                        ) {
                                            onPlay(playlistId, channel, channels, currentChannelZapScope())
                                            true
                                        } else false
                                        else -> false
                                    }
                                } else false
                            }
                            .tvDpadClick(
                                action = { onPlay(playlistId, channel, channels, currentChannelZapScope()) },
                                onFocusChange = { focused ->
                                    rowCardFocused = focused
                                    onChannelFocusChanged(channel.name, focused)
                                },
                            ),
                        shape = RoundedCornerShape(12.dp),
                        colors = androidx.tv.material3.SurfaceDefaults.colors(
                            containerColor = tvColor(
                                if (rowCardFocused) Color(0xFF304A75) else Color(0xFF202532),
                            ),
                        ),
                    ) {
                        Row(modifier = Modifier.fillMaxSize().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(modifier = Modifier.width(34.dp).height(34.dp).clip(RoundedCornerShape(7.dp)).background(tvColor(Color(0xFF29334B))), contentAlignment = Alignment.Center) {
                                channel.logoUrl?.takeIf(String::isNotBlank)?.let { url ->
                                    AsyncImage(model = url, contentDescription = displayTvChannelName(channel.name, stripCountryPrefixes), modifier = Modifier.fillMaxSize().padding(4.dp), contentScale = ContentScale.Fit)
                                } ?: Text("TV", color = TvMuted, fontSize = 9.sp)
                            }
                            Column(modifier = Modifier.padding(start = 9.dp).weight(1f)) {
                                Text(
                                    "${channel.channelNumber?.takeIf { it > 0 } ?: rowIndex + 1}. ${displayTvChannelName(channel.name, stripCountryPrefixes)}",
                                    color = TvText,
                                    fontSize = 12.sp,
                                    maxLines = 1,
                                )
                                if (showChannelEpg) {
                                    val channelEpgKey = "$playlistId:${channel.id}"
                                    val providerNow = epgProviderNowMs(System.currentTimeMillis(), epgOffsetMinutes)
                                    val previewEntries = when {
                                        playlistId in stalkerPlaylistIds && stalkerPreviewFetchedOffset[channelEpgKey] == epgOffsetMinutes ->
                                            stalkerPreviewEpg[channelEpgKey].orEmpty()
                                        playlistId in xtreamPlaylistIds -> {
                                            val preview = visibleXtreamEpgPreviews[channelEpgKey]
                                            val ttl = if (preview?.failed == true) XTREAM_EPG_PREVIEW_FAILURE_TTL_MS else XTREAM_EPG_PREVIEW_TTL_MS
                                            if (preview != null && preview.offsetMinutes == epgOffsetMinutes &&
                                                System.currentTimeMillis() - preview.fetchedAtMs < ttl
                                            ) preview.entries else emptyList()
                                        }
                                        else -> emptyList()
                                    }
                                    val previewHasCurrent = previewEntries.any {
                                        it.startMs <= providerNow && it.endMs > providerNow
                                    }
                                    val uploadedEntries = epgByChannel[channelEpgKey].orEmpty() + extraEpg[channelEpgKey].orEmpty()
                                    val uploadedHasCurrent = uploadedEntries.any {
                                        it.startMs <= providerNow && it.endMs > providerNow
                                    }
                                    val availableEpgEntries = when {
                                        playlistId in xtreamPlaylistIds && preferUploadedEpgOverXtream && uploadedHasCurrent -> uploadedEntries
                                        previewHasCurrent -> previewEntries
                                        uploadedEntries.isNotEmpty() -> uploadedEntries
                                        else -> previewEntries
                                    }
                                    val programme = selectCurrentOrNextEpgEntry(
                                        availableEpgEntries,
                                        providerNow,
                                    )
                                    Text(programme?.title ?: "No hay información de programa", color = TvMuted, fontSize = 9.sp, maxLines = 1)
                                }
                            }
                            Box(
                                modifier = Modifier
                                    .width(42.dp)
                                    .height(36.dp)
                                    .focusRequester(epgFocusRequester)
                                    .onFocusChanged {
                                        if (it.isFocused) focusedRowAction = "epg"
                                        else if (focusedRowAction == "epg") focusedRowAction = null
                                    }
                                    .focusProperties {
                                        left = channelFocusRequester
                                        right = favoriteFocusRequester
                                    }
                                    .tvDpadClick { onEditEpg(playlistId, channel) }
                                    .onPreviewKeyEvent { event ->
                                        if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                                        when (event.nativeKeyEvent.keyCode) {
                                            KeyEvent.KEYCODE_DPAD_LEFT -> {
                                                channelFocusRequester.requestFocus()
                                                true
                                            }
                                            KeyEvent.KEYCODE_DPAD_RIGHT -> {
                                                favoriteFocusRequester.requestFocus()
                                                true
                                            }
                                            else -> false
                                        }
                                    },
                            ) {
                                Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                                    Text("EPG", color = TvMuted, fontSize = 8.sp)
                                }
                            }
                            Box(
                                modifier = Modifier
                                    .width(36.dp)
                                    .height(36.dp)
                                    .focusRequester(favoriteFocusRequester)
                                    .onFocusChanged {
                                        if (it.isFocused) focusedRowAction = "favorite"
                                        else if (focusedRowAction == "favorite") focusedRowAction = null
                                    }
                                    .focusProperties { left = epgFocusRequester }
                                    .tvDpadClick { onToggleFavorite(item, !isFavorite) }
                                    .onPreviewKeyEvent { event ->
                                        if (event.type == KeyEventType.KeyDown &&
                                            event.nativeKeyEvent.keyCode == KeyEvent.KEYCODE_DPAD_LEFT
                                        ) {
                                            epgFocusRequester.requestFocus()
                                            true
                                        } else false
                                    },
                            ) {
                                Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                                    Text(if (isFavorite) "★" else "☆", color = if (isFavorite) tvColor(Color(0xFFFFD166)) else TvMuted, fontSize = 18.sp)
                                }
                            }
                        }
                    }
                }
                if (canLoadMoreChannels) {
                    item(key = "live-load-more") {
                        TvButton(
                            onClick = { scope.launch { loadMoreChannels() } },
                            modifier = Modifier.tvDpadFocus(),
                            enabled = !loadingMoreChannels,
                        ) { Text(if (loadingMoreChannels) "Cargando canales…" else "Cargar más canales") }
                    }
                }
            }
            Box(modifier = Modifier.weight(1f).fillMaxSize().padding(start = 12.dp, end = 8.dp), contentAlignment = Alignment.Center) {
                TvPlayerStandby(
                    if (channelListVisible) "Selecciona un canal para iniciar la reproducción"
                    else "La lista de canales está oculta",
                    modifier = Modifier.widthIn(max = 520.dp),
                )
            }
        }
    }
    if (manageGroupsVisible) {
        TvManageGroupsDialog(
            playlists = playlists,
            groups = (completeGroupCounts.keys + displayEntries.mapNotNull { it.second.group?.trim()?.takeIf(String::isNotBlank) })
                .distinct().sortedWith(String.CASE_INSENSITIVE_ORDER),
            radioOnly = radioOnly,
            onSave = onSaveHiddenGroups,
            onDismiss = { manageGroupsVisible = false },
        )
    }
    if (manageCategoriesVisible) {
        val liveCategoryOptionsByPlaylist = playlists.associate { playlist ->
            val visible = displayEntries.filter { it.first == playlist.id }.mapNotNull { (_, channel) ->
                val id = channel.providerCategoryId?.takeIf(String::isNotBlank) ?: channel.group?.takeIf(String::isNotBlank)
                id?.let { it to (channel.group?.takeIf(String::isNotBlank) ?: it) }
            }
            val persisted = playlist.hiddenCategories.filter { it.type == "live" }.map { it.id to it.id }
            playlist.id to (visible + persisted).distinctBy { it.first }.sortedBy { it.second.lowercase() }
        }
        TvManageLiveCategoriesDialog(
            playlists = playlists,
            categoriesByPlaylist = liveCategoryOptionsByPlaylist,
            onSave = { playlistId, hidden ->
                scope.launch {
                    val preserved = hiddenCategoryOverrides[playlistId].orEmpty().filter { it.type != "live" }
                    val all = preserved + hidden
                    withContext(Dispatchers.IO) { repository.saveHiddenCategories(playlistId, all) }
                    hiddenCategoryOverrides = hiddenCategoryOverrides + (playlistId to all)
                }
            },
            onDismiss = { manageCategoriesVisible = false },
        )
    }
}

@Composable
private fun TvManageCategoriesDialog(
    playlists: List<StoredPlaylist>,
    categories: List<String>,
    categoryType: String,
    onSave: (String, List<TvHiddenCategory>) -> Unit,
    onDismiss: () -> Unit,
) {
    if (playlists.isEmpty()) {
        TvAlertDialog(
            onDismissRequest = onDismiss,
            title = { Text("Gestionar categorías") },
            text = { Text("No hay playlists disponibles.") },
            confirmButton = { TvButton(onClick = onDismiss, modifier = Modifier.tvDpadClick(onDismiss)) { Text("Cerrar") } },
        )
        return
    }
    var selectedPlaylistId by remember(playlists) { mutableStateOf(playlists.first().id) }
    val selectedPlaylist = playlists.firstOrNull { it.id == selectedPlaylistId } ?: playlists.first()
    var hidden by remember(selectedPlaylist.id, selectedPlaylist.hiddenCategories, categoryType) {
        mutableStateOf(selectedPlaylist.hiddenCategories.filter { it.type == categoryType }.map { it.id }.toSet())
    }
    val available = categories.filter(String::isNotBlank).distinct().sortedWith(String.CASE_INSENSITIVE_ORDER)
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(
            modifier = Modifier.width(520.dp).fillMaxHeight(0.84f).tvHairline(tvTone(TvTone.SurfaceTop), 22f),
            shape = RoundedCornerShape(22.dp),
            colors = androidx.tv.material3.SurfaceDefaults.colors(containerColor = tvTone(TvTone.SurfaceHigh)),
        ) {
            androidx.compose.runtime.CompositionLocalProvider(LocalTvDialogCompact provides true) {
            Column(modifier = Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Gestionar categorías", color = TvText, fontSize = 20.sp, fontFamily = TvType.Display)
                Text(
                    "Oculta categorías de ${if (categoryType == "series") "series" else "películas"} que no quieras mostrar.",
                    color = TvMuted,
                    fontSize = 11.sp,
                )
                if (playlists.size > 1) {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        itemsIndexed(playlists) { _, playlist ->
                            TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                                onClick = {
                                    selectedPlaylistId = playlist.id
                                    hidden = playlist.hiddenCategories.filter { it.type == categoryType }.map { it.id }.toSet()
                                },
                                modifier = Modifier.width(160.dp).height(32.dp).tvDpadClick {
                                    selectedPlaylistId = playlist.id
                                    hidden = playlist.hiddenCategories.filter { it.type == categoryType }.map { it.id }.toSet()
                                },
                                colors = androidx.tv.material3.CardDefaults.colors(
                                    containerColor = if (playlist.id == selectedPlaylist.id) tvColor(Color(0xFF304A75)) else tvColor(Color(0xFF202532)),
                                    focusedContainerColor = tvColor(Color(0xFF536A9F)),
                                ),
                            ) { Text(playlist.name, color = TvText, modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp), fontSize = 11.sp, maxLines = 1) }
                        }
                    }
                }
                if (available.isEmpty()) {
                    Text("No hay categorías disponibles en esta playlist.", color = TvMuted, fontSize = 10.sp)
                } else {
                    Column(modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        available.forEach { category ->
                            val isHidden = hidden.any { it.equals(category, ignoreCase = true) }
                            TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                                onClick = {
                                    hidden = if (isHidden) hidden.filterNot { it.equals(category, ignoreCase = true) }.toSet()
                                    else hidden + category
                                },
                                modifier = Modifier.fillMaxWidth().height(36.dp).tvDpadClick {
                                    hidden = if (isHidden) hidden.filterNot { it.equals(category, ignoreCase = true) }.toSet()
                                    else hidden + category
                                },
                                colors = androidx.tv.material3.CardDefaults.colors(
                                    containerColor = if (isHidden) tvColor(Color(0xFF2A2028)) else tvColor(Color(0xFF202532)),
                                    focusedContainerColor = tvColor(Color(0xFF536A9F)),
                                ),
                            ) {
                                Row(modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Text(if (isHidden) "▢" else "✓", color = if (isHidden) tvColor(Color(0xFFFF9AAB)) else tvColor(Color(0xFF8FC0FF)), fontSize = 14.sp)
                                    Text(category, color = TvText, fontSize = 12.sp, modifier = Modifier.padding(start = 14.dp), maxLines = 1)
                                    Spacer(Modifier.weight(1f))
                                    Text(if (isHidden) "Oculta" else "Visible", color = TvMuted, fontSize = 10.sp)
                                }
                            }
                        }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    TvTextButton(onClick = onDismiss, modifier = Modifier.tvDpadClick(onDismiss)) { Text("Cancelar") }
                    Spacer(Modifier.weight(1f))
                    TvButton(
                        onClick = {
                            val otherTypes = selectedPlaylist.hiddenCategories.filterNot { it.type == categoryType }
                            onSave(selectedPlaylist.id, otherTypes + hidden.map { TvHiddenCategory(categoryType, it) })
                            onDismiss()
                        },
                        modifier = Modifier.tvDpadClick {
                            val otherTypes = selectedPlaylist.hiddenCategories.filterNot { it.type == categoryType }
                            onSave(selectedPlaylist.id, otherTypes + hidden.map { TvHiddenCategory(categoryType, it) })
                            onDismiss()
                        },
                    ) { Text("Guardar") }
                }
            }
            }
        }
    }
}

@Composable
private fun TvManageGroupsDialog(
    playlists: List<StoredPlaylist>,
    groups: List<String>,
    radioOnly: Boolean,
    onSave: (String, List<String>) -> Unit,
    onDismiss: () -> Unit,
) {
    if (playlists.isEmpty()) {
        TvAlertDialog(
            onDismissRequest = onDismiss,
            title = { Text("Gestionar grupos") },
            text = { Text("No hay playlists disponibles.") },
            confirmButton = { TvButton(onClick = onDismiss, modifier = Modifier.tvDpadClick(onDismiss)) { Text("Cerrar") } },
        )
        return
    }
    var selectedPlaylistId by remember(playlists) { mutableStateOf(playlists.first().id) }
    val selectedPlaylist = playlists.firstOrNull { it.id == selectedPlaylistId } ?: playlists.first()
    var hidden by remember(selectedPlaylist.id, selectedPlaylist.hiddenGroupTitles) {
        mutableStateOf(selectedPlaylist.hiddenGroupTitles.toSet())
    }
    var searchQuery by remember(selectedPlaylist.id) { mutableStateOf("") }
    var searchActive by remember(selectedPlaylist.id) { mutableStateOf(false) }
    val visibleGroups = groups.filter { group ->
        // A radio source may have a different group catalogue from TV; the
        // loaded names are still safe to manage because the setting is shared
        // per playlist, as in the original client.
        group.isNotBlank()
    }
    val filteredGroups = remember(visibleGroups, searchQuery) {
        val query = searchQuery.trim()
        if (query.isEmpty()) visibleGroups else visibleGroups.filter { it.contains(query, ignoreCase = true) }
    }
    val visibleGroupCount = visibleGroups.count { group -> hidden.none { it.equals(group, ignoreCase = true) } }
    val showAllFocusRequester = remember { FocusRequester() }
    val hideAllFocusRequester = remember { FocusRequester() }
    val searchButtonFocusRequester = remember { FocusRequester() }
    val searchFocusRequester = remember { FocusRequester() }
    val firstGroupFocusRequester = remember { FocusRequester() }
    val keyboardController = LocalSoftwareKeyboardController.current
    LaunchedEffect(Unit) {
        repeat(5) {
            if (runCatching { showAllFocusRequester.requestFocus() }.getOrDefault(false)) return@LaunchedEffect
            delay(50)
        }
    }
    LaunchedEffect(searchActive) {
        if (searchActive) {
            repeat(5) {
                if (runCatching { searchFocusRequester.requestFocus() }.getOrDefault(false)) {
                    keyboardController?.show()
                    return@LaunchedEffect
                }
                delay(50)
            }
        }
    }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(
            modifier = Modifier.width(520.dp).fillMaxHeight(0.84f).tvHairline(tvTone(TvTone.SurfaceTop), 22f),
            shape = RoundedCornerShape(22.dp),
            colors = androidx.tv.material3.SurfaceDefaults.colors(containerColor = tvTone(TvTone.SurfaceHigh)),
        ) {
            androidx.compose.runtime.CompositionLocalProvider(LocalTvDialogCompact provides true) {
            Column(
                modifier = Modifier.fillMaxSize().padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("Gestionar grupos", color = TvText, fontSize = 20.sp, fontFamily = TvType.Display)
                Text(
                    if (radioOnly) "Elige qué grupos de radio aparecen en el rail." else "Elige qué grupos aparecen en TV en directo.",
                    color = TvMuted,
                    fontSize = 11.sp,
                )
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("$visibleGroupCount / ${visibleGroups.size}", color = TvMuted, fontSize = 11.sp)
                    Spacer(Modifier.weight(1f))
                    TvTextButton(
                        onClick = { hidden = hidden - visibleGroups.toSet() },
                        modifier = Modifier
                            .focusRequester(showAllFocusRequester)
                            .focusProperties {
                                right = hideAllFocusRequester
                                down = searchButtonFocusRequester
                            }
                            .onPreviewKeyEvent { event ->
                                val keyCode = event.nativeKeyEvent.keyCode
                                when {
                                    event.type == KeyEventType.KeyDown && keyCode == KeyEvent.KEYCODE_DPAD_RIGHT -> {
                                        hideAllFocusRequester.requestFocus()
                                        true
                                    }
                                    isTvSelectKey(keyCode) -> {
                                        if (event.type == KeyEventType.KeyDown && isInitialTvSelect(keyCode, event.nativeKeyEvent.repeatCount)) {
                                            hidden = hidden - visibleGroups.toSet()
                                        }
                                        true
                                    }
                                    else -> false
                                }
                            }
                            .focusable()
                            .tvDpadFocus(),
                        enabled = visibleGroups.isNotEmpty(),
                    ) { Text("Mostrar todos") }
                    TvTextButton(
                        onClick = { hidden = hidden + visibleGroups.toSet() },
                        modifier = Modifier
                            .focusRequester(hideAllFocusRequester)
                            .focusProperties {
                                left = showAllFocusRequester
                                down = searchButtonFocusRequester
                            }
                            .onPreviewKeyEvent { event ->
                                val keyCode = event.nativeKeyEvent.keyCode
                                when {
                                    event.type == KeyEventType.KeyDown && keyCode == KeyEvent.KEYCODE_DPAD_LEFT -> {
                                        showAllFocusRequester.requestFocus()
                                        true
                                    }
                                    isTvSelectKey(keyCode) -> {
                                        if (event.type == KeyEventType.KeyDown && isInitialTvSelect(keyCode, event.nativeKeyEvent.repeatCount)) {
                                            hidden = hidden + visibleGroups.toSet()
                                        }
                                        true
                                    }
                                    else -> false
                                }
                            }
                            .focusable()
                            .tvDpadFocus(),
                        enabled = visibleGroups.isNotEmpty(),
                    ) { Text("Ocultar todos") }
                }
                if (searchActive) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TvOutlinedTextField(
                            value = searchQuery,
                            onValueChange = { searchQuery = it },
                            modifier = Modifier
                                .weight(1f)
                                .height(54.dp)
                                .focusRequester(searchFocusRequester)
                                .tvDpadFocus(),
                            singleLine = true,
                            label = { Text("Buscar grupo") },
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search, showKeyboardOnFocus = false),
                            keyboardActions = KeyboardActions(onSearch = { keyboardController?.hide() }),
                        )
                        TvTextButton(
                            onClick = {
                                keyboardController?.hide()
                                searchQuery = ""
                                searchActive = false
                            },
                            modifier = Modifier.tvDpadFocus(),
                        ) { Text("Cerrar búsqueda") }
                    }
                } else {
                    TvTextButton(
                        onClick = { searchActive = true },
                        modifier = Modifier
                            .focusRequester(searchButtonFocusRequester)
                            .focusProperties {
                                up = showAllFocusRequester
                                down = firstGroupFocusRequester
                            }
                            .tvDpadClick { searchActive = true },
                    ) { Text("Buscar grupos") }
                }
                if (playlists.size > 1) {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        itemsIndexed(playlists) { _, playlist ->
                            TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                                onClick = {
                                    selectedPlaylistId = playlist.id
                                    hidden = playlist.hiddenGroupTitles.toSet()
                                },
                                modifier = Modifier.width(160.dp).height(32.dp).tvDpadClick {
                                    selectedPlaylistId = playlist.id
                                    hidden = playlist.hiddenGroupTitles.toSet()
                                },
                                colors = androidx.tv.material3.CardDefaults.colors(
                                    containerColor = if (playlist.id == selectedPlaylist.id) tvColor(Color(0xFF304A75)) else tvColor(Color(0xFF202532)),
                                    focusedContainerColor = tvColor(Color(0xFF536A9F)),
                                ),
                            ) { Text(playlist.name, color = TvText, modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp), fontSize = 11.sp, maxLines = 1) }
                        }
                    }
                }
                if (visibleGroups.isEmpty()) {
                    Text("No hay grupos disponibles en esta playlist.", color = TvMuted, fontSize = 10.sp)
                } else if (filteredGroups.isEmpty()) {
                    Text("No se encontraron grupos.", color = TvMuted, fontSize = 10.sp)
                } else {
                    LazyColumn(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        items(filteredGroups, key = { it.lowercase(Locale.ROOT) }) { group ->
                            val isHidden = hidden.any { it.equals(group, ignoreCase = true) }
                            TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                                onClick = {
                                    hidden = if (isHidden) hidden.filterNot { it.equals(group, ignoreCase = true) }.toSet()
                                    else hidden + group
                                },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(36.dp)
                                    .then(
                                        if (group == filteredGroups.firstOrNull()) {
                                            Modifier
                                                .focusRequester(firstGroupFocusRequester)
                                                .focusProperties { up = searchButtonFocusRequester }
                                        } else Modifier
                                    )
                                    .tvDpadClick {
                                        hidden = if (isHidden) hidden.filterNot { it.equals(group, ignoreCase = true) }.toSet()
                                        else hidden + group
                                    },
                                colors = androidx.tv.material3.CardDefaults.colors(
                                    containerColor = if (isHidden) tvColor(Color(0xFF2A2028)) else tvColor(Color(0xFF202532)),
                                    focusedContainerColor = tvColor(Color(0xFF536A9F)),
                                ),
                            ) {
                                Row(modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Text(if (isHidden) "▢" else "✓", color = if (isHidden) tvColor(Color(0xFFFF9AAB)) else tvColor(Color(0xFF8FC0FF)), fontSize = 14.sp)
                                    Text(group, color = TvText, fontSize = 12.sp, modifier = Modifier.padding(start = 10.dp).weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Spacer(Modifier.weight(1f))
                                    Text(if (isHidden) "Oculto" else "Visible", color = TvMuted, fontSize = 10.sp)
                                }
                            }
                        }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    TvTextButton(onClick = onDismiss, modifier = Modifier.tvDpadClick(onDismiss)) { Text("Cancelar") }
                    Spacer(Modifier.weight(1f))
                    TvButton(
                        onClick = {
                            onSave(selectedPlaylist.id, hidden.toList())
                            onDismiss()
                        },
                        modifier = Modifier.tvDpadClick {
                            onSave(selectedPlaylist.id, hidden.toList())
                            onDismiss()
                        },
                    ) { Text("Guardar") }
                }
            }
            }
        }
    }
}

private enum class TvCatalogSort(val label: String) {
    DATE_DESC("Más recientes"),
    DATE_ASC("Más antiguas"),
    NAME("Nombre A-Z"),
    NAME_DESC("Nombre Z-A"),
    RATING_DESC("Valoración ↓"),
    RATING_ASC("Valoración ↑"),
}

private enum class TvLiveSort(val label: String) {
    SERVER("Servidor"),
    NAME_ASC("Nombre A-Z"),
    NAME_DESC("Nombre Z-A"),
}

@Composable
private fun TvLiveSortControls(
    selected: TvLiveSort,
    onSortSelected: (TvLiveSort) -> Unit,
) {
    TvSegmented(
        options = TvLiveSort.entries.map { it.label },
        selectedIndex = TvLiveSort.entries.indexOf(selected),
        onSelect = { onSortSelected(TvLiveSort.entries[it]) },
        segmentWidth = 78.dp,
    )
}

@Composable
private fun TvCatalogSortControls(
    selected: TvCatalogSort,
    onSortSelected: (TvCatalogSort) -> Unit,
    firstFocusRequester: FocusRequester? = null,
) {
    TvSegmented(
        options = TvCatalogSort.entries.map { it.label },
        selectedIndex = TvCatalogSort.entries.indexOf(selected),
        onSelect = { onSortSelected(TvCatalogSort.entries[it]) },
        label = "Ordenar",
        segmentWidth = 92.dp,
        firstFocusRequester = firstFocusRequester,
    )
}

private data class TvLiveCategoryOption(val id: String, val label: String)

@Composable
private fun TvManageLiveCategoriesDialog(
    playlists: List<StoredPlaylist>,
    categoriesByPlaylist: Map<String, List<Pair<String, String>>>,
    onSave: (String, List<TvHiddenCategory>) -> Unit,
    onDismiss: () -> Unit,
) {
    if (playlists.isEmpty()) return
    var selectedPlaylistId by remember(playlists) { mutableStateOf(playlists.first().id) }
    val selected = playlists.firstOrNull { it.id == selectedPlaylistId } ?: playlists.first()
    var hidden by remember(selected.id, selected.hiddenCategories) {
        mutableStateOf(selected.hiddenCategories.filter { it.type == "live" }.map { it.id }.toSet())
    }
    val available = (categoriesByPlaylist[selected.id].orEmpty().map { TvLiveCategoryOption(it.first, it.second) } +
        selected.hiddenCategories.filter { it.type == "live" }.map { TvLiveCategoryOption(it.id, it.id) })
        .distinctBy { it.id }.sortedBy { it.label.lowercase() }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(
            modifier = Modifier.width(520.dp).fillMaxHeight(0.84f).tvHairline(tvTone(TvTone.SurfaceTop), 22f),
            shape = RoundedCornerShape(22.dp),
            colors = androidx.tv.material3.SurfaceDefaults.colors(containerColor = tvTone(TvTone.SurfaceHigh)),
        ) {
            androidx.compose.runtime.CompositionLocalProvider(LocalTvDialogCompact provides true) {
            Column(modifier = Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Gestionar categorías", color = TvText, fontSize = 20.sp, fontFamily = TvType.Display)
                Text("Oculta categorías de TV en directo que no quieras mostrar.", color = TvMuted, fontSize = 11.sp)
                if (playlists.size > 1) {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        itemsIndexed(playlists) { _, playlist ->
                            TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                                onClick = {
                                    selectedPlaylistId = playlist.id
                                    hidden = playlist.hiddenCategories.filter { it.type == "live" }.map { it.id }.toSet()
                                },
                                modifier = Modifier.width(160.dp).height(32.dp).tvDpadClick {
                                    selectedPlaylistId = playlist.id
                                    hidden = playlist.hiddenCategories.filter { it.type == "live" }.map { it.id }.toSet()
                                },
                                colors = androidx.tv.material3.CardDefaults.colors(
                                    containerColor = if (playlist.id == selected.id) tvColor(Color(0xFF304A75)) else tvColor(Color(0xFF202532)),
                                    focusedContainerColor = tvColor(Color(0xFF536A9F)),
                                ),
                            ) { Text(playlist.name, color = TvText, modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp), fontSize = 11.sp, maxLines = 1) }
                        }
                    }
                }
                if (available.isEmpty()) {
                    Text("No hay categorías disponibles en esta playlist.", color = TvMuted)
                } else {
                    LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        items(available, key = { it.id }) { category ->
                            val isHidden = hidden.any { it.equals(category.id, ignoreCase = true) }
                            TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                                onClick = { hidden = if (isHidden) hidden - category.id else hidden + category.id },
                                modifier = Modifier.fillMaxWidth().height(36.dp).tvDpadClick {
                                    hidden = if (isHidden) hidden - category.id else hidden + category.id
                                },
                                colors = androidx.tv.material3.CardDefaults.colors(
                                    containerColor = if (isHidden) tvColor(Color(0xFF2A2028)) else tvColor(Color(0xFF202532)),
                                    focusedContainerColor = tvColor(Color(0xFF536A9F)),
                                ),
                            ) {
                                Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Text(if (isHidden) "Oculta" else "Visible", color = if (isHidden) tvColor(Color(0xFFFF9A9A)) else tvColor(Color(0xFF9ED0FF)), fontSize = 10.sp, modifier = Modifier.width(56.dp))
                                    Text(category.label, color = TvText, fontSize = 12.sp, maxLines = 1)
                                }
                            }
                        }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Spacer(Modifier.weight(1f))
                    TvButton(onClick = onDismiss, modifier = Modifier.tvDpadClick(onDismiss)) { Text("Cancelar") }
                    TvButton(onClick = { onSave(selected.id, hidden.map { TvHiddenCategory("live", it) }); onDismiss() }, modifier = Modifier.tvDpadClick { onSave(selected.id, hidden.map { TvHiddenCategory("live", it) }); onDismiss() }) { Text("Guardar") }
                }
            }
            }
        }
    }
}

@Composable
@OptIn(ExperimentalLayoutApi::class)
private fun VodContent(
    playlists: List<StoredPlaylist>,
    repository: TvPlaylistRepository,
    initialFocusRequester: FocusRequester? = null,
    onOpen: (String, TvVodItem) -> Unit,
) {
    var selectedCategory by remember { mutableStateOf("Todas") }
    var query by remember { mutableStateOf("") }
    var sort by remember { mutableStateOf(TvCatalogSort.NAME) }
    var itemLimit by remember { mutableStateOf(40) }
    var extraItems by remember { mutableStateOf<Map<String, List<TvVodItem>>>(emptyMap()) }
    var searchedItems by remember { mutableStateOf<Map<String, List<TvVodItem>>>(emptyMap()) }
    var searchOffsets by remember { mutableStateOf<Map<String, Int>>(emptyMap()) }
    var searchHasMore by remember { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
    var databaseCategoryMappings by remember { mutableStateOf<Map<String, List<TvCatalogCategoryMapping>>>(emptyMap()) }
    var categoryItems by remember { mutableStateOf<Map<String, List<TvVodItem>>>(emptyMap()) }
    var exhausted by remember { mutableStateOf<Set<String>>(emptySet()) }
    var loadingMore by remember { mutableStateOf(false) }
    var manageCategoriesVisible by remember { mutableStateOf(false) }
    var hiddenCategoryOverrides by remember(playlists) {
        mutableStateOf(playlists.associate { it.id to it.hiddenCategories })
    }
    val categoryFocusRequester = remember { FocusRequester() }
    val firstSortFocusRequester = remember { FocusRequester() }
    val imeVisible = WindowInsets.isImeVisible
    val scope = rememberCoroutineScope()
    fun isHidden(playlistId: String, item: TvVodItem): Boolean =
        hiddenCategoryOverrides[playlistId].orEmpty().any {
            it.type == "movies" && (it.id.equals(item.providerCategoryId, ignoreCase = true) || it.id.equals(item.categoryId, ignoreCase = true))
        }
    fun isHidden(playlistId: String, categoryId: String?): Boolean =
        !categoryId.isNullOrBlank() && hiddenCategoryOverrides[playlistId].orEmpty().any { it.type == "movies" && it.id.equals(categoryId, ignoreCase = true) }
    fun isHidden(playlistId: String, categoryId: String?, providerCategoryId: String?): Boolean =
        hiddenCategoryOverrides[playlistId].orEmpty().any {
            it.type == "movies" && (it.id.equals(categoryId, ignoreCase = true) || it.id.equals(providerCategoryId, ignoreCase = true))
        }
    LaunchedEffect(playlists.map { it.id }) {
        databaseCategoryMappings = withContext(Dispatchers.IO) {
            playlists.associate { it.id to repository.loadVodCategoryMappings(it.id) }
        }
    }
    val databaseCategories = databaseCategoryMappings.values.flatten().map { it.label }
        .distinct().sortedWith(String.CASE_INSENSITIVE_ORDER)
    LaunchedEffect(selectedCategory, playlists.map { it.id }) {
        exhausted = emptySet()
        categoryItems = if (selectedCategory == "Todas") emptyMap() else withContext(Dispatchers.IO) {
            playlists.associate { playlist ->
                playlist.id to repository.loadVodCategoryPage(playlist.id, selectedCategory, 0)
            }
        }
        itemLimit = 40
    }
    LaunchedEffect(query, selectedCategory, playlists.map { it.id }) {
        val normalized = query.trim()
        searchedItems = emptyMap()
        searchOffsets = emptyMap()
        searchHasMore = emptyMap()
        if (normalized.isNotBlank()) {
            delay(150)
            val pages = withContext(Dispatchers.IO) {
                playlists.associate { playlist ->
                    playlist.id to repository.searchVod(
                        playlist.id,
                        normalized,
                        limit = 201,
                        categoryId = selectedCategory.takeUnless { it == "Todas" },
                    )
                }
            }
            searchedItems = pages.mapValues { it.value.take(200) }
            searchOffsets = pages.mapValues { it.value.size.coerceAtMost(200) }
            searchHasMore = pages.mapValues { it.value.size > 200 }
        }
    }
    val allItems = remember(playlists, searchedItems, extraItems, categoryItems, selectedCategory, query) {
        if (query.isNotBlank()) {
            playlists.flatMap { playlist -> searchedItems[playlist.id].orEmpty().map { playlist.id to it } }
        } else if (selectedCategory == "Todas") {
            playlists.flatMap { playlist ->
                (playlist.vod + extraItems[playlist.id].orEmpty()).map { playlist.id to it }
            }
        } else {
            playlists.flatMap { playlist -> categoryItems[playlist.id].orEmpty().map { playlist.id to it } }
        }
    }
    val visibleCategories = databaseCategories.filter { category ->
        databaseCategoryMappings.any { (playlistId, mappings) ->
            mappings.filter { it.label.equals(category, ignoreCase = true) }
                .any { !isHidden(playlistId, it.label, it.providerId) }
        }
    }
    val categories = listOf("Todas") + visibleCategories
    val filtered = remember(allItems, hiddenCategoryOverrides, selectedCategory, query) {
        allItems.filter { (playlistId, item) ->
            !isHidden(playlistId, item) &&
                (selectedCategory == "Todas" || item.categoryId.equals(selectedCategory, ignoreCase = true)) &&
                (query.isBlank() || item.name.contains(query.trim(), ignoreCase = true))
        }
    }
    val visible = remember(filtered, sort) {
        when (sort) {
            TvCatalogSort.DATE_DESC -> filtered.sortedWith(
                compareByDescending<Pair<String, TvVodItem>> { it.second.addedAtMs ?: 0L }
                    .thenBy(String.CASE_INSENSITIVE_ORDER) { it.second.name },
            )
            TvCatalogSort.DATE_ASC -> filtered.sortedWith(
                compareBy<Pair<String, TvVodItem>> { it.second.addedAtMs ?: Long.MAX_VALUE }
                    .thenBy(String.CASE_INSENSITIVE_ORDER) { it.second.name },
            )
            TvCatalogSort.NAME -> filtered.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.second.name })
            TvCatalogSort.NAME_DESC -> filtered.sortedWith(compareByDescending(String.CASE_INSENSITIVE_ORDER) { it.second.name })
            TvCatalogSort.RATING_DESC -> filtered.sortedWith(
                compareByDescending<Pair<String, TvVodItem>> { it.second.rating ?: -1.0 }
                    .thenBy(String.CASE_INSENSITIVE_ORDER) { it.second.name },
            )
            TvCatalogSort.RATING_ASC -> filtered.sortedWith(
                compareBy<Pair<String, TvVodItem>> { it.second.rating ?: Double.MAX_VALUE }
                    .thenBy(String.CASE_INSENSITIVE_ORDER) { it.second.name },
            )
        }
    }
    val page = visible.take(itemLimit)
    val hasCatalogItems = page.isNotEmpty()
    fun catalogKey(playlistId: String) = if (selectedCategory == "Todas") playlistId else "$playlistId:$selectedCategory"
    fun loadedCount(playlist: StoredPlaylist): Int = if (selectedCategory == "Todas") {
        playlist.vod.size + extraItems[playlist.id].orEmpty().size
    } else {
        categoryItems[playlist.id].orEmpty().size
    }
    suspend fun loadMore(playlist: StoredPlaylist) {
        val offset = loadedCount(playlist)
        val next = withContext(Dispatchers.IO) {
            if (selectedCategory == "Todas") repository.loadVodPage(playlist.id, offset)
            else repository.loadVodCategoryPage(playlist.id, selectedCategory, offset)
        }
        val key = catalogKey(playlist.id)
        if (next.isEmpty()) exhausted = exhausted + key
        else if (selectedCategory == "Todas") extraItems = extraItems + (playlist.id to (extraItems[playlist.id].orEmpty() + next))
        else categoryItems = categoryItems + (playlist.id to (categoryItems[playlist.id].orEmpty() + next))
    }
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
        TvScreenTitle("Películas", eyebrow = "Catálogo")
        Spacer(Modifier.weight(1f))
        TvOutlinedTextField(
            value = query,
            onValueChange = { query = it },
            label = { Text("Buscar película") },
            leadingIcon = { SidebarGlyph(TvSection.Search, TvMuted) },
            singleLine = true,
            shape = RoundedCornerShape(50),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search, showKeyboardOnFocus = false),
            modifier = Modifier
                .width(340.dp)
                .then(initialFocusRequester?.takeUnless { hasCatalogItems }?.let { Modifier.focusRequester(it) } ?: Modifier)
                .onPreviewKeyEvent { event ->
                    if (!imeVisible && event.type == KeyEventType.KeyDown &&
                        event.nativeKeyEvent.keyCode == KeyEvent.KEYCODE_DPAD_DOWN
                    ) {
                        firstSortFocusRequester.requestFocus()
                        true
                    } else false
                },
        )
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            TvCatalogSortControls(sort, onSortSelected = { sort = it }, firstFocusRequester = firstSortFocusRequester)
            Spacer(Modifier.weight(1f))
            TvButton(
                onClick = { manageCategoriesVisible = true },
                modifier = Modifier.tvDpadClick { manageCategoriesVisible = true },
            ) { Text("Gestionar categorías", maxLines = 1, fontSize = 11.sp) }
        }
        if (categories.size > 1) {
            TvRail(
                categories,
                compact = true,
                selectedIndex = categories.indexOf(selectedCategory),
                initialFocusRequester = categoryFocusRequester,
                onItemClick = { index -> categories.getOrNull(index)?.let { selectedCategory = it } },
                onItemDown = { index ->
                    if (index == 0 && hasCatalogItems) {
                        initialFocusRequester?.requestFocus()
                        true
                    } else false
                },
            )
        }
        if (visible.isEmpty()) {
            TvEmptyState("No hay películas", "Esta fuente no tiene películas en la categoría o búsqueda actual.", TvSection.Vod)
        } else {
            TvPosterRail(
                items = page.map { (_, item) ->
                    TvPosterItem(item.name, item.coverUrl, item.categoryId)
                },
                initialFocusRequester = initialFocusRequester?.takeIf { hasCatalogItems },
                upFocusRequester = categoryFocusRequester.takeIf { categories.size > 1 },
                onItemClick = { index -> page.getOrNull(index)?.let { onOpen(it.first, it.second) } },
            )
            val canLoadMore = if (query.isNotBlank()) searchHasMore.values.any { it } else playlists.any { playlist ->
                loadedCount(playlist) >= 500 && catalogKey(playlist.id) !in exhausted
            }
            if (canLoadMore) {
                TvButton(
                    onClick = {
                        if (!loadingMore) {
                            loadingMore = true
                            scope.launch {
                                try {
                                    val targetLimit = itemLimit + 40
                                    if (filtered.size < targetLimit) {
                                        if (query.isNotBlank()) {
                                            val pending = playlists.filter { searchHasMore[it.id] == true }
                                            val pages = withContext(Dispatchers.IO) {
                                                pending.associate { playlist ->
                                                    val offset = searchOffsets[playlist.id] ?: 0
                                                    playlist.id to (offset to repository.searchVod(
                                                        playlist.id,
                                                        query.trim(),
                                                        201,
                                                        offset,
                                                        selectedCategory.takeUnless { it == "Todas" },
                                                    ))
                                                }
                                            }
                                            pages.forEach { (playlistId, result) ->
                                                val (offset, rows) = result
                                                val added = rows.take(200)
                                                searchedItems = searchedItems + (playlistId to (searchedItems[playlistId].orEmpty() + added))
                                                searchOffsets = searchOffsets + (playlistId to (offset + added.size))
                                                searchHasMore = searchHasMore + (playlistId to (rows.size > 200))
                                            }
                                        } else {
                                            playlists.filter { loadedCount(it) >= 500 && catalogKey(it.id) !in exhausted }
                                                .forEach { loadMore(it) }
                                        }
                                    }
                                    itemLimit = targetLimit
                                } finally {
                                    loadingMore = false
                                }
                            }
                        }
                    },
                    enabled = !loadingMore,
                    modifier = Modifier.tvDpadFocus(),
                ) { Text("Cargar más películas") }
            }
        }
    }
    if (manageCategoriesVisible) {
        TvManageCategoriesDialog(
            playlists = playlists,
            categories = databaseCategories,
            categoryType = "movies",
            onSave = { playlistId, hidden ->
                scope.launch {
                    val preserved = hiddenCategoryOverrides[playlistId].orEmpty().filter { it.type != "movies" }
                    val all = preserved + hidden
                    withContext(Dispatchers.IO) { repository.saveHiddenCategories(playlistId, all) }
                    hiddenCategoryOverrides = hiddenCategoryOverrides + (playlistId to all)
                }
            },
            onDismiss = { manageCategoriesVisible = false },
        )
    }
}

@Composable
@OptIn(ExperimentalLayoutApi::class)
private fun SeriesContent(
    playlists: List<StoredPlaylist>,
    repository: TvPlaylistRepository,
    initialFocusRequester: FocusRequester? = null,
    onOpen: (String, TvSeriesItem) -> Unit,
) {
    var selectedCategory by remember { mutableStateOf("Todas") }
    var query by remember { mutableStateOf("") }
    var sort by remember { mutableStateOf(TvCatalogSort.NAME) }
    var itemLimit by remember { mutableStateOf(40) }
    var extraItems by remember { mutableStateOf<Map<String, List<TvSeriesItem>>>(emptyMap()) }
    var searchedItems by remember { mutableStateOf<Map<String, List<TvSeriesItem>>>(emptyMap()) }
    var searchOffsets by remember { mutableStateOf<Map<String, Int>>(emptyMap()) }
    var searchHasMore by remember { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
    var databaseCategoryMappings by remember { mutableStateOf<Map<String, List<TvCatalogCategoryMapping>>>(emptyMap()) }
    var categoryItems by remember { mutableStateOf<Map<String, List<TvSeriesItem>>>(emptyMap()) }
    var exhausted by remember { mutableStateOf<Set<String>>(emptySet()) }
    var loadingMore by remember { mutableStateOf(false) }
    var manageCategoriesVisible by remember { mutableStateOf(false) }
    var hiddenCategoryOverrides by remember(playlists) {
        mutableStateOf(playlists.associate { it.id to it.hiddenCategories })
    }
    val categoryFocusRequester = remember { FocusRequester() }
    val firstSortFocusRequester = remember { FocusRequester() }
    val imeVisible = WindowInsets.isImeVisible
    val scope = rememberCoroutineScope()
    fun isHidden(playlistId: String, item: TvSeriesItem): Boolean =
        hiddenCategoryOverrides[playlistId].orEmpty().any {
            it.type == "series" && (it.id.equals(item.providerCategoryId, ignoreCase = true) || it.id.equals(item.categoryId, ignoreCase = true))
        }
    fun isHidden(playlistId: String, categoryId: String?): Boolean =
        !categoryId.isNullOrBlank() && hiddenCategoryOverrides[playlistId].orEmpty().any { it.type == "series" && it.id.equals(categoryId, ignoreCase = true) }
    fun isHidden(playlistId: String, categoryId: String?, providerCategoryId: String?): Boolean =
        hiddenCategoryOverrides[playlistId].orEmpty().any {
            it.type == "series" && (it.id.equals(categoryId, ignoreCase = true) || it.id.equals(providerCategoryId, ignoreCase = true))
        }
    LaunchedEffect(playlists.map { it.id }) {
        databaseCategoryMappings = withContext(Dispatchers.IO) {
            playlists.associate { it.id to repository.loadSeriesCategoryMappings(it.id) }
        }
    }
    val databaseCategories = databaseCategoryMappings.values.flatten().map { it.label }
        .distinct().sortedWith(String.CASE_INSENSITIVE_ORDER)
    LaunchedEffect(selectedCategory, playlists.map { it.id }) {
        exhausted = emptySet()
        categoryItems = if (selectedCategory == "Todas") emptyMap() else withContext(Dispatchers.IO) {
            playlists.associate { playlist ->
                playlist.id to repository.loadSeriesCategoryPage(playlist.id, selectedCategory, 0)
            }
        }
        itemLimit = 40
    }
    LaunchedEffect(query, selectedCategory, playlists.map { it.id }) {
        val normalized = query.trim()
        searchedItems = emptyMap()
        searchOffsets = emptyMap()
        searchHasMore = emptyMap()
        if (normalized.isNotBlank()) {
            delay(150)
            val pages = withContext(Dispatchers.IO) {
                playlists.associate { playlist ->
                    playlist.id to repository.searchSeries(
                        playlist.id,
                        normalized,
                        limit = 201,
                        categoryId = selectedCategory.takeUnless { it == "Todas" },
                    )
                }
            }
            searchedItems = pages.mapValues { it.value.take(200) }
            searchOffsets = pages.mapValues { it.value.size.coerceAtMost(200) }
            searchHasMore = pages.mapValues { it.value.size > 200 }
        }
    }
    val allItems = remember(playlists, searchedItems, extraItems, categoryItems, selectedCategory, query) {
        if (query.isNotBlank()) {
            playlists.flatMap { playlist -> searchedItems[playlist.id].orEmpty().map { playlist.id to it } }
        } else if (selectedCategory == "Todas") {
            playlists.flatMap { playlist ->
                (playlist.series + extraItems[playlist.id].orEmpty()).map { playlist.id to it }
            }
        } else {
            playlists.flatMap { playlist -> categoryItems[playlist.id].orEmpty().map { playlist.id to it } }
        }
    }
    val visibleCategories = databaseCategories.filter { category ->
        databaseCategoryMappings.any { (playlistId, mappings) ->
            mappings.filter { it.label.equals(category, ignoreCase = true) }
                .any { !isHidden(playlistId, it.label, it.providerId) }
        }
    }
    val categories = listOf("Todas") + visibleCategories
    val filtered = remember(allItems, hiddenCategoryOverrides, selectedCategory, query) {
        allItems.filter { (playlistId, item) ->
            !isHidden(playlistId, item) &&
                (selectedCategory == "Todas" || item.categoryId.equals(selectedCategory, ignoreCase = true)) &&
                (query.isBlank() || item.name.contains(query.trim(), ignoreCase = true))
        }
    }
    val visible = remember(filtered, sort) {
        when (sort) {
            TvCatalogSort.DATE_DESC -> filtered.sortedWith(
                compareByDescending<Pair<String, TvSeriesItem>> { it.second.addedAtMs ?: 0L }
                    .thenBy(String.CASE_INSENSITIVE_ORDER) { it.second.name },
            )
            TvCatalogSort.DATE_ASC -> filtered.sortedWith(
                compareBy<Pair<String, TvSeriesItem>> { it.second.addedAtMs ?: Long.MAX_VALUE }
                    .thenBy(String.CASE_INSENSITIVE_ORDER) { it.second.name },
            )
            TvCatalogSort.NAME -> filtered.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.second.name })
            TvCatalogSort.NAME_DESC -> filtered.sortedWith(compareByDescending(String.CASE_INSENSITIVE_ORDER) { it.second.name })
            TvCatalogSort.RATING_DESC -> filtered.sortedWith(
                compareByDescending<Pair<String, TvSeriesItem>> { it.second.rating ?: -1.0 }
                    .thenBy(String.CASE_INSENSITIVE_ORDER) { it.second.name },
            )
            TvCatalogSort.RATING_ASC -> filtered.sortedWith(
                compareBy<Pair<String, TvSeriesItem>> { it.second.rating ?: Double.MAX_VALUE }
                    .thenBy(String.CASE_INSENSITIVE_ORDER) { it.second.name },
            )
        }
    }
    val page = visible.take(itemLimit)
    val hasCatalogItems = page.isNotEmpty()
    fun catalogKey(playlistId: String) = if (selectedCategory == "Todas") playlistId else "$playlistId:$selectedCategory"
    fun loadedCount(playlist: StoredPlaylist): Int = if (selectedCategory == "Todas") {
        playlist.series.size + extraItems[playlist.id].orEmpty().size
    } else {
        categoryItems[playlist.id].orEmpty().size
    }
    suspend fun loadMore(playlist: StoredPlaylist) {
        val offset = loadedCount(playlist)
        val next = withContext(Dispatchers.IO) {
            if (selectedCategory == "Todas") repository.loadSeriesPage(playlist.id, offset)
            else repository.loadSeriesCategoryPage(playlist.id, selectedCategory, offset)
        }
        val key = catalogKey(playlist.id)
        if (next.isEmpty()) exhausted = exhausted + key
        else if (selectedCategory == "Todas") extraItems = extraItems + (playlist.id to (extraItems[playlist.id].orEmpty() + next))
        else categoryItems = categoryItems + (playlist.id to (categoryItems[playlist.id].orEmpty() + next))
    }
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
        TvScreenTitle("Series", eyebrow = "Catálogo")
        Spacer(Modifier.weight(1f))
        TvOutlinedTextField(
            value = query,
            onValueChange = { query = it },
            label = { Text("Buscar serie") },
            leadingIcon = { SidebarGlyph(TvSection.Search, TvMuted) },
            singleLine = true,
            shape = RoundedCornerShape(50),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search, showKeyboardOnFocus = false),
            modifier = Modifier
                .width(340.dp)
                .then(initialFocusRequester?.takeUnless { hasCatalogItems }?.let { Modifier.focusRequester(it) } ?: Modifier)
                .onPreviewKeyEvent { event ->
                    if (!imeVisible && event.type == KeyEventType.KeyDown &&
                        event.nativeKeyEvent.keyCode == KeyEvent.KEYCODE_DPAD_DOWN
                    ) {
                        firstSortFocusRequester.requestFocus()
                        true
                    } else false
                },
        )
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            TvCatalogSortControls(sort, onSortSelected = { sort = it }, firstFocusRequester = firstSortFocusRequester)
            Spacer(Modifier.weight(1f))
            TvButton(
                onClick = { manageCategoriesVisible = true },
                modifier = Modifier.tvDpadClick { manageCategoriesVisible = true },
            ) { Text("Gestionar categorías", maxLines = 1, fontSize = 11.sp) }
        }
        if (categories.size > 1) {
            TvRail(
                categories,
                compact = true,
                selectedIndex = categories.indexOf(selectedCategory),
                initialFocusRequester = categoryFocusRequester,
                onItemClick = { index -> categories.getOrNull(index)?.let { selectedCategory = it } },
                onItemDown = { index ->
                    if (index == 0 && hasCatalogItems) {
                        initialFocusRequester?.requestFocus()
                        true
                    } else false
                },
            )
        }
        if (visible.isEmpty()) {
            TvEmptyState("No hay series", "Esta fuente no tiene series en la categoría o búsqueda actual.", TvSection.Series)
        } else {
            TvPosterRail(
                items = page.map { (_, item) ->
                    TvPosterItem(item.name, item.coverUrl, item.categoryId)
                },
                initialFocusRequester = initialFocusRequester?.takeIf { hasCatalogItems },
                upFocusRequester = categoryFocusRequester.takeIf { categories.size > 1 },
                onItemClick = { index -> page.getOrNull(index)?.let { onOpen(it.first, it.second) } },
            )
            val canLoadMore = if (query.isNotBlank()) searchHasMore.values.any { it } else playlists.any { playlist ->
                loadedCount(playlist) >= 500 && catalogKey(playlist.id) !in exhausted
            }
            if (canLoadMore) {
                TvButton(
                    onClick = {
                        if (!loadingMore) {
                            loadingMore = true
                            scope.launch {
                                try {
                                    val targetLimit = itemLimit + 40
                                    if (filtered.size < targetLimit) {
                                        if (query.isNotBlank()) {
                                            val pending = playlists.filter { searchHasMore[it.id] == true }
                                            val pages = withContext(Dispatchers.IO) {
                                                pending.associate { playlist ->
                                                    val offset = searchOffsets[playlist.id] ?: 0
                                                    playlist.id to (offset to repository.searchSeries(
                                                        playlist.id,
                                                        query.trim(),
                                                        201,
                                                        offset,
                                                        selectedCategory.takeUnless { it == "Todas" },
                                                    ))
                                                }
                                            }
                                            pages.forEach { (playlistId, result) ->
                                                val (offset, rows) = result
                                                val added = rows.take(200)
                                                searchedItems = searchedItems + (playlistId to (searchedItems[playlistId].orEmpty() + added))
                                                searchOffsets = searchOffsets + (playlistId to (offset + added.size))
                                                searchHasMore = searchHasMore + (playlistId to (rows.size > 200))
                                            }
                                        } else {
                                            playlists.filter { loadedCount(it) >= 500 && catalogKey(it.id) !in exhausted }
                                                .forEach { loadMore(it) }
                                        }
                                    }
                                    itemLimit = targetLimit
                                } finally {
                                    loadingMore = false
                                }
                            }
                        }
                    },
                    enabled = !loadingMore,
                    modifier = Modifier.tvDpadFocus(),
                ) { Text("Cargar más series") }
            }
        }
    }
    if (manageCategoriesVisible) {
        TvManageCategoriesDialog(
            playlists = playlists,
            categories = databaseCategories,
            categoryType = "series",
            onSave = { playlistId, hidden ->
                scope.launch {
                    val preserved = hiddenCategoryOverrides[playlistId].orEmpty().filter { it.type != "series" }
                    val all = preserved + hidden
                    withContext(Dispatchers.IO) { repository.saveHiddenCategories(playlistId, all) }
                    hiddenCategoryOverrides = hiddenCategoryOverrides + (playlistId to all)
                }
            },
            onDismiss = { manageCategoriesVisible = false },
        )
    }
}

@Composable
private fun RecentlyAddedContent(
    playlists: List<StoredPlaylist>,
    repository: TvPlaylistRepository,
    initialFocusRequester: FocusRequester? = null,
    onOpenVod: (String, TvVodItem) -> Unit,
    onOpenSeries: (String, TvSeriesItem) -> Unit,
) {
    var recentVod by remember { mutableStateOf<Map<String, List<TvVodItem>>>(emptyMap()) }
    var recentSeries by remember { mutableStateOf<Map<String, List<TvSeriesItem>>>(emptyMap()) }
    LaunchedEffect(playlists.map { it.id }) {
        val ids = playlists.map { it.id }
        recentVod = withContext(Dispatchers.IO) {
            ids.associateWith { repository.loadRecentVodPage(it) }
        }
        recentSeries = withContext(Dispatchers.IO) {
            ids.associateWith { repository.loadRecentSeriesPage(it) }
        }
    }
    val vod = playlists.flatMap { playlist ->
        recentVod[playlist.id].orEmpty().map { playlist.id to it }
    }.sortedByDescending { it.second.addedAtMs }
    val series = playlists.flatMap { playlist ->
        recentSeries[playlist.id].orEmpty().map { playlist.id to it }
    }.sortedByDescending { it.second.addedAtMs }
    LaunchedEffect(vod.isNotEmpty(), series.isNotEmpty()) {
        if (vod.isNotEmpty() || series.isNotEmpty()) {
            delay(100)
            runCatching { initialFocusRequester?.requestFocus() }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
        TvScreenTitle("Novedades")
        Text(
            "Ordenadas por la fecha proporcionada por el portal",
            color = TvMuted,
            fontSize = 13.sp,
        )
        if (vod.isEmpty() && series.isEmpty()) {
            Text(
                "Tus fuentes no han proporcionado fechas de alta para el catálogo.",
                color = TvMuted,
                fontSize = 18.sp,
            )
        } else {
            if (vod.isNotEmpty()) {
                TvRailTitle("Películas nuevas", modifier = Modifier.padding(top = 6.dp))
                TvPosterRail(
                    items = vod.take(40).map { TvPosterItem(it.second.name, it.second.coverUrl, it.second.categoryId) },
                    initialFocusRequester = initialFocusRequester,
                    onItemClick = { index -> vod.getOrNull(index)?.let { onOpenVod(it.first, it.second) } },
                )
            }
            if (series.isNotEmpty()) {
                TvRailTitle("Series nuevas", modifier = Modifier.padding(top = 6.dp))
                TvPosterRail(
                    items = series.take(40).map { TvPosterItem(it.second.name, it.second.coverUrl, it.second.categoryId) },
                    initialFocusRequester = initialFocusRequester?.takeIf { vod.isEmpty() },
                    onItemClick = { index -> series.getOrNull(index)?.let { onOpenSeries(it.first, it.second) } },
                )
            }
        }
    }
}

@Composable
internal fun EpgGuideContent(
    playlists: List<StoredPlaylist>,
    repository: TvPlaylistRepository,
    initialFocusRequester: FocusRequester? = null,
    stripCountryPrefixes: Boolean = false,
    epgByChannel: Map<String, List<TvEpgEntry>>,
    xtreamEpgPreviews: Map<String, TvXtreamEpgPreview>,
    preferUploadedEpgOverXtream: Boolean,
    favorites: List<TvSavedItem>,
    history: List<TvSavedItem>,
    viewMode: String,
    epgOffsetMinutes: Int,
    statusMessage: String?,
    refreshing: Boolean,
    onRefresh: () -> Unit,
    onXtreamEpgPreviewLoaded: (String, TvXtreamEpgPreview) -> Unit = { _, _ -> },
    onPlay: (String, TvChannel, TvEpgEntry) -> Unit,
    onDownloadCatchup: (String, TvChannel, TvEpgEntry) -> Unit,
    onCopyCatchup: (String, TvChannel, TvEpgEntry) -> Unit,
) {
    val offsetMs = epgOffsetMinutes * 60_000L
    val actualNow = epgProviderNowMs(System.currentTimeMillis(), epgOffsetMinutes)
    val dayLengthMs = 24L * 60L * 60L * 1_000L
    var guideDayOffset by remember { mutableStateOf(0) }
    var guideDayLoading by remember { mutableStateOf(false) }
    var guideDayEpg by remember(epgByChannel) { mutableStateOf(epgByChannel) }
    val now = actualNow + guideDayOffset.toLong() * dayLengthMs
    val displayTime = { rawMs: Long -> rawMs + offsetMs }
    var channelLimit by remember { mutableStateOf(20) }
    var extraChannels by remember(playlists.map { it.id }) { mutableStateOf<Map<String, List<TvChannel>>>(emptyMap()) }
    var extraEpg by remember(playlists.map { it.id }) { mutableStateOf<Map<String, List<TvEpgEntry>>>(emptyMap()) }
    var exhaustedPlaylists by remember(playlists.map { it.id }) { mutableStateOf<Set<String>>(emptySet()) }
    var loadingMore by remember { mutableStateOf(false) }
    var guideFilter by remember { mutableStateOf("Todos") }
    val scope = rememberCoroutineScope()
    LaunchedEffect(guideDayOffset, playlists.map { it.id }, epgByChannel) {
        if (guideDayOffset == 0) {
            guideDayEpg = epgByChannel
        } else {
            guideDayLoading = true
            guideDayEpg = withContext(Dispatchers.IO) {
                repository.loadEpgSnapshot(
                    playlists,
                    windowMs = 36L * 60L * 60L * 1_000L,
                    centerMs = now,
                )
            }
            guideDayLoading = false
        }
    }
    val guideChannels = playlists.flatMap { playlist ->
        (playlist.channels + extraChannels[playlist.id].orEmpty()).distinctBy { it.id }.mapNotNull { channel ->
            val key = "${playlist.id}:${channel.id}"
            val uploadedProgrammes = (extraEpg[key] ?: guideDayEpg[key]).orEmpty()
            val cachedPreview = xtreamEpgPreviews[key]
            val providerProgrammes = cachedPreview
                ?.takeIf {
                    guideDayOffset == 0 && isFreshXtreamEpgPreview(it, epgOffsetMinutes)
                }
                ?.entries.orEmpty()
            val programmes = when {
                preferUploadedEpgOverXtream && uploadedProgrammes.isNotEmpty() -> uploadedProgrammes
                providerProgrammes.isNotEmpty() -> providerProgrammes
                else -> uploadedProgrammes
            }
            if (programmes.isEmpty()) null else Triple(playlist.id, channel, programmes)
        }
    }
    val favoriteKeys = remember(favorites) {
        favorites.filter { it.itemType == TvSavedItemType.CHANNEL }
            .map { "${it.playlistId}:${it.itemKey}" }.toSet()
    }
    val recentOrder = remember(history) {
        history.filter { it.itemType == TvSavedItemType.CHANNEL }
            .map { "${it.playlistId}:${it.itemKey}" }
            .withIndex().associate { it.value to it.index }
    }
    val guideXtreamTargets = remember(playlists, extraChannels, channelLimit, guideFilter, favoriteKeys, recentOrder) {
        val byPlaylist = playlists.map { playlist ->
            (playlist.channels + extraChannels[playlist.id].orEmpty())
                .distinctBy { it.id }
                .filter { channel ->
                    if (channel.radio || !channel.id.startsWith("xtream:")) return@filter false
                    when (guideFilter) {
                        "Favoritos" -> "${playlist.id}:${channel.id}" in favoriteKeys
                        "Recientes" -> "${playlist.id}:${channel.id}" in recentOrder
                        else -> guideFilter == "Todos" || channel.group.equals(guideFilter, ignoreCase = true)
                    }
                }
                .let { channels ->
                    if (guideFilter == "Recientes") {
                        channels.sortedBy { recentOrder["${playlist.id}:${it.id}"] ?: Int.MAX_VALUE }
                    } else channels
                }
                .map { channel -> playlist.id to channel }
        }
        buildList {
            var index = 0
            while (size < channelLimit && byPlaylist.any { index < it.size }) {
                byPlaylist.forEach { playlistChannels ->
                    playlistChannels.getOrNull(index)?.let(::add)
                }
                index++
            }
        }
    }
    val latestGuidePreviews by rememberUpdatedState(xtreamEpgPreviews)
    val latestGuideDayEpg by rememberUpdatedState(guideDayEpg)
    val latestExtraGuideEpg by rememberUpdatedState(extraEpg)
    val latestGuidePreviewLoaded by rememberUpdatedState(onXtreamEpgPreviewLoaded)
    val guidePreviewSemaphore = remember { Semaphore(2) }
    val guidePreviewInFlight = remember { mutableSetOf<String>() }
    LaunchedEffect(guideXtreamTargets, guideDayOffset, epgOffsetMinutes, preferUploadedEpgOverXtream) {
        if (guideDayOffset != 0) return@LaunchedEffect
        val providerNow = epgProviderNowMs(System.currentTimeMillis(), epgOffsetMinutes)
        guideXtreamTargets.forEachIndexed { index, (playlistId, channel) ->
            launch {
                val key = "$playlistId:${channel.id}"
                val uploaded = latestGuideDayEpg[key].orEmpty() + latestExtraGuideEpg[key].orEmpty()
                val uploadedHasCurrent = uploaded.any { it.startMs <= providerNow && it.endMs > providerNow }
                if (preferUploadedEpgOverXtream && uploadedHasCurrent) return@launch
                if (isFreshXtreamEpgPreview(latestGuidePreviews[key], epgOffsetMinutes)) return@launch

                while (!guidePreviewInFlight.add(key)) delay(50)
                try {
                    // The previous request may have filled the cache while this
                    // coroutine waited for the in-flight owner to finish.
                    if (isFreshXtreamEpgPreview(latestGuidePreviews[key], epgOffsetMinutes)) return@launch
                    val preview = try {
                        val entries = guidePreviewSemaphore.withPermit {
                            withContext(Dispatchers.IO) {
                                repository.loadXtreamShortEpg(playlistId, channel.id, limit = 10)
                            }
                        }
                        TvXtreamEpgPreview(entries, System.currentTimeMillis(), epgOffsetMinutes)
                    } catch (cancelled: kotlinx.coroutines.CancellationException) {
                        throw cancelled
                    } catch (_: Throwable) {
                        TvXtreamEpgPreview(emptyList(), System.currentTimeMillis(), epgOffsetMinutes, failed = true)
                    }
                    latestGuidePreviewLoaded(key, preview)
                } finally {
                    guidePreviewInFlight.remove(key)
                }
            }
            if (index < guideXtreamTargets.lastIndex) delay(200)
        }
    }
    val guideFilters = remember(guideChannels) {
        listOf("Todos", "Favoritos", "Recientes") + guideChannels.mapNotNull { it.second.group }
            .filter { it.isNotBlank() }.distinct().sortedWith(String.CASE_INSENSITIVE_ORDER)
    }
    val visibleGuideChannels = guideChannels.filter { (playlistId, channel, _) ->
        when (guideFilter) {
            "Favoritos" -> "$playlistId:${channel.id}" in favoriteKeys
            "Recientes" -> "$playlistId:${channel.id}" in recentOrder
            else -> guideFilter == "Todos" || channel.group.equals(guideFilter, ignoreCase = true)
        }
    }.let { channels ->
        if (guideFilter == "Recientes") channels.sortedBy { (playlistId, channel) -> recentOrder["$playlistId:${channel.id}"] ?: Int.MAX_VALUE }
        else channels
    }
    var programSearchQuery by remember(playlists.map { it.id }) { mutableStateOf("") }
    var debouncedProgramSearchQuery by remember(playlists.map { it.id }) { mutableStateOf("") }
    val programSearchKeyboard = LocalSoftwareKeyboardController.current
    val firstProgramSearchResultFocusRequester = remember { FocusRequester() }
    var programSearchFieldHasFocus by remember { mutableStateOf(false) }
    LaunchedEffect(programSearchQuery) {
        delay(300)
        debouncedProgramSearchQuery = programSearchQuery.trim()
    }
    val guideSearchChannels = remember(visibleGuideChannels) {
        visibleGuideChannels.map { (playlistId, channel, programmes) ->
            TvEpgSearchChannel(playlistId, channel, programmes)
        }
    }
    val programSearchActive = debouncedProgramSearchQuery.length >= TV_EPG_SEARCH_MIN_QUERY_LENGTH
    val programSearchNowMs = remember(debouncedProgramSearchQuery, epgOffsetMinutes) {
        epgProviderNowMs(System.currentTimeMillis(), epgOffsetMinutes)
    }
    var guideSearchHits by remember(playlists.map { it.id }) { mutableStateOf(emptyList<TvEpgSearchHit>()) }
    var guideSearchLoading by remember { mutableStateOf(false) }
    LaunchedEffect(
        guideSearchChannels,
        debouncedProgramSearchQuery,
        programSearchNowMs,
        guideFilter,
        favoriteKeys,
        recentOrder,
        playlists.map { it.id },
    ) {
        if (!programSearchActive) {
            guideSearchHits = emptyList()
            guideSearchLoading = false
            return@LaunchedEffect
        }
        guideSearchLoading = true
        val query = debouncedProgramSearchQuery
        val transientHits = searchTvEpgPrograms(guideSearchChannels, query, programSearchNowMs)
        val persistedHits = try {
            withContext(Dispatchers.IO) {
                repository.searchEpgPrograms(playlists, query, guideFilter, programSearchNowMs)
            }
        } catch (cancelled: kotlinx.coroutines.CancellationException) {
            throw cancelled
        } catch (_: Throwable) {
            emptyList()
        }
        guideSearchHits = rankTvEpgSearchHits(persistedHits + transientHits, query, programSearchNowMs)
        guideSearchLoading = false
    }
    val hasMoreChannels = playlists.any { playlist ->
        playlist.id !in exhaustedPlaylists &&
            (playlist.channels.size + extraChannels[playlist.id].orEmpty().size) < (playlist.catalogCounts?.channels ?: playlist.channels.size)
    }
    fun loadMoreGuide() {
        if (loadingMore) return
        if (guideChannels.size > channelLimit || !hasMoreChannels) {
            channelLimit += 20
            return
        }
        scope.launch {
            loadingMore = true
            val target = playlists.firstOrNull { playlist ->
                playlist.id !in exhaustedPlaylists &&
                    (playlist.channels.size + extraChannels[playlist.id].orEmpty().size) < (playlist.catalogCounts?.channels ?: playlist.channels.size)
            }
            if (target != null) {
                val existing = extraChannels[target.id].orEmpty()
                val page = withContext(Dispatchers.IO) {
                    repository.loadChannelPage(
                        target.id,
                        offset = target.channels.size + existing.size,
                        limit = 500,
                    )
                }
                if (page.isEmpty()) {
                    exhaustedPlaylists = exhaustedPlaylists + target.id
                } else {
                    extraChannels = extraChannels + (target.id to (existing + page))
                    val pageEpg = withContext(Dispatchers.IO) {
                        repository.loadEpgSnapshot(listOf(target.copy(channels = page)))
                    }
                    extraEpg = extraEpg + pageEpg
                    if (page.size < 500) exhaustedPlaylists = exhaustedPlaylists + target.id
                }
                channelLimit += 20
            }
            loadingMore = false
        }
    }
    Column(
        modifier = Modifier
            .verticalScroll(rememberScrollState())
            .onPreviewKeyEvent { event ->
                if (
                    event.type == KeyEventType.KeyDown &&
                    event.nativeKeyEvent.keyCode == android.view.KeyEvent.KEYCODE_DPAD_DOWN &&
                    programSearchFieldHasFocus && programSearchActive && guideSearchHits.isNotEmpty()
                ) {
                    firstProgramSearchResultFocusRequester.requestFocus()
                    true
                } else false
            },
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        TvScreenTitle("Guía TV")
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            TvOutlinedTextField(
                value = programSearchQuery,
                onValueChange = {
                    programSearchQuery = it
                },
                placeholder = { Text("Buscar programas por título o descripción", color = TvMuted, fontSize = 14.sp) },
                leadingIcon = { Text("⌕", color = TvMuted, fontSize = 22.sp) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search, showKeyboardOnFocus = false),
                keyboardActions = KeyboardActions(onSearch = { programSearchKeyboard?.hide() }),
                modifier = Modifier
                    .weight(1f)
                    .height(58.dp)
                    .onFocusChanged { programSearchFieldHasFocus = it.isFocused }
                    .focusProperties {
                        if (programSearchActive && guideSearchHits.isNotEmpty()) {
                            down = firstProgramSearchResultFocusRequester
                        }
                    },
            )
            if (programSearchQuery.isNotBlank()) {
                TvTextButton(
                    onClick = {
                        programSearchQuery = ""
                        debouncedProgramSearchQuery = ""
                        programSearchKeyboard?.hide()
                    },
                    modifier = Modifier.tvDpadClick {
                        programSearchQuery = ""
                        debouncedProgramSearchQuery = ""
                        programSearchKeyboard?.hide()
                    },
                ) { Text("Limpiar búsqueda") }
            }
        }
        if (programSearchQuery.trim().length == 1) {
            Text("Escribe al menos dos caracteres para buscar.", color = TvMuted, fontSize = 13.sp)
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            TvButton(
                onClick = { guideDayOffset = (guideDayOffset - 1).coerceAtLeast(-7) },
                modifier = Modifier.tvDpadClick { guideDayOffset = (guideDayOffset - 1).coerceAtLeast(-7) },
                enabled = guideDayOffset > -7 && !guideDayLoading,
            ) { Text("‹ Día anterior") }
            Text(
                formatGuideDate(now),
                color = TvText,
                fontFamily = TvType.Display,
                fontSize = 17.sp,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                modifier = Modifier.width(150.dp),
            )
            TvButton(
                onClick = { guideDayOffset = 0 },
                modifier = Modifier.tvDpadClick { guideDayOffset = 0 },
                enabled = guideDayOffset != 0 && !guideDayLoading,
            ) { Text("Hoy") }
            TvButton(
                onClick = { guideDayOffset = (guideDayOffset + 1).coerceAtMost(7) },
                modifier = Modifier.tvDpadClick { guideDayOffset = (guideDayOffset + 1).coerceAtMost(7) },
                enabled = guideDayOffset < 7 && !guideDayLoading,
            ) { Text("Día siguiente ›") }
            if (guideDayLoading) Text("Cargando…", color = TvMuted, fontSize = 14.sp)
        }
        LazyRow(
            contentPadding = PaddingValues(vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            itemsIndexed(guideFilters) { _, filter ->
                TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                    onClick = { guideFilter = filter },
                    modifier = Modifier.height(32.dp).tvDpadClick { guideFilter = filter },
                    colors = androidx.tv.material3.CardDefaults.colors(
                        containerColor = if (guideFilter == filter) tvTone(TvTone.Accent) else tvTone(TvTone.Surface).copy(alpha = 0.9f),
                        focusedContainerColor = if (guideFilter == filter) tvTone(TvTone.AccentSoft) else tvTone(TvTone.Focused),
                    ),
                ) {
                    Box(Modifier.fillMaxHeight().padding(horizontal = 16.dp), contentAlignment = Alignment.Center) {
                        Text(
                            filter,
                            color = if (guideFilter == filter) tvTone(TvTone.AccentInk) else tvTone(TvTone.TextSoft),
                            fontSize = 11.sp,
                            maxLines = 1,
                        )
                    }
                }
            }
        }
        TvButton(
            onClick = onRefresh,
            modifier = Modifier
                .then(initialFocusRequester?.let { Modifier.focusRequester(it) } ?: Modifier)
                .tvDpadClick(onRefresh),
            enabled = !refreshing,
        ) {
            Text(if (refreshing) "Actualizando EPG…" else "Actualizar EPG")
        }
        statusMessage?.let { Text(it, color = TvMuted, fontSize = 16.sp) }
        if (programSearchActive) {
            Text(
                "Programas coincidentes · ${guideSearchHits.size}" +
                    (if (guideSearchHits.size == TV_EPG_SEARCH_RESULT_LIMIT) " · primeros 20" else "") +
                    (if (guideSearchLoading) " · buscando…" else ""),
                color = TvText,
                fontSize = 19.sp,
            )
            if (guideSearchHits.isEmpty()) {
                if (guideSearchLoading) {
                    Text("Buscando en la programación guardada…", color = TvMuted, fontSize = 16.sp)
                } else {
                    Text(
                        "No hay coincidencias en la programación guardada para este filtro.",
                        color = TvMuted,
                        fontSize = 16.sp,
                    )
                }
            } else {
                guideSearchHits.forEachIndexed { index, hit ->
                    val catchupAvailable = tvCatchupAvailable(hit.channel, hit.programme, actualNow)
                    val canPlay = hit.programme.endMs > actualNow || catchupAvailable
                    val sourceName = playlists.firstOrNull { it.id == hit.playlistId }?.name
                    TvCard(
                        onClick = {
                            if (canPlay) onPlay(hit.playlistId, hit.channel, hit.programme)
                        },
                        modifier = Modifier
                            .then(if (index == 0) Modifier.focusRequester(firstProgramSearchResultFocusRequester) else Modifier)
                            .fillMaxWidth()
                            .heightIn(min = 84.dp)
                            .tvDpadClick {
                                if (canPlay) onPlay(hit.playlistId, hit.channel, hit.programme)
                            },
                        colors = androidx.tv.material3.CardDefaults.colors(
                            containerColor = tvColor(Color(0xFF202532)),
                            focusedContainerColor = tvColor(Color(0xFF536A9F)),
                        ),
                    ) {
                        Column(
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 12.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Text(
                                "${displayTvChannelName(hit.channel.name, stripCountryPrefixes)}${sourceName?.let { " · $it" }.orEmpty()}",
                                color = tvColor(Color(0xFF9CC1FF)),
                                fontSize = 14.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(hit.programme.title, color = TvText, fontSize = 19.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(
                                "${formatGuideDate(displayTime(hit.programme.startMs))} · ${formatGuideTime(displayTime(hit.programme.startMs))}–${formatGuideTime(displayTime(hit.programme.endMs))}" +
                                    when {
                                        hit.programme.startMs <= actualNow && hit.programme.endMs > actualNow && catchupAvailable -> " · Desde el inicio"
                                        catchupAvailable -> " · Catch-up"
                                        hit.programme.endMs <= actualNow -> " · Archivo no disponible"
                                        else -> ""
                                    },
                                color = TvMuted,
                                fontSize = 12.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
            if (hasMoreChannels) {
                TvButton(
                    onClick = ::loadMoreGuide,
                    modifier = Modifier.tvDpadClick(::loadMoreGuide),
                    enabled = !loadingMore,
                ) { Text(if (loadingMore) "Cargando canales…" else "Buscar en más canales") }
            }
        } else if (visibleGuideChannels.isEmpty()) {
            Text(
                "No hay datos EPG cargados todavía. La guía Xtream se consulta automáticamente para los primeros canales; también puedes añadir una URL XMLTV.",
                color = TvMuted,
                fontSize = 17.sp,
            )
            if (hasMoreChannels) {
                TvButton(
                    onClick = ::loadMoreGuide,
                    modifier = Modifier.tvDpadClick(::loadMoreGuide),
                    enabled = !loadingMore,
                ) { Text(if (loadingMore) "Cargando canales…" else "Buscar EPG en más canales") }
            }
        } else {
            visibleGuideChannels.take(channelLimit).forEach { (playlistId, channel, programmes) ->
                val current = programmes.firstOrNull { it.startMs <= now && it.endMs > now }
                val next = programmes.firstOrNull { it.startMs > now }
                Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(displayTvChannelName(channel.name, stripCountryPrefixes), color = TvText, fontFamily = TvType.Display, fontSize = 17.sp)
                        if (current != null) TvLiveBadge(Modifier.padding(start = 10.dp))
                        Spacer(Modifier.weight(1f))
                    }
                    current?.let { programme ->
                        val progress = ((now - programme.startMs).toFloat() / (programme.endMs - programme.startMs).toFloat())
                            .coerceIn(0f, 1f)
                        Text(
                            "${formatGuideTime(displayTime(programme.startMs))}–${formatGuideTime(displayTime(programme.endMs))}  ${programme.title}",
                            color = TvText,
                            fontSize = 12.sp,
                            maxLines = 1,
                        )
                        Box(modifier = Modifier.width(300.dp).height(3.dp).background(tvTone(TvTone.SurfaceTop), RoundedCornerShape(2.dp))) {
                            Box(modifier = Modifier.fillMaxWidth(progress).fillMaxSize().background(tvTone(TvTone.Accent), RoundedCornerShape(2.dp)))
                        }
                    }
                    next?.let { Text("Siguiente: ${it.title} · ${formatGuideTime(displayTime(it.startMs))}", color = TvMuted, fontSize = 11.sp) }
                }
                if (viewMode == "list") {
                    selectEpgWindow(programmes, now, 12).forEach { programme ->
                        val catchupAvailable = tvCatchupAvailable(channel, programme, actualNow)
                        val startOverAvailable = catchupAvailable &&
                            programme.startMs <= actualNow && programme.endMs > actualNow
                        val marker = when {
                            startOverAvailable -> " · Desde el inicio"
                            catchupAvailable -> " · Catch-up"
                            programme.endMs <= now -> " · Archivo no disponible"
                            programme == current -> " · Ahora"
                            else -> ""
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth().height(40.dp),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            TvCard(
                                onClick = {
                                    if (programme.endMs > actualNow || catchupAvailable) {
                                        onPlay(playlistId, channel, programme)
                                    }
                                },
                                modifier = Modifier
                                    .weight(1f)
                                    .fillMaxHeight()
                                    .tvDpadClick {
                                        if (programme.endMs > actualNow || catchupAvailable) {
                                            onPlay(playlistId, channel, programme)
                                        }
                                    },
                                colors = androidx.tv.material3.CardDefaults.colors(
                                    containerColor = tvColor(Color(0xFF202532)),
                                    focusedContainerColor = tvColor(Color(0xFF536A9F)),
                                ),
                            ) {
                                Row(modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Text("${formatGuideTime(displayTime(programme.startMs))}–${formatGuideTime(displayTime(programme.endMs))}", color = tvColor(Color(0xFF9CC1FF)), fontSize = 11.sp)
                                    Text("${programme.title}$marker", color = TvText, fontSize = 13.sp, modifier = Modifier.padding(start = 14.dp), maxLines = 1)
                                }
                            }
                            if (catchupAvailable) {
                                TvRailPill("Copiar URL", onClick = { onCopyCatchup(playlistId, channel, programme) }, modifier = Modifier.width(96.dp))
                                if (programme.endMs <= actualNow) {
                                    TvRailPill("Descargar", onClick = { onDownloadCatchup(playlistId, channel, programme) }, modifier = Modifier.width(96.dp))
                                }
                            }
                        }
                    }
                } else {
                    TvEpgRail(
                        programmes = selectEpgWindow(programmes, now, 8),
                        now = now,
                        playbackNow = actualNow,
                        displayTime = displayTime,
                        canCatchUp = { programme -> tvCatchupAvailable(channel, programme, actualNow) },
                        onPlay = { programme -> onPlay(playlistId, channel, programme) },
                        onDownload = { programme -> onDownloadCatchup(playlistId, channel, programme) },
                        onCopy = { programme -> onCopyCatchup(playlistId, channel, programme) },
                    )
                }
            }
            if (visibleGuideChannels.size > channelLimit || hasMoreChannels) {
                TvButton(
                    onClick = ::loadMoreGuide,
                    modifier = Modifier.tvDpadClick(::loadMoreGuide),
                    enabled = !loadingMore,
                ) { Text(if (loadingMore) "Cargando canales…" else "Cargar más canales de la guía") }
            }
        }
    }
}

private fun formatGuideTime(epochMs: Long): String =
    SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(epochMs))

private fun formatGuideDate(epochMs: Long): String =
    SimpleDateFormat("EEE d MMM", Locale.forLanguageTag("es-ES")).format(Date(epochMs))

/** Whether the provider metadata supports archive playback for a past or currently airing programme. */
internal fun tvCatchupAvailable(channel: TvChannel, programme: TvEpgEntry, nowMs: Long): Boolean {
    if (programme.startMs > nowMs || programme.endMs <= programme.startMs) return false
    if (!channel.tvArchive && channel.catchupDays <= 0) return false
    val isXtream = channel.id.startsWith("xtream:") && channel.tvArchive
    if (!isXtream && (channel.providerCommand != null || !supportsM3uCatchup(channel))) return false
    val archiveWindowMs = when {
        isXtream && channel.tvArchiveDurationMinutes > 0 -> channel.tvArchiveDurationMinutes.toLong() * 60L * 1_000L
        // The original EPG treats an enabled Xtream archive with no reported
        // duration as available without a known age limit.
        isXtream -> null
        channel.catchupDays > 0 -> channel.catchupDays.toLong() * 24L * 60L * 60L * 1_000L
        channel.tvArchiveDurationMinutes > 0 -> channel.tvArchiveDurationMinutes.toLong() * 60L * 1_000L
        else -> return false
    }
    return archiveWindowMs == null || programme.startMs >= nowMs - archiveWindowMs
}

/** Keeps guide availability, catch-up playback and archive downloads on the provider-adjusted EPG clock. */
internal fun isEpgProgrammePast(
    programEndMs: Long,
    systemNowMs: Long,
    providerClockOffsetMinutes: Int,
): Boolean = programEndMs <= epgProviderNowMs(systemNowMs, providerClockOffsetMinutes)

internal fun epgProviderNowMs(systemNowMs: Long, providerClockOffsetMinutes: Int): Long =
    systemNowMs - providerClockOffsetMinutes * 60_000L

@Composable
private fun TvEpgRail(
    programmes: List<TvEpgEntry>,
    now: Long,
    playbackNow: Long,
    displayTime: (Long) -> Long,
    canCatchUp: (TvEpgEntry) -> Boolean,
    onPlay: (TvEpgEntry) -> Unit,
    onDownload: (TvEpgEntry) -> Unit,
    onCopy: (TvEpgEntry) -> Unit,
) {
    LazyRow(
        contentPadding = PaddingValues(vertical = 8.dp, horizontal = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        itemsIndexed(programmes) { _, programme ->
            val catchupAvailable = canCatchUp(programme)
            val startOverAvailable = catchupAvailable &&
                programme.startMs <= playbackNow && programme.endMs > playbackNow
            val isNow = programme.startMs <= now && programme.endMs > now
            val status = when {
                startOverAvailable -> "Desde el inicio"
                catchupAvailable -> "Catch-up"
                programme.endMs <= now -> "Sin archivo"
                isNow -> "Ahora"
                else -> null
            }
            Column(Modifier.width(200.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                TvCard(
                    onClick = {
                        if (programme.endMs > playbackNow || catchupAvailable) onPlay(programme)
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(84.dp)
                        .tvDpadClick {
                            if (programme.endMs > playbackNow || catchupAvailable) onPlay(programme)
                        },
                    colors = androidx.tv.material3.CardDefaults.colors(
                        containerColor = if (isNow) tvTone(TvTone.Selected) else tvTone(TvTone.SurfaceHigh),
                        focusedContainerColor = tvTone(TvTone.Focused),
                    ),
                ) {
                    Column(
                        modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                "${formatGuideTime(displayTime(programme.startMs))}–${formatGuideTime(displayTime(programme.endMs))}",
                                color = if (isNow) tvTone(TvTone.Accent) else tvTone(TvTone.Muted),
                                fontFamily = TvType.BodyMedium,
                                fontSize = 9.sp,
                            )
                            Spacer(Modifier.weight(1f))
                            status?.let {
                                TvTag(it, tone = if (catchupAvailable || isNow) TvTone.Accent else TvTone.Muted)
                            }
                        }
                        Text(
                            programme.title,
                            color = tvTone(TvTone.Text),
                            fontSize = 12.sp,
                            lineHeight = 15.sp,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                if (catchupAvailable) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        TvRailPill("Copiar URL", onClick = { onCopy(programme) }, modifier = Modifier.weight(1f))
                        if (programme.endMs <= playbackNow) {
                            TvRailPill("Descargar", onClick = { onDownload(programme) }, modifier = Modifier.weight(1f))
                        }
                    }
                }
            }
        }
    }
}

internal fun redactTvSourceUrl(value: String): String {
    return value
        .replace(Regex("(?i)(://)[^/@:]+:[^/@]+@"), "$1•••:•••@")
        .replace(
            Regex("(?i)([?&](?:username|user|password|pass|token|api[_-]?key|key)=)[^&]*"),
            "$1•••",
        )
}

private fun formatResumePosition(positionMs: Long): String {
    val totalSeconds = positionMs / 1_000L
    return "${totalSeconds / 60}:${(totalSeconds % 60).toString().padStart(2, '0')}"
}

@Composable
internal fun FavoritesContent(
    favorites: List<TvSavedItem>,
    playlistNames: Map<String, String>,
    selectedPlaylistId: String?,
    searchQuery: androidx.compose.runtime.State<String>,
    sectionFilterFocusRequester: FocusRequester? = null,
    initialFocusRequester: FocusRequester? = null,
    onRemoveFavorite: (TvSavedItem) -> Unit,
    onClearFavorites: (TvSavedItemType, String?) -> Unit,
    onReorderFavorites: ((List<TvSavedItem>, String?) -> Unit)? = null,
    onEditEpg: ((TvSavedItem) -> Unit)? = null,
    onFavoriteClick: (TvSavedItem, List<TvChannelZapEntry>) -> Unit,
    onGoHome: () -> Unit = {},
) {
    val context = LocalContext.current
    val preferences = remember(context) {
        context.getSharedPreferences("iptvnator-tv-ui", Context.MODE_PRIVATE)
    }
    var allPlaylists by remember(preferences) {
        mutableStateOf(loadTvCollectionScopeIsAll(preferences, TvCollectionScopeView.FAVORITES))
    }
    val setAllPlaylists: (Boolean) -> Unit = { all ->
        allPlaylists = all
        if (selectedPlaylistId != null) {
            saveTvCollectionScopeIsAll(preferences, TvCollectionScopeView.FAVORITES, all)
        }
    }
    var selectedType by remember { mutableStateOf(TvSavedItemType.CHANNEL) }
    var selectedCategory by remember(selectedPlaylistId, allPlaylists, selectedType) {
        mutableStateOf<String?>(null)
    }
    val favoriteSearchQuery = searchQuery.value
    val favoriteCategoryFocusRequester = remember { FocusRequester() }
    val favoriteTypeFocusRequester = initialFocusRequester ?: remember { FocusRequester() }
    val favoritePlaylistScopeFocusRequester = remember { FocusRequester() }
    // Keep the section-entry requester on the type filter. Reusing it on the
    // first result row makes Compose attach one requester to two focus targets
    // and D-pad input can land on the rail instead of the filter bar.
    val favoriteResultsFocusRequester = remember { FocusRequester() }
    val emptyFavoritesHomeFocusRequester = initialFocusRequester ?: remember { FocusRequester() }
    var showClearConfirmation by remember { mutableStateOf(false) }
    var channelSortMode by remember(preferences) {
        mutableStateOf(
            runCatching {
                TvFavoriteChannelSortMode.valueOf(
                    preferences.getString("favorites_channel_sort_mode", "custom")!!.uppercase(Locale.ROOT),
                )
            }.getOrDefault(TvFavoriteChannelSortMode.CUSTOM),
        )
    }
    val scopedFavorites = remember(favorites, allPlaylists, selectedPlaylistId) {
        favorites.filter {
            allPlaylists || selectedPlaylistId == null || it.playlistId == selectedPlaylistId
        }
    }
    val categoryOptions = remember(scopedFavorites, selectedType) {
        tvFavoriteCategoryOptions(scopedFavorites, selectedType)
    }
    LaunchedEffect(categoryOptions, selectedCategory) {
        if (selectedCategory != null && categoryOptions.none { it.equals(selectedCategory, ignoreCase = true) }) {
            selectedCategory = null
        }
    }
    val favoriteOrderScope = selectedPlaylistId.takeUnless { allPlaylists }
    val scopedChannelKeys = remember(scopedFavorites) {
        scopedFavorites.filter { it.itemType == TvSavedItemType.CHANNEL }.map(::tvFavoriteOrderKey)
    }
    var customOrderOverride by remember(favoriteOrderScope, scopedChannelKeys) {
        mutableStateOf<List<String>?>(null)
    }
    val availableTypes = remember(scopedFavorites) {
        listOf(TvSavedItemType.CHANNEL, TvSavedItemType.VOD, TvSavedItemType.SERIES)
            .filter { type -> scopedFavorites.any { it.itemType == type } }
    }
    LaunchedEffect(availableTypes) {
        if (selectedType !in availableTypes) selectedType = availableTypes.firstOrNull() ?: TvSavedItemType.CHANNEL
    }
    val visibleFavorites by produceState(
        initialValue = emptyList<TvSavedItem>(),
        scopedFavorites,
        selectedType,
        selectedCategory,
        favoriteSearchQuery,
        channelSortMode,
        customOrderOverride,
        favoriteOrderScope,
    ) {
        // Searching/sorting can touch a large Xtream favorites set. Keep it
        // off the Compose dispatcher so header typing and D-pad focus remain
        // responsive while the filtered rows are prepared.
        value = withContext(Dispatchers.Default) {
            filterTvFavoritesByQuery(
                filterTvFavoritesByCategory(
                    scopedFavorites.filter { it.itemType == selectedType },
                    selectedCategory,
                ),
                favoriteSearchQuery,
            ).let { items ->
                when (selectedType) {
                    TvSavedItemType.CHANNEL -> when (channelSortMode) {
                        TvFavoriteChannelSortMode.CUSTOM -> {
                            val persistedOrder = customOrderOverride?.withIndex()?.associate { it.value to it.index }
                            items.sortedWith(
                                compareBy<TvSavedItem> {
                                    persistedOrder?.get(tvFavoriteOrderKey(it))
                                        ?: (if (favoriteOrderScope == null) it.globalFavoriteOrder else it.playlistFavoriteOrder)
                                        ?: Int.MAX_VALUE
                                }.thenByDescending { it.savedAt },
                            )
                        }
                        TvFavoriteChannelSortMode.DATE_DESC -> items.sortedByDescending { it.savedAt }
                        TvFavoriteChannelSortMode.NAME_ASC -> items.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.title })
                        TvFavoriteChannelSortMode.NAME_DESC -> items.sortedWith(compareByDescending(String.CASE_INSENSITIVE_ORDER) { it.title })
                    }
                    else -> items.sortedByDescending { it.savedAt }
                }
            }
        }
    }
    val visibleChannelZapQueue = remember(visibleFavorites) {
        tvSavedChannelZapQueue(visibleFavorites)
    }
    val showContentTypePicker = availableTypes.size > 1
    LaunchedEffect(scopedFavorites.isEmpty()) {
        if (scopedFavorites.isEmpty()) {
            delay(100)
            runCatching { emptyFavoritesHomeFocusRequester.requestFocus() }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TvScreenTitle("Favoritos")
            Spacer(Modifier.weight(1f))
            if (visibleFavorites.isNotEmpty()) {
                TvButton(
                    onClick = { showClearConfirmation = true },
                    modifier = Modifier.height(38.dp).tvDpadClick { showClearConfirmation = true },
                ) { Text("Limpiar ${tvFavoriteTypeLabel(selectedType)}") }
            }
        }
        if (selectedPlaylistId != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(false to "Esta playlist", true to "Todas las playlists").forEachIndexed { index, (all, label) ->
                    TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                        onClick = { setAllPlaylists(all) },
                        modifier = Modifier
                            .height(38.dp)
                            .then(if (index == 0) Modifier.focusRequester(favoritePlaylistScopeFocusRequester) else Modifier)
                            .focusProperties {
                                down = when {
                                    showContentTypePicker -> favoriteTypeFocusRequester
                                    categoryOptions.isNotEmpty() -> favoriteCategoryFocusRequester
                                    else -> favoriteResultsFocusRequester
                                }
                            }
                            .tvDpadClick { setAllPlaylists(all) },
                        colors = androidx.tv.material3.CardDefaults.colors(
                            containerColor = if (allPlaylists == all) tvColor(Color(0xFF304A75)) else tvColor(Color(0xFF202532)),
                            focusedContainerColor = tvColor(Color(0xFF536A9F)),
                        ),
                    ) { Text(label, color = TvText, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) }
                }
            }
        }
        if (showContentTypePicker) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                availableTypes.forEachIndexed { index, type ->
                    val typeLabel = tvFavoriteTypeLabel(type)
                    TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                        onClick = { selectedType = type },
                        modifier = Modifier
                            .height(42.dp)
                            .then(if (index == 0) Modifier.focusRequester(favoriteTypeFocusRequester) else Modifier)
                            .focusProperties {
                                down = if (categoryOptions.isNotEmpty()) favoriteCategoryFocusRequester else favoriteResultsFocusRequester
                            }
                            .tvDpadClick { selectedType = type },
                        colors = androidx.tv.material3.CardDefaults.colors(
                            containerColor = if (selectedType == type) tvColor(Color(0xFF304A75)) else tvColor(Color(0xFF202532)),
                            focusedContainerColor = tvColor(Color(0xFF536A9F)),
                        ),
                    ) { Text(typeLabel, color = TvText, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 11.dp)) }
                }
            }
        }
        if (categoryOptions.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    if (selectedType == TvSavedItemType.CHANNEL) "Grupos" else "Categorías",
                    color = TvMuted,
                    fontSize = 12.sp,
                )
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    item(key = "all-categories") {
                        TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                            onClick = { selectedCategory = null },
                            modifier = Modifier
                                .height(38.dp)
                                .focusRequester(favoriteCategoryFocusRequester)
                                .focusProperties { down = favoriteResultsFocusRequester }
                                .tvDpadClick { selectedCategory = null },
                            colors = androidx.tv.material3.CardDefaults.colors(
                                containerColor = if (selectedCategory == null) tvColor(Color(0xFF304A75)) else tvColor(Color(0xFF202532)),
                                focusedContainerColor = tvColor(Color(0xFF536A9F)),
                            ),
                        ) {
                            Text(
                                if (selectedType == TvSavedItemType.CHANNEL) "Todos los grupos" else "Todas las categorías",
                                color = TvText,
                                fontSize = 12.sp,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                            )
                        }
                    }
                    items(categoryOptions, key = { "category:$it" }) { category ->
                        TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                            onClick = { selectedCategory = category },
                            modifier = Modifier
                                .height(38.dp)
                                .focusProperties { down = favoriteResultsFocusRequester }
                                .tvDpadClick { selectedCategory = category },
                            colors = androidx.tv.material3.CardDefaults.colors(
                                containerColor = if (selectedCategory.equals(category, ignoreCase = true)) tvColor(Color(0xFF304A75)) else tvColor(Color(0xFF202532)),
                                focusedContainerColor = tvColor(Color(0xFF536A9F)),
                            ),
                        ) {
                            Text(
                                category,
                                color = TvText,
                                fontSize = 12.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.widthIn(max = 240.dp).padding(horizontal = 12.dp, vertical = 10.dp),
                            )
                        }
                    }
                }
            }
        }
        if (selectedType == TvSavedItemType.CHANNEL && scopedFavorites.any { it.itemType == TvSavedItemType.CHANNEL }) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Orden", color = TvMuted, fontSize = 12.sp)
                TvFavoriteChannelSortMode.entries.forEach { mode ->
                    TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                        onClick = {
                            channelSortMode = mode
                            preferences.edit().putString("favorites_channel_sort_mode", mode.name.lowercase(Locale.ROOT)).apply()
                        },
                        modifier = Modifier.height(36.dp).tvDpadClick {
                            channelSortMode = mode
                            preferences.edit().putString("favorites_channel_sort_mode", mode.name.lowercase(Locale.ROOT)).apply()
                        },
                        colors = androidx.tv.material3.CardDefaults.colors(
                            containerColor = if (channelSortMode == mode) tvColor(Color(0xFF304A75)) else tvColor(Color(0xFF202532)),
                            focusedContainerColor = tvColor(Color(0xFF536A9F)),
                        ),
                    ) { Text(mode.label, color = TvText, fontSize = 11.sp, modifier = Modifier.padding(horizontal = 10.dp, vertical = 10.dp)) }
                }
            }
            if (channelSortMode == TvFavoriteChannelSortMode.CUSTOM && onReorderFavorites != null) {
                Text(
                    when {
                        favoriteSearchQuery.isNotBlank() -> "Borra la búsqueda para cambiar el orden."
                        selectedCategory != null -> "Para cambiar el orden, selecciona Todos los grupos."
                        else -> "Pulsa derecha hasta ★, ↑ o ↓ y confirma para gestionar el orden."
                    },
                    color = TvMuted,
                    fontSize = 11.sp,
                )
            }
        }
        if (visibleFavorites.isEmpty()) {
            if (scopedFavorites.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxWidth().weight(1f),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        val heartColor = tvColor(Color(0xFF78ADFF))
                        Canvas(Modifier.size(56.dp)) {
                            val w = size.width
                            val h = size.height
                            val heart = Path().apply {
                                moveTo(w * 0.5f, h * 0.9f)
                                cubicTo(w * 0.12f, h * 0.62f, w * 0.02f, h * 0.42f, w * 0.1f, h * 0.24f)
                                cubicTo(w * 0.19f, h * 0.05f, w * 0.41f, h * 0.08f, w * 0.5f, h * 0.29f)
                                cubicTo(w * 0.59f, h * 0.08f, w * 0.81f, h * 0.05f, w * 0.9f, h * 0.24f)
                                cubicTo(w * 0.98f, h * 0.42f, w * 0.88f, h * 0.62f, w * 0.5f, h * 0.9f)
                                close()
                            }
                            drawPath(heart, heartColor)
                        }
                        Text("Aún no hay favoritos", color = TvText, fontSize = 22.sp, fontFamily = TvType.Display)
                        Text(
                            "Marca con la estrella cualquier canal, película o serie para guardarlo aquí.",
                            color = TvMuted,
                            fontSize = 15.sp,
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                            modifier = Modifier.widthIn(max = 520.dp),
                        )
                        TvButton(
                            onClick = onGoHome,
                            modifier = Modifier
                                .focusRequester(emptyFavoritesHomeFocusRequester)
                                .tvDpadFocus(),
                        ) { Text("Volver a Inicio") }
                    }
                }
            } else {
                Box(
                    modifier = Modifier.fillMaxWidth().weight(1f),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        when {
                            favoriteSearchQuery.isNotBlank() -> "No hay favoritos que coincidan con «${favoriteSearchQuery.trim()}»."
                            selectedCategory != null -> "No hay favoritos en este grupo o categoría."
                            else -> "No hay favoritos de tipo ${tvFavoriteTypeLabel(selectedType).lowercase(Locale.getDefault())}."
                        },
                        color = TvMuted,
                        fontSize = 15.sp,
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    )
                }
            }
        } else {
            TvSavedItemRail(
                items = visibleFavorites,
                playlistNames = playlistNames,
                initialFocusRequester = if (showContentTypePicker) favoriteResultsFocusRequester
                else initialFocusRequester ?: favoriteResultsFocusRequester,
                firstItemUpFocusRequester = sectionFilterFocusRequester,
                onItemClick = { index ->
                    visibleFavorites.getOrNull(index)?.let { onFavoriteClick(it, visibleChannelZapQueue) }
                },
                onRemoveItem = { index -> visibleFavorites.getOrNull(index)?.let(onRemoveFavorite) },
                onEditEpg = if (selectedType == TvSavedItemType.CHANNEL && onEditEpg != null) {
                    { index -> visibleFavorites.getOrNull(index)?.let(onEditEpg) }
                } else null,
                onMoveItem = if (selectedType == TvSavedItemType.CHANNEL && selectedCategory == null && favoriteSearchQuery.isBlank() && channelSortMode == TvFavoriteChannelSortMode.CUSTOM && onReorderFavorites != null) {
                    { index, delta ->
                        val destination = index + delta
                        if (destination in visibleFavorites.indices) {
                            val reordered = visibleFavorites.toMutableList().apply {
                                add(destination, removeAt(index))
                            }
                            customOrderOverride = reordered.map(::tvFavoriteOrderKey)
                            onReorderFavorites(reordered, favoriteOrderScope)
                        }
                    }
                } else null,
            )
        }
    }
    if (showClearConfirmation) {
        val playlistScope = selectedPlaylistId.takeUnless { allPlaylists }
        TvAlertDialog(
            onDismissRequest = { showClearConfirmation = false },
            title = { Text("Limpiar favoritos de ${tvFavoriteTypeLabel(selectedType)}") },
            text = {
                Text(
                    if (playlistScope == null) "Se quitarán todos los favoritos de ${tvFavoriteTypeLabel(selectedType).lowercase(Locale.getDefault())} de todas las playlists. El historial y los elementos vistos se conservarán."
                    else "Se quitarán los favoritos de ${tvFavoriteTypeLabel(selectedType).lowercase(Locale.getDefault())} de esta playlist. El historial y los elementos vistos se conservarán.",
                )
            },
            confirmButton = {
                TvButton(
                    onClick = {
                        onClearFavorites(selectedType, playlistScope)
                        showClearConfirmation = false
                    },
                    modifier = Modifier.tvDpadClick {
                        onClearFavorites(selectedType, playlistScope)
                        showClearConfirmation = false
                    },
                ) { Text("Quitar favoritos") }
            },
            dismissButton = {
                TvButton(onClick = { showClearConfirmation = false }, modifier = Modifier.tvDpadClick { showClearConfirmation = false }) {
                    Text("Cancelar")
                }
            },
        )
    }
}

private enum class TvFavoriteChannelSortMode(val label: String) {
    CUSTOM("Personalizado"),
    NAME_ASC("Nombre A–Z"),
    NAME_DESC("Nombre Z–A"),
    DATE_DESC("Más recientes"),
}

private fun tvFavoriteTypeLabel(type: TvSavedItemType): String = when (type) {
    TvSavedItemType.CHANNEL -> "TV en directo"
    TvSavedItemType.VOD -> "Películas"
    TvSavedItemType.SERIES -> "Series"
}

private fun tvFavoriteOrderKey(item: TvSavedItem): String =
    "${item.playlistId}\u0000${item.itemType.name}\u0000${item.itemKey}"

private data class TvRetryDownloadRequest(
    val url: String,
    val extension: String?,
    val userAgent: String?,
    val headers: Map<String, String> = emptyMap(),
)

private fun formatTvRecordingBytes(bytes: Long): String = when {
    bytes >= 1024L * 1024L * 1024L -> "%.1f GB".format(Locale.getDefault(), bytes / (1024.0 * 1024.0 * 1024.0))
    bytes >= 1024L * 1024L -> "%.1f MB".format(Locale.getDefault(), bytes / (1024.0 * 1024.0))
    bytes >= 1024L -> "%.1f KB".format(Locale.getDefault(), bytes / 1024.0)
    else -> "$bytes B"
}

private fun formatTvRecordingElapsed(startedAtMs: Long, nowMs: Long): String {
    val totalSeconds = ((nowMs - startedAtMs).coerceAtLeast(0L) / 1_000L)
    val hours = totalSeconds / 3_600L
    val minutes = (totalSeconds % 3_600L) / 60L
    val seconds = totalSeconds % 60L
    return if (hours > 0L) {
        "%d:%02d:%02d".format(Locale.getDefault(), hours, minutes, seconds)
    } else {
        "%02d:%02d".format(Locale.getDefault(), minutes, seconds)
    }
}

private enum class TvDownloadAction {
    PLAY,
    OPEN,
    PAUSE,
    CANCEL,
    RESUME,
    REMOVE,
    RETRY,
}

private fun tvDownloadActions(
    record: TvDownloadRecord,
    snapshot: TvDownloadSnapshot?,
): List<TvDownloadAction> {
    val isSuccessful = snapshot?.status == DownloadManager.STATUS_SUCCESSFUL
    val isFailed = snapshot?.status == DownloadManager.STATUS_FAILED
    val isPaused = snapshot?.status == DownloadManager.STATUS_PAUSED
    val isPending = snapshot?.status == DownloadManager.STATUS_PENDING
    val isRunning = snapshot?.status == DownloadManager.STATUS_RUNNING
    val canPlay = isSuccessful && !snapshot?.localUri.isNullOrBlank()
    val canPause = (isPending || isRunning) && snapshot?.supportsResume == true
    val canCancel = isPending || isRunning || (isPaused && snapshot?.supportsResume == true)
    val canResume = isPaused && snapshot?.supportsResume == true
    val canRemove = isSuccessful || isFailed || snapshot == null
    val canRetry = record.cancelled || isFailed ||
        (isPaused && snapshot?.supportsResume != true) || snapshot == null
    return buildList {
        if (canPlay) add(TvDownloadAction.PLAY)
        if (record.contentType != "catchup") add(TvDownloadAction.OPEN)
        if (canPause) add(TvDownloadAction.PAUSE)
        if (canCancel) add(TvDownloadAction.CANCEL)
        if (canResume) add(TvDownloadAction.RESUME)
        if (canRemove) add(TvDownloadAction.REMOVE)
        if (canRetry) add(TvDownloadAction.RETRY)
    }
}

@Composable
internal fun DownloadsContent(
    records: List<TvDownloadRecord>,
    snapshots: Map<Long, TvDownloadSnapshot>,
    playlistNames: Map<String, String> = emptyMap(),
    recordings: List<TvRecording>,
    activeRecording: TvRecording? = null,
    message: String?,
    initialFocusRequester: FocusRequester? = null,
    onClearCompleted: () -> Unit,
    onCancel: (TvDownloadRecord) -> Unit,
    onPause: (TvDownloadRecord) -> Unit,
    onResume: (TvDownloadRecord) -> Unit,
    onRemove: (TvDownloadRecord) -> Unit,
    onRetry: (TvDownloadRecord) -> Unit,
    onPlayRecording: (TvRecording) -> Unit,
    onRemoveRecording: (TvRecording) -> Unit,
    onStopRecording: () -> Unit = {},
    onPlay: (TvDownloadRecord, TvDownloadSnapshot) -> Unit,
    onOpen: (TvDownloadRecord) -> Unit,
) {
    var filter by remember { mutableStateOf("Todas") }
    var recordingClockMs by remember { mutableStateOf(System.currentTimeMillis()) }
    var pendingLegacyRetry by remember { mutableStateOf<TvDownloadRecord?>(null) }
    val firstDownloadFilterFocusRequester = initialFocusRequester ?: remember { FocusRequester() }
    val legacyRetryCancelFocusRequester = remember { FocusRequester() }
    val legacyRetryConfirmFocusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        delay(100)
        firstDownloadFilterFocusRequester.requestFocus()
    }
    LaunchedEffect(activeRecording?.file?.absolutePath, activeRecording?.status) {
        while (activeRecording?.status == TvRecordingStatus.RECORDING) {
            recordingClockMs = System.currentTimeMillis()
            delay(1_000L)
        }
    }
    LaunchedEffect(pendingLegacyRetry?.downloadId) {
        if (pendingLegacyRetry != null) {
            delay(100)
            runCatching { legacyRetryCancelFocusRequester.requestFocus() }
        }
    }
    val visibleRecords = records.filter { record ->
        val snapshot = snapshots[record.downloadId]
        when (filter) {
            "Películas" -> record.contentType == "vod" || record.contentType == "m3u" || record.contentType == "catchup"
            "Series" -> record.contentType == "series-episode"
            "Grabaciones" -> false
            "En curso" -> snapshot?.status == DownloadManager.STATUS_PENDING || snapshot?.status == DownloadManager.STATUS_RUNNING || snapshot?.status == DownloadManager.STATUS_PAUSED
            else -> true
        }
    }
    val allRecordings = buildList {
        activeRecording?.let { add(it) }
        addAll(recordings.filterNot { it.file.absolutePath == activeRecording?.file?.absolutePath })
    }
    val visibleRecordings = if (filter == "Todas" || filter == "Grabaciones") allRecordings else emptyList()
    val downloadRecordKeys = visibleRecords.map { it.downloadId }
    val downloadBringIntoView = remember(downloadRecordKeys) {
        downloadRecordKeys.associateWith { BringIntoViewRequester() }
    }
    val downloadActionFocusRequesters = remember(downloadRecordKeys) {
        downloadRecordKeys.associateWith {
            TvDownloadAction.values().associateWith { FocusRequester() }
        }
    }
    val firstVisibleDownloadActionFocusRequester = visibleRecords.asSequence()
        .mapNotNull { record ->
            val firstAction = tvDownloadActions(record, snapshots[record.downloadId]).firstOrNull()
            firstAction?.let { downloadActionFocusRequesters[record.downloadId]?.get(it) }
        }
        .firstOrNull()
    val downloadFocusScope = rememberCoroutineScope()
    fun Modifier.keepDownloadActionVisible(record: TvDownloadRecord): Modifier {
        val requester = downloadBringIntoView[record.downloadId] ?: return this
        return bringIntoViewRequester(requester).onFocusChanged { state ->
            if (state.isFocused) {
                downloadFocusScope.launch { requester.bringIntoView() }
            }
        }
    }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        TvScreenTitle("Descargas")
        message?.let { Text(it, color = TvMuted, fontSize = 15.sp) }
        if (visibleRecordings.isNotEmpty()) {
            Text("Grabaciones de TV", color = TvText, fontSize = 22.sp, fontFamily = TvType.Display)
            visibleRecordings.forEach { recording ->
                val liveBytes = if (recording.status == TvRecordingStatus.RECORDING) {
                    maxOf(recording.bytes, recording.file.length())
                } else recording.bytes
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (recording.status == TvRecordingStatus.RECORDING) {
                        Surface(
                            shape = RoundedCornerShape(5.dp),
                            colors = androidx.tv.material3.SurfaceDefaults.colors(containerColor = tvColor(Color(0xFF8E3944))),
                        ) {
                            Text("● REC", color = tvColor(Color(0xFFFFD7D9)), fontSize = 12.sp, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp))
                        }
                    }
                    Text(recording.title, color = TvText, fontSize = 18.sp)
                    Text(
                        if (recording.status == TvRecordingStatus.RECORDING) {
                            "${formatTvRecordingElapsed(recording.startedAtMs, recordingClockMs)} · ${formatTvRecordingBytes(liveBytes)}"
                        } else {
                            formatTvRecordingBytes(liveBytes)
                        },
                        color = TvMuted,
                        fontSize = 14.sp,
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    if (recording.status == TvRecordingStatus.RECORDING) {
                        TvButton(
                            onClick = onStopRecording,
                            modifier = Modifier.tvDpadClick(onStopRecording),
                        ) { Text("Detener") }
                    } else {
                        TvButton(
                            onClick = { onPlayRecording(recording) },
                            modifier = Modifier.tvDpadClick { onPlayRecording(recording) },
                        ) { Text("Reproducir") }
                        TvButton(
                            onClick = { onRemoveRecording(recording) },
                            modifier = Modifier.tvDpadClick { onRemoveRecording(recording) },
                        ) { Text("Quitar") }
                    }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("Todas", "Películas", "Series", "Grabaciones", "En curso").forEach { option ->
                TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                    onClick = { filter = option },
                    modifier = Modifier
                        .height(34.dp)
                        .then(if (option == "Todas") Modifier.focusRequester(firstDownloadFilterFocusRequester) else Modifier)
                        .focusProperties {
                            firstVisibleDownloadActionFocusRequester?.let { down = it }
                        }
                        .tvDpadClick { filter = option },
                    colors = androidx.tv.material3.CardDefaults.colors(
                        containerColor = if (filter == option) tvColor(Color(0xFF304A75)) else tvTone(TvTone.Surface).copy(alpha = 0.9f),
                        focusedContainerColor = tvColor(Color(0xFF536A9F)),
                    ),
                ) { Text(option, color = TvText, fontSize = 11.sp, modifier = Modifier.padding(horizontal = 12.dp, vertical = 9.dp)) }
            }
            val hasCompleted = records.any { record ->
                val status = snapshots[record.downloadId]?.status
                    status == DownloadManager.STATUS_SUCCESSFUL ||
                        status == DownloadManager.STATUS_FAILED ||
                        status == null
            }
            if (hasCompleted) {
                TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                    onClick = onClearCompleted,
                    modifier = Modifier
                        .height(34.dp)
                        .focusProperties {
                            firstVisibleDownloadActionFocusRequester?.let { down = it }
                        }
                        .tvDpadClick(onClearCompleted),
                    colors = androidx.tv.material3.CardDefaults.colors(
                        containerColor = Color.Transparent,
                        focusedContainerColor = tvColor(Color(0xFF536A9F)),
                    ),
                ) {
                    Text("Limpiar terminadas", color = TvText, fontSize = 11.sp, modifier = Modifier.padding(horizontal = 12.dp, vertical = 9.dp))
                }
            }
        }
        if (visibleRecords.isEmpty() && visibleRecordings.isEmpty()) {
            TvEmptyState(
                title = if (filter == "Grabaciones") "Todavía no hay grabaciones" else "Todavía no hay descargas",
                message = if (filter == "Grabaciones") "Graba un canal en directo desde el reproductor para verlo aquí."
                else "Descarga películas o episodios desde su ficha para verlos sin conexión.",
                glyph = TvSection.Downloads,
            )
        } else {
            visibleRecords.forEach { record ->
                val snapshot = snapshots[record.downloadId]
                val isSuccessful = snapshot?.status == DownloadManager.STATUS_SUCCESSFUL
                val isFailed = snapshot?.status == DownloadManager.STATUS_FAILED
                val isPaused = snapshot?.status == DownloadManager.STATUS_PAUSED
                val isPending = snapshot?.status == DownloadManager.STATUS_PENDING
                val isRunning = snapshot?.status == DownloadManager.STATUS_RUNNING
                val canPlay = isSuccessful && !snapshot?.localUri.isNullOrBlank()
                val canPause = (isPending || isRunning) && snapshot?.supportsResume == true
                val canCancel = isPending || isRunning || (isPaused && snapshot?.supportsResume == true)
                val canResume = isPaused && snapshot?.supportsResume == true
                val canRemove = isSuccessful || isFailed || snapshot == null
                val canRetry = record.cancelled || isFailed ||
                    (isPaused && snapshot?.supportsResume != true) || snapshot == null
                val visibleActions = tvDownloadActions(record, snapshot)
                val rowFocusRequesters = downloadActionFocusRequesters[record.downloadId].orEmpty()
                fun actionFocusModifier(action: TvDownloadAction): Modifier {
                    val position = visibleActions.indexOf(action)
                    return Modifier
                        .focusRequester(rowFocusRequesters.getValue(action))
                        .focusProperties {
                            if (position > 0) left = rowFocusRequesters.getValue(visibleActions[position - 1])
                            if (position < visibleActions.lastIndex) right = rowFocusRequesters.getValue(visibleActions[position + 1])
                        }
                        .onPreviewKeyEvent { event ->
                            if (event.nativeKeyEvent.action != android.view.KeyEvent.ACTION_DOWN) {
                                return@onPreviewKeyEvent false
                            }
                            val destination = when (event.nativeKeyEvent.keyCode) {
                                android.view.KeyEvent.KEYCODE_DPAD_LEFT -> position - 1
                                android.view.KeyEvent.KEYCODE_DPAD_RIGHT -> position + 1
                                else -> return@onPreviewKeyEvent false
                            }
                            if (destination !in visibleActions.indices) return@onPreviewKeyEvent false
                            rowFocusRequesters.getValue(visibleActions[destination]).requestFocus()
                            true
                        }
                }
                val status = when {
                    record.cancelled -> "Cancelada"
                    isSuccessful -> "Completada"
                    isFailed -> "Fallida"
                    isPaused -> "Pausada"
                    isPending -> "Pendiente"
                    isRunning -> "Descargando${snapshot?.progressPercent?.let { " $it%" }.orEmpty()}"
                    else -> "Estado no disponible"
                }
                Text(
                    "${record.title} · ${playlistNames[record.playlistId] ?: "Fuente desconocida"} · $status",
                    color = TvText,
                    fontSize = 18.sp,
                    maxLines = 1,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    if (canPlay) {
                        val playableSnapshot = checkNotNull(snapshot)
                        TvButton(
                            onClick = { onPlay(record, playableSnapshot) },
                            modifier = Modifier
                                .then(actionFocusModifier(TvDownloadAction.PLAY))
                                .keepDownloadActionVisible(record)
                                .tvDpadFocus(),
                        ) { Text("Reproducir") }
                    }
                    if (record.contentType != "catchup") {
                        TvButton(
                            onClick = { onOpen(record) },
                            modifier = Modifier
                                .then(actionFocusModifier(TvDownloadAction.OPEN))
                                .keepDownloadActionVisible(record)
                                .tvDpadFocus(),
                        ) {
                            Text("Abrir detalle")
                        }
                    }
                    if (canPause) {
                        TvButton(
                            onClick = { onPause(record) },
                            modifier = Modifier
                                .then(actionFocusModifier(TvDownloadAction.PAUSE))
                                .keepDownloadActionVisible(record)
                                .tvDpadFocus(),
                        ) { Text("Pausar") }
                    }
                    if (canCancel) {
                        TvButton(
                            onClick = { onCancel(record) },
                            modifier = Modifier
                                .then(actionFocusModifier(TvDownloadAction.CANCEL))
                                .keepDownloadActionVisible(record)
                                .tvDpadFocus(),
                        ) {
                            Text("Cancelar")
                        }
                    }
                    if (canResume) {
                        TvButton(
                            onClick = { onResume(record) },
                            modifier = Modifier
                                .then(actionFocusModifier(TvDownloadAction.RESUME))
                                .keepDownloadActionVisible(record)
                                .tvDpadFocus(),
                        ) { Text("Reanudar") }
                    }
                    if (canRemove) {
                        TvButton(
                            onClick = { onRemove(record) },
                            modifier = Modifier
                                .then(actionFocusModifier(TvDownloadAction.REMOVE))
                                .keepDownloadActionVisible(record)
                                .tvDpadFocus(),
                        ) {
                            Text("Quitar")
                        }
                    }
                    if (canRetry) {
                        val retryAction = {
                            if (snapshot?.supportsResume == true) onRetry(record)
                            else pendingLegacyRetry = record
                        }
                        TvButton(
                            onClick = retryAction,
                            modifier = Modifier
                                .then(actionFocusModifier(TvDownloadAction.RETRY))
                                .keepDownloadActionVisible(record)
                                .tvDpadFocus(),
                        ) {
                            Text(if (snapshot?.supportsResume == true) "Reintentar" else "Descargar desde cero")
                        }
                    }
                }
            }
        }
    }
    pendingLegacyRetry?.let { record ->
        val dismiss = { pendingLegacyRetry = null }
        val confirm = {
            pendingLegacyRetry = null
            onRetry(record)
        }
        TvAlertDialog(
            onDismissRequest = dismiss,
            title = { Text("Descarga no reanudable") },
            text = {
                Text(
                    "Android no puede continuar el parcial de esta descarga anterior. " +
                        "Si sigues, se iniciará desde el principio y se sustituirá esta entrada del historial.",
                )
            },
            dismissButton = {
                TvButton(
                    onClick = dismiss,
                    modifier = Modifier
                        .focusRequester(legacyRetryCancelFocusRequester)
                        .focusProperties { right = legacyRetryConfirmFocusRequester }
                        .tvDpadFocus(),
                ) { Text("Cancelar") }
            },
            confirmButton = {
                TvButton(
                    onClick = confirm,
                    modifier = Modifier
                        .focusRequester(legacyRetryConfirmFocusRequester)
                        .focusProperties { left = legacyRetryCancelFocusRequester }
                        .tvDpadFocus(),
                ) { Text("Empezar de nuevo") }
            },
        )
    }
}

@Composable
private fun SettingsContent(
    credentialVault: TvCredentialVault,
    themeMode: TvVisualTheme,
    onThemeModeChange: (TvVisualTheme) -> Unit,
    playlists: List<StoredPlaylist>,
    busyPlaylistId: String?,
    statusMessage: String?,
    onRefresh: (StoredPlaylist) -> Unit,
    onRequestDelete: (StoredPlaylist) -> Unit,
    startupSection: TvSection,
    onStartupSectionChange: (TvSection) -> Unit,
    showDashboard: Boolean,
    onShowDashboardChange: (Boolean) -> Unit,
    autoRefreshEnabled: (StoredPlaylist) -> Boolean,
    onAutoRefreshChange: (StoredPlaylist, Boolean) -> Unit,
    captionsEnabled: Boolean,
    onCaptionsEnabledChange: (Boolean) -> Unit,
    stripCountryPrefixes: Boolean,
    onStripCountryPrefixesChange: (Boolean) -> Unit,
    posterSize: String,
    onPosterSizeChange: (String) -> Unit,
    showPosterTitles: Boolean,
    onShowPosterTitlesChange: (Boolean) -> Unit,
    autoPlayEnabled: Boolean,
    onAutoPlayEnabledChange: (Boolean) -> Unit,
    autoReconnectLiveEnabled: Boolean,
    onAutoReconnectLiveEnabledChange: (Boolean) -> Unit,
    vodPlaybackSpeed: Float,
    onVodPlaybackSpeedChange: (Float) -> Unit,
    vodAutoFailoverEnabled: Boolean,
    onVodAutoFailoverEnabledChange: (Boolean) -> Unit,
    xtreamStreamFormat: TvXtreamStreamFormat,
    onXtreamStreamFormatChange: (TvXtreamStreamFormat) -> Unit,
    showContinueWatching: Boolean,
    onShowContinueWatchingChange: (Boolean) -> Unit,
    showRecentSources: Boolean,
    onShowRecentSourcesChange: (Boolean) -> Unit,
    showLiveFavorites: Boolean,
    onShowLiveFavoritesChange: (Boolean) -> Unit,
    showRecentlyWatchedLive: Boolean,
    onShowRecentlyWatchedLiveChange: (Boolean) -> Unit,
    showFavoriteMoviesAndSeries: Boolean,
    onShowFavoriteMoviesAndSeriesChange: (Boolean) -> Unit,
    showTmdbTrending: Boolean,
    onShowTmdbTrendingChange: (Boolean) -> Unit,
    showTmdbRecommendations: Boolean,
    onShowTmdbRecommendationsChange: (Boolean) -> Unit,
    showXtreamRecentlyAdded: Boolean,
    onShowXtreamRecentlyAddedChange: (Boolean) -> Unit,
    epgViewMode: String,
    onEpgViewModeChange: (String) -> Unit,
    epgOffsetMinutes: Int,
    onEpgOffsetMinutesChange: (Int) -> Unit,
    preferUploadedEpgOverXtream: Boolean,
    onPreferUploadedEpgOverXtreamChange: (Boolean) -> Unit,
    m3uVodDetailsEnabled: Boolean,
    onM3uVodDetailsEnabledChange: (Boolean) -> Unit,
    tmdbCacheEntries: Int,
    tmdbCacheMessage: String?,
    onClearTmdbCache: () -> Unit,
    epgSourceStates: Map<String, List<TvEpgSourceState>>,
    onUpdateEpgUrls: (StoredPlaylist, List<String>) -> Unit,
    onToggleEpgSource: (StoredPlaylist, String, Boolean) -> Unit,
    onPickEpgFile: (StoredPlaylist) -> Unit,
    backupMessage: String?,
    backupBusy: Boolean,
    onExportBackup: () -> Unit,
    onImportBackup: () -> Unit,
    initialFocusRequester: FocusRequester? = null,
    onResetPreferences: () -> Unit,
) {
    var tmdbApiKey by remember { mutableStateOf(credentialVault.loadTmdbApiKey().orEmpty()) }
    var selected by remember { mutableStateOf("General") }
    val categories = listOf("General", "Fuentes IPTV", "Reproducción", "EPG", "Dashboard", "Mando", "Metadata", "Backup", "Restablecer", "Acerca de")
    val categoryFocusRequesters = remember(initialFocusRequester) {
        List(categories.size) { index ->
            if (index == 0 && initialFocusRequester != null) initialFocusRequester else FocusRequester()
        }
    }
    val contentFocusRequester = remember { FocusRequester() }
    val settingsContentScrollState = rememberScrollState()
    fun selectSettingsCategory(index: Int) {
        selected = categories[index]
        categoryFocusRequesters[index].requestFocus()
    }
    LaunchedEffect(Unit) {
        delay(300)
        categoryFocusRequesters.first().requestFocus()
    }
    Row(modifier = Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
        Column(
            modifier = Modifier.width(190.dp).fillMaxSize().verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            TvScreenTitle("Ajustes", modifier = Modifier.padding(bottom = 10.dp))
            categories.forEachIndexed { index, category ->
                TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                    onClick = { selectSettingsCategory(index) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(38.dp)
                        .focusRequester(categoryFocusRequesters[index])
                        .focusProperties {
                            if (index > 0) up = categoryFocusRequesters[index - 1]
                            if (index < categoryFocusRequesters.lastIndex) down = categoryFocusRequesters[index + 1]
                        }
                        .onPreviewKeyEvent { event ->
                            if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                            when (event.nativeKeyEvent.keyCode) {
                                KeyEvent.KEYCODE_DPAD_RIGHT -> {
                                    val hasTarget = when (selected) {
                                        "Acerca de" -> false
                                        "Fuentes IPTV" -> playlists.isNotEmpty()
                                        else -> true
                                    }
                                    if (hasTarget) contentFocusRequester.requestFocus()
                                    hasTarget
                                }
                                KeyEvent.KEYCODE_DPAD_UP -> if (index > 0) {
                                    categoryFocusRequesters[index - 1].requestFocus()
                                    true
                                } else false
                                KeyEvent.KEYCODE_DPAD_DOWN -> if (index < categoryFocusRequesters.lastIndex) {
                                    categoryFocusRequesters[index + 1].requestFocus()
                                    true
                                } else false
                                else -> false
                            }
                        }
                        .tvDpadClick { selectSettingsCategory(index) },
                    colors = androidx.tv.material3.CardDefaults.colors(
                        containerColor = if (selected == category) tvColor(Color(0xFF304A75)) else Color.Transparent,
                        focusedContainerColor = tvColor(Color(0xFF536A9F)),
                    ),
                ) {
                    Row(modifier = Modifier.fillMaxSize().padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier
                                .width(24.dp)
                                .height(24.dp)
                                .background(
                                    if (selected == category) tvTone(TvTone.Accent) else tvTone(TvTone.SurfaceTop),
                                    RoundedCornerShape(7.dp),
                                ),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                category.take(1),
                                color = if (selected == category) tvTone(TvTone.AccentInk) else tvTone(TvTone.TextSoft),
                                fontFamily = TvType.Display,
                                fontSize = 12.sp,
                                lineHeight = 13.sp,
                            )
                        }
                        Text(category, color = TvText, fontSize = 13.sp, modifier = Modifier.padding(start = 10.dp))
                    }
                }
            }
        }
        Column(
            modifier = Modifier
                .fillMaxSize()
                .imePadding()
                .verticalScroll(settingsContentScrollState)
                // Spatial navigation otherwise chooses whichever category is
                // horizontally closest to the focused row, often the last
                // visible one. Always return to the active category.
                .focusProperties {
                    left = categoryFocusRequesters[categories.indexOf(selected).coerceAtLeast(0)]
                },
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(selected, color = TvText, fontFamily = TvType.Display, fontSize = 24.sp)
            Text(settingsDescription(selected), color = TvMuted, fontSize = 10.sp)
            when (selected) {
                "General" -> SettingsGeneral(showDashboard, onShowDashboardChange, startupSection, onStartupSectionChange, captionsEnabled, onCaptionsEnabledChange, stripCountryPrefixes, onStripCountryPrefixesChange, posterSize, onPosterSizeChange, showPosterTitles, onShowPosterTitlesChange, themeMode, onThemeModeChange, contentFocusRequester)
                "Fuentes IPTV" -> SettingsSources(
                    playlists,
                    busyPlaylistId,
                    statusMessage,
                    onRefresh,
                    onRequestDelete,
                    autoRefreshEnabled,
                    onAutoRefreshChange,
                    contentFocusRequester,
                )
                "Reproducción" -> SettingsPlayback(
                    autoPlayEnabled,
                    onAutoPlayEnabledChange,
                    autoReconnectLiveEnabled,
                    onAutoReconnectLiveEnabledChange,
                    vodPlaybackSpeed,
                    onVodPlaybackSpeedChange,
                    vodAutoFailoverEnabled,
                    onVodAutoFailoverEnabledChange,
                    xtreamStreamFormat,
                    onXtreamStreamFormatChange,
                    contentFocusRequester,
                )
                "EPG" -> SettingsEpg(playlists, epgSourceStates, epgViewMode, onEpgViewModeChange, epgOffsetMinutes, onEpgOffsetMinutesChange, preferUploadedEpgOverXtream, onPreferUploadedEpgOverXtreamChange, onUpdateEpgUrls, onToggleEpgSource, onPickEpgFile, settingsContentScrollState, contentFocusRequester)
                "Dashboard" -> SettingsDashboard(
                    showContinueWatching,
                    onShowContinueWatchingChange,
                    showRecentSources,
                    onShowRecentSourcesChange,
                    showLiveFavorites,
                    onShowLiveFavoritesChange,
                    showRecentlyWatchedLive,
                    onShowRecentlyWatchedLiveChange,
                    showFavoriteMoviesAndSeries,
                    onShowFavoriteMoviesAndSeriesChange,
                    showTmdbTrending,
                    onShowTmdbTrendingChange,
                    showTmdbRecommendations,
                    onShowTmdbRecommendationsChange,
                    showXtreamRecentlyAdded,
                    onShowXtreamRecentlyAddedChange,
                    contentFocusRequester,
                )
                "Mando" -> SettingsRemote(contentFocusRequester)
                "Metadata" -> SettingsMetadata(
                    value = tmdbApiKey,
                    onValueChange = { tmdbApiKey = it },
                    m3uVodDetailsEnabled = m3uVodDetailsEnabled,
                    onM3uVodDetailsEnabledChange = onM3uVodDetailsEnabledChange,
                    cacheEntries = tmdbCacheEntries,
                    cacheMessage = tmdbCacheMessage,
                    onClearCache = onClearTmdbCache,
                    firstFocusRequester = contentFocusRequester,
                ) {
                    credentialVault.saveTmdbApiKey(tmdbApiKey.trim())
                }
                "Backup" -> SettingsBackup(backupMessage, backupBusy, onExportBackup, onImportBackup, contentFocusRequester)
                "Restablecer" -> SettingsReset(onResetPreferences, contentFocusRequester)
                "Acerca de" -> Text("IPTVnator para Google TV · cliente IPTV basado en M3U, Xtream Codes y Stalker.", color = TvMuted, fontSize = 16.sp)
            }
        }
    }
}

@Composable
private fun SettingsReset(onResetPreferences: () -> Unit, firstFocusRequester: FocusRequester? = null) {
    var confirm by remember { mutableStateOf(false) }
    Text(
        "Restablece las preferencias de la app para TV (vista inicial, subtítulos y panel de Inicio). Tus playlists, credenciales, favoritos e historial no se borran.",
        color = TvMuted,
        fontSize = 15.sp,
    )
    TvButton(
        onClick = { confirm = true },
        modifier = Modifier
            .then(firstFocusRequester?.let { Modifier.focusRequester(it) } ?: Modifier)
            .tvDpadClick { confirm = true },
    ) { Text("Restablecer preferencias") }
    if (confirm) {
        TvAlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Restablecer preferencias") },
            text = { Text("¿Quieres volver a los valores iniciales? Las fuentes y sus datos se conservarán.") },
            confirmButton = {
                TvButton(
                    onClick = {
                        confirm = false
                        onResetPreferences()
                    },
                    modifier = Modifier.tvDpadClick {
                        confirm = false
                        onResetPreferences()
                    },
                ) { Text("Restablecer") }
            },
            dismissButton = {
                TvButton(onClick = { confirm = false }, modifier = Modifier.tvDpadClick { confirm = false }) {
                    Text("Cancelar")
                }
            },
        )
    }
}

@Composable
private fun SettingsBackup(
    message: String?,
    busy: Boolean,
    onExport: () -> Unit,
    onImport: () -> Unit,
    firstFocusRequester: FocusRequester? = null,
) {
    Text(
        "Exporta o restaura tus fuentes IPTV. El archivo incluye las credenciales necesarias para recuperar Xtream y Stalker; guárdalo en un lugar seguro.",
        color = TvMuted,
        fontSize = 15.sp,
    )
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        TvButton(
            onClick = onExport,
            modifier = Modifier
                .then(firstFocusRequester?.let { Modifier.focusRequester(it) } ?: Modifier)
                .tvDpadClick(onExport),
            enabled = !busy,
        ) {
            Text(if (busy) "Procesando…" else "Exportar backup")
        }
        TvButton(onClick = onImport, modifier = Modifier.tvDpadClick(onImport), enabled = !busy) {
            Text("Restaurar backup")
        }
    }
    message?.let { Text(it, color = TvText, fontSize = 14.sp) }
}

private fun settingsIcon(category: String): String = when (category) {
    "General" -> "☷"
    "Reproducción" -> "▶"
    "EPG" -> "▦"
    "Dashboard" -> "▥"
    "Mando" -> "▯"
    "Metadata" -> "▣"
    "Backup" -> "☁"
    "Restablecer" -> "↺"
    else -> "ⓘ"
}

private fun settingsDescription(category: String): String = when (category) {
    "General" -> "Configura el aspecto y el comportamiento inicial de la aplicación."
    "Fuentes IPTV" -> "Gestiona tus playlists M3U, Xtream Codes y Stalker."
    "Reproducción" -> "Opciones del reproductor y del comportamiento al cambiar de canal."
    "EPG" -> "Guía de programación y recuperación de datos XMLTV."
    "Dashboard" -> "Personaliza el contenido mostrado en Inicio."
    "Mando" -> "Navegación con cruceta, selección y controles con foco visible."
    "Metadata" -> "Configura el enriquecimiento opcional de películas y series."
    else -> "Información y mantenimiento de IPTVnator para Google TV."
}

private fun normalizeTmdbTitle(value: String): String = value
    .lowercase(Locale.getDefault())
    .replace(Regex("\\s*\\(?\\b\\d{4}\\b\\)?$"), "")
    .replace(Regex("[^\\p{L}\\p{N}]"), "")

@Composable
private fun SettingsGeneral(
    showDashboard: Boolean,
    onShowDashboardChange: (Boolean) -> Unit,
    startupSection: TvSection,
    onStartupSectionChange: (TvSection) -> Unit,
    captionsEnabled: Boolean,
    onCaptionsEnabledChange: (Boolean) -> Unit,
    stripCountryPrefixes: Boolean,
    onStripCountryPrefixesChange: (Boolean) -> Unit,
    posterSize: String,
    onPosterSizeChange: (String) -> Unit,
    showPosterTitles: Boolean,
    onShowPosterTitlesChange: (Boolean) -> Unit,
    themeMode: TvVisualTheme,
    onThemeModeChange: (TvVisualTheme) -> Unit,
    firstFocusRequester: FocusRequester? = null,
) {
    SettingRow("Idioma", "Español", "Idioma de la aplicación")
    SettingThemeModeRow(
        selected = themeMode,
        onSelect = onThemeModeChange,
        firstFocusRequester = firstFocusRequester,
    )
    SettingPosterSizeRow(
        selectedSize = posterSize,
        onSelect = onPosterSizeChange,
    )
    SettingChoiceRow(
        title = "Títulos bajo las carátulas",
        value = if (showPosterTitles) "Mostrar" else "Ocultar",
        description = "Al ocultarlos, el título aparece al enfocar una tarjeta con el mando",
        onClick = { onShowPosterTitlesChange(!showPosterTitles) },
    )
    SettingChoiceRow(
        title = "Mostrar Dashboard",
        value = if (showDashboard) "Mostrar" else "Ocultar",
        description = "Muestra Inicio en la navegación; al ocultarlo la app comienza en Fuentes",
        onClick = { onShowDashboardChange(!showDashboard) },
    )
    val startupOptions = listOf(TvSection.Home, TvSection.Sources, TvSection.Live, TvSection.Guide)
    val nextStartup = startupOptions[(startupOptions.indexOf(startupSection).coerceAtLeast(0) + 1) % startupOptions.size]
    SettingChoiceRow(
        title = "Vista inicial",
        value = startupSection.label,
        description = "Pantalla que se abre al arrancar; pulsa OK para cambiarla",
        onClick = { onStartupSectionChange(nextStartup) },
    )
    SettingChoiceRow(
        title = "Subtítulos",
        value = if (captionsEnabled) "Activados" else "Desactivados",
        description = "Preferencia inicial del reproductor; pulsa OK para cambiarla",
        onClick = { onCaptionsEnabledChange(!captionsEnabled) },
    )
    SettingChoiceRow(
        title = "Prefijos de canal",
        value = if (stripCountryPrefixes) "Ocultos" else "Originales",
        description = "Quita etiquetas como ES | solo del nombre visible del canal",
        onClick = { onStripCountryPrefixesChange(!stripCountryPrefixes) },
    )
}

@Composable
private fun SettingsPlayback(
    autoPlayEnabled: Boolean,
    onAutoPlayEnabledChange: (Boolean) -> Unit,
    autoReconnectLiveEnabled: Boolean,
    onAutoReconnectLiveEnabledChange: (Boolean) -> Unit,
    vodPlaybackSpeed: Float,
    onVodPlaybackSpeedChange: (Float) -> Unit,
    vodAutoFailoverEnabled: Boolean,
    onVodAutoFailoverEnabledChange: (Boolean) -> Unit,
    xtreamStreamFormat: TvXtreamStreamFormat,
    onXtreamStreamFormatChange: (TvXtreamStreamFormat) -> Unit,
    firstFocusRequester: FocusRequester? = null,
) {
    SettingChoiceRow(
        title = "Reproducción automática",
        value = if (autoPlayEnabled) "Activada" else "Desactivada",
        description = "Inicia el contenido al abrirlo; pulsa OK para cambiarlo",
        onClick = { onAutoPlayEnabledChange(!autoPlayEnabled) },
        firstFocusRequester = firstFocusRequester,
    )
    SettingChoiceRow(
        title = "Reconexión automática de directos",
        value = if (autoReconnectLiveEnabled) "Activada" else "Desactivada",
        description = "Reintenta hasta 6 veces si se corta una emisión ya iniciada; pulsa OK para cambiarlo",
        onClick = { onAutoReconnectLiveEnabledChange(!autoReconnectLiveEnabled) },
    )
    SettingChoiceRow(
        title = "Failover VOD Xtream",
        value = if (vodAutoFailoverEnabled) "Activado" else "Desactivado",
        description = "Prueba otra copia del mismo VOD si falla; pulsa OK para cambiarlo",
        onClick = { onVodAutoFailoverEnabledChange(!vodAutoFailoverEnabled) },
    )
    val speedOptions = listOf(0.75f, 1f, 1.25f, 1.5f, 2f)
    val nextSpeed = speedOptions[(speedOptions.indexOf(vodPlaybackSpeed).coerceAtLeast(0) + 1) % speedOptions.size]
    SettingChoiceRow(
        title = "Velocidad VOD",
        value = "${speedLabel(vodPlaybackSpeed)}×",
        description = "Velocidad inicial para películas y episodios; pulsa OK para alternar",
        onClick = { onVodPlaybackSpeedChange(nextSpeed) },
    )
    val nextStreamFormat = when (xtreamStreamFormat) {
        TvXtreamStreamFormat.AUTO -> TvXtreamStreamFormat.M3U8
        TvXtreamStreamFormat.M3U8 -> TvXtreamStreamFormat.TS
        TvXtreamStreamFormat.TS -> TvXtreamStreamFormat.AUTO
    }
    SettingChoiceRow(
        title = "Formato Xtream",
        value = when (xtreamStreamFormat) {
            TvXtreamStreamFormat.AUTO -> "Automático"
            TvXtreamStreamFormat.M3U8 -> "m3u8"
            TvXtreamStreamFormat.TS -> "ts"
        },
        description = "Formato para TV en directo Xtream; pulsa OK para alternar",
        onClick = { onXtreamStreamFormatChange(nextStreamFormat) },
    )
    SettingRow("Posición de reproducción", "Guardar", "Recupera el punto de películas y episodios")
    SettingRow("Buffer", "Automático", "Gestionado por Media3 según la conexión")
}

private fun speedLabel(speed: Float): String = when (speed) {
    0.75f -> "0,75"
    1.25f -> "1,25"
    1.5f -> "1,5"
    else -> speed.toString().removeSuffix(".0")
}

@Composable
private fun SettingsEpg(
    playlists: List<StoredPlaylist>,
    epgSourceStates: Map<String, List<TvEpgSourceState>>,
    viewMode: String,
    onViewModeChange: (String) -> Unit,
    epgOffsetMinutes: Int,
    onEpgOffsetMinutesChange: (Int) -> Unit,
    preferUploadedEpgOverXtream: Boolean,
    onPreferUploadedEpgOverXtreamChange: (Boolean) -> Unit,
    onUpdateEpgUrls: (StoredPlaylist, List<String>) -> Unit,
    onToggleEpgSource: (StoredPlaylist, String, Boolean) -> Unit,
    onPickEpgFile: (StoredPlaylist) -> Unit,
    contentScrollState: ScrollState,
    firstFocusRequester: FocusRequester? = null,
) {
    var focusedEpgPlaylistId by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(focusedEpgPlaylistId) {
        if (focusedEpgPlaylistId != null) {
            // The Google TV IME can be a separate window with no reliable inset.
            // Add the same explicit tail room as the import form and scroll
            // after the keyboard has had time to appear.
            delay(120)
            contentScrollState.animateScrollTo(contentScrollState.maxValue)
        }
    }
    SettingRow("Ventana de guía", "Actual y anteriores", "Incluye catch-up cuando la fuente lo permite")
    SettingChoiceRow(
        title = "Vista de guía",
        value = if (viewMode == "list") "Lista" else "Línea temporal",
        description = "Cambia cómo se muestran los programas en Guía TV; pulsa OK para alternar",
        onClick = { onViewModeChange(if (viewMode == "list") "timeline" else "list") },
        firstFocusRequester = firstFocusRequester,
    )
    SettingChoiceRow(
        title = "Preferir XMLTV manual",
        value = if (preferUploadedEpgOverXtream) "Activado" else "Desactivado",
        description = "En Xtream usa primero las fuentes XMLTV configuradas; si están vacías, vuelve al EPG del proveedor",
        onClick = { onPreferUploadedEpgOverXtreamChange(!preferUploadedEpgOverXtream) },
    )
    val offsetOptions = listOf(-720, -360, -120, -60, -30, 0, 30, 60, 120, 360, 720)
    val nextOffset = offsetOptions[(offsetOptions.indexOf(epgOffsetMinutes).coerceAtLeast(0) + 1) % offsetOptions.size]
    SettingChoiceRow(
        title = "Desfase horario EPG",
        value = if (epgOffsetMinutes == 0) "0 min" else "${if (epgOffsetMinutes > 0) "+" else ""}$epgOffsetMinutes min",
        description = "Corrige la hora mostrada sin modificar los datos ni las URLs de catch-up; pulsa OK para alternar",
        onClick = { onEpgOffsetMinutesChange(nextOffset) },
    )
    Text("Fuentes XMLTV", color = TvText, fontSize = 16.sp)
    if (playlists.isEmpty()) {
        Text("Añade una playlist para configurar su EPG.", color = TvMuted, fontSize = 14.sp)
    } else {
        playlists.forEach { playlist ->
            val sourceStates = epgSourceStates[playlist.id].takeIf { !it.isNullOrEmpty() }
                ?: playlist.epgUrls.map { TvEpgSourceState(it, true) }
            var urls by remember(playlist.id, sourceStates) { mutableStateOf(sourceStates.joinToString("\n") { it.url }) }
            val epgUrlsBringIntoViewRequester = remember(playlist.id) { BringIntoViewRequester() }
            var epgUrlsFocused by remember(playlist.id) { mutableStateOf(false) }
            LaunchedEffect(epgUrlsFocused) {
                if (epgUrlsFocused) epgUrlsBringIntoViewRequester.bringIntoView()
            }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(playlist.name, color = TvText, fontSize = 14.sp)
                TvOutlinedTextField(
                    value = urls,
                    onValueChange = { urls = it },
                    label = { Text("URLs XMLTV (una por línea, opcional)") },
                    minLines = 2,
                    maxLines = 4,
                    modifier = Modifier
                        .fillMaxWidth()
                        .bringIntoViewRequester(epgUrlsBringIntoViewRequester)
                        .onFocusChanged {
                            epgUrlsFocused = it.isFocused
                            if (it.isFocused) focusedEpgPlaylistId = playlist.id
                            else if (focusedEpgPlaylistId == playlist.id) focusedEpgPlaylistId = null
                        },
                )
                sourceStates.forEach { source ->
                    TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                        onClick = { onToggleEpgSource(playlist, source.url, !source.enabled) },
                        modifier = Modifier.fillMaxWidth().height(38.dp).tvDpadClick {
                            onToggleEpgSource(playlist, source.url, !source.enabled)
                        },
                        colors = androidx.tv.material3.CardDefaults.colors(
                            containerColor = if (source.enabled) tvColor(Color(0xFF202B3E)) else tvColor(Color(0xFF20232B)),
                            focusedContainerColor = tvColor(Color(0xFF536A9F)),
                        ),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxSize().padding(horizontal = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(if (source.enabled) "✓" else "○", color = if (source.enabled) tvColor(Color(0xFF83B5FF)) else TvMuted, fontSize = 14.sp)
                            Text(
                                "  ${if (source.enabled) "Activa" else "Desactivada"} · ${source.url}",
                                color = if (source.enabled) TvText else TvMuted,
                                fontSize = 11.sp,
                                maxLines = 1,
                            )
                        }
                    }
                }
                TvButton(
                    onClick = { onUpdateEpgUrls(playlist, urls.lines()) },
                    modifier = Modifier.tvDpadClick { onUpdateEpgUrls(playlist, urls.lines()) },
                ) { Text("Guardar fuentes EPG") }
                TvButton(
                    onClick = { onPickEpgFile(playlist) },
                    modifier = Modifier.tvDpadClick { onPickEpgFile(playlist) },
                ) { Text("Añadir archivo XMLTV") }
            }
        }
    }
    if (focusedEpgPlaylistId != null) Spacer(modifier = Modifier.height(360.dp))
}

@Composable
private fun SettingsDashboard(
    showContinueWatching: Boolean,
    onShowContinueWatchingChange: (Boolean) -> Unit,
    showRecentSources: Boolean,
    onShowRecentSourcesChange: (Boolean) -> Unit,
    showLiveFavorites: Boolean,
    onShowLiveFavoritesChange: (Boolean) -> Unit,
    showRecentlyWatchedLive: Boolean,
    onShowRecentlyWatchedLiveChange: (Boolean) -> Unit,
    showFavoriteMoviesAndSeries: Boolean,
    onShowFavoriteMoviesAndSeriesChange: (Boolean) -> Unit,
    showTmdbTrending: Boolean,
    onShowTmdbTrendingChange: (Boolean) -> Unit,
    showTmdbRecommendations: Boolean,
    onShowTmdbRecommendationsChange: (Boolean) -> Unit,
    showXtreamRecentlyAdded: Boolean,
    onShowXtreamRecentlyAddedChange: (Boolean) -> Unit,
    firstFocusRequester: FocusRequester? = null,
) {
    SettingChoiceRow(
        "Continuar viendo",
        if (showContinueWatching) "Mostrar" else "Ocultar",
        "Muestra el último contenido reproducido en Inicio; pulsa OK para cambiarlo",
        onClick = { onShowContinueWatchingChange(!showContinueWatching) },
        firstFocusRequester = firstFocusRequester,
    )
    SettingChoiceRow(
        "Fuentes utilizadas",
        if (showRecentSources) "Mostrar" else "Ocultar",
        "Acceso rápido a tus playlists en Inicio; pulsa OK para cambiarlo",
        onClick = { onShowRecentSourcesChange(!showRecentSources) },
    )
    SettingChoiceRow(
        "Canales favoritos",
        if (showLiveFavorites) "Mostrar" else "Ocultar",
        "Rail de canales en directo marcados como favoritos; pulsa OK para cambiarlo",
        onClick = { onShowLiveFavoritesChange(!showLiveFavorites) },
    )
    SettingChoiceRow(
        "TV visto recientemente",
        if (showRecentlyWatchedLive) "Mostrar" else "Ocultar",
        "Rail de canales en directo reproducidos recientemente; pulsa OK para cambiarlo",
        onClick = { onShowRecentlyWatchedLiveChange(!showRecentlyWatchedLive) },
    )
    SettingChoiceRow(
        "Películas y series favoritas",
        if (showFavoriteMoviesAndSeries) "Mostrar" else "Ocultar",
        "Rail de contenido VOD marcado como favorito; pulsa OK para cambiarlo",
        onClick = { onShowFavoriteMoviesAndSeriesChange(!showFavoriteMoviesAndSeries) },
    )
    SettingChoiceRow(
        "Tendencias TMDB",
        if (showTmdbTrending) "Mostrar" else "Ocultar",
        "Títulos de tendencia que también existen en tus catálogos IPTV; requiere una clave TMDB",
        onClick = { onShowTmdbTrendingChange(!showTmdbTrending) },
    )
    SettingChoiceRow(
        "Recomendaciones TMDB",
        if (showTmdbRecommendations) "Mostrar" else "Ocultar",
        "Recomendaciones basadas en películas y series vistas; requiere una clave TMDB",
        onClick = { onShowTmdbRecommendationsChange(!showTmdbRecommendations) },
    )
    SettingChoiceRow(
        "Añadido recientemente",
        if (showXtreamRecentlyAdded) "Mostrar" else "Ocultar",
        "Rail de películas y series incorporadas recientemente en Xtream",
        onClick = { onShowXtreamRecentlyAddedChange(!showXtreamRecentlyAdded) },
    )
}

@Composable
private fun SettingsRemote(firstFocusRequester: FocusRequester? = null) {
    SettingChoiceRow(
        "Navegación",
        "Cruceta y OK",
        "Todas las acciones importantes tienen foco TV",
        onClick = {},
        firstFocusRequester = firstFocusRequester,
    )
    SettingRow("Favoritos", "Estrella con foco", "Selecciona la estrella del canal y pulsa OK")
    SettingRow("Reproducción", "OK / Play-Pause", "Pausa o reanuda el contenido actual")
    SettingRow("Buscar en VOD", "← / → · 5 s", "Avanza o retrocede cinco segundos en películas y episodios")
    SettingRow("Volumen", "↑ / ↓ · Mute", "Ajusta o silencia el volumen del reproductor")
    SettingRow("Cambiar canal", "CH / Page · 0–9", "Sube, baja o selecciona directamente un canal en directo")
}

@Composable
private fun SettingsMetadata(
    value: String,
    onValueChange: (String) -> Unit,
    m3uVodDetailsEnabled: Boolean,
    onM3uVodDetailsEnabledChange: (Boolean) -> Unit,
    cacheEntries: Int,
    cacheMessage: String?,
    onClearCache: () -> Unit,
    firstFocusRequester: FocusRequester? = null,
    onSave: () -> Unit,
) {
    val tmdbKeyBringIntoView = remember { BringIntoViewRequester() }
    val settingsScope = rememberCoroutineScope()
    Text("La clave se guarda cifrada en Android Keystore y habilita el enriquecimiento de películas y series.", color = TvMuted, fontSize = 14.sp)
    TvOutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text("TMDB API key") },
        visualTransformation = PasswordVisualTransformation(),
        modifier = (firstFocusRequester?.let { Modifier.focusRequester(it) } ?: Modifier)
            .bringIntoViewRequester(tmdbKeyBringIntoView)
            .onFocusChanged { state ->
                if (state.isFocused) {
                    settingsScope.launch {
                        delay(120)
                        tmdbKeyBringIntoView.bringIntoView()
                    }
                }
            },
    )
    TvButton(onClick = onSave, modifier = Modifier.tvDpadClick(onSave), enabled = value.isNotBlank()) { Text("Guardar clave TMDB") }
    SettingChoiceRow(
        title = "Reconocer películas M3U",
        value = if (m3uVodDetailsEnabled) "Activado" else "Desactivado",
        description = "Abre entradas que parecen archivos de película en el detalle VOD en vez del panel de directo",
        onClick = { onM3uVodDetailsEnabledChange(!m3uVodDetailsEnabled) },
    )
    SettingRow(
        title = "Caché TMDB",
        value = "$cacheEntries entradas",
        description = "Metadatos guardados localmente para abrir antes los detalles",
    )
    TvButton(
        onClick = onClearCache,
        modifier = Modifier.tvDpadClick(onClearCache),
        enabled = cacheEntries > 0,
    ) { Text("Vaciar caché TMDB") }
    cacheMessage?.let { Text(it, color = TvMuted, fontSize = 14.sp) }
}

@Composable
private fun SettingsSources(
    playlists: List<StoredPlaylist>,
    busyPlaylistId: String?,
    statusMessage: String?,
    onRefresh: (StoredPlaylist) -> Unit,
    onRequestDelete: (StoredPlaylist) -> Unit,
    autoRefreshEnabled: (StoredPlaylist) -> Boolean,
    onAutoRefreshChange: (StoredPlaylist, Boolean) -> Unit,
    firstFocusRequester: FocusRequester? = null,
) {
    statusMessage?.let { Text(it, color = TvMuted, fontSize = 14.sp) }
    if (playlists.isEmpty()) {
        Text("No hay fuentes guardadas.", color = TvMuted, fontSize = 16.sp)
    } else {
        playlists.forEachIndexed { index, playlist ->
            var autoRefresh by remember(playlist.id) { mutableStateOf(autoRefreshEnabled(playlist)) }
                            SettingRow(playlist.name, playlist.sourceUrl ?: "Archivo local", "${playlistChannelCount(playlist)} canales")
            if (playlistHasRefreshableSource(playlist)) {
                SettingChoiceRow(
                    title = "Actualizar al arrancar",
                    value = if (autoRefresh) "Activado" else "Desactivado",
                    description = if (isLocalPlaylistFile(playlist.sourceUrl))
                        "Vuelve a leer el archivo M3U al iniciar la app; desactivado conserva el catálogo importado"
                    else
                        "Vuelve a consultar esta fuente remota al iniciar la app; desactivado conserva el catálogo local",
                    onClick = {
                        autoRefresh = !autoRefresh
                        onAutoRefreshChange(playlist, autoRefresh)
                    },
                    firstFocusRequester = firstFocusRequester.takeIf { index == 0 },
                )
            } else {
                SettingRow("Actualizar al arrancar", "No aplica", "Esta lista no conserva una URL ni un archivo que pueda releerse")
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                TvButton(
                    onClick = { onRefresh(playlist) },
                    modifier = Modifier.tvDpadClick { onRefresh(playlist) },
                    enabled = playlistHasRefreshableSource(playlist) && busyPlaylistId == null,
                ) {
                    Text(if (busyPlaylistId == playlist.id) "Actualizando…" else "Actualizar")
                }
                TvButton(
                    onClick = { onRequestDelete(playlist) },
                    modifier = Modifier
                        .then(firstFocusRequester?.takeIf { index == 0 && playlist.sourceUrl == null }?.let { Modifier.focusRequester(it) } ?: Modifier)
                        .tvDpadClick { onRequestDelete(playlist) },
                ) { Text("Eliminar") }
            }
        }
    }
}

@Composable
private fun SettingRow(title: String, value: String, description: String) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(title, color = TvText, fontSize = 13.sp)
                Text(description, color = TvMuted, fontSize = 10.sp)
            }
            Text(value, color = tvColor(Color(0xFF9CC1FF)), fontFamily = TvType.BodyMedium, fontSize = 12.sp)
        }
        Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(tvColor(Color(0xFF2B3039))).padding(top = 12.dp))
    }
}

@Composable
private fun SettingChoiceRow(
    title: String,
    value: String,
    description: String,
    onClick: () -> Unit,
    firstFocusRequester: FocusRequester? = null,
) {
    TvCard(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .then(firstFocusRequester?.let { Modifier.focusRequester(it) } ?: Modifier)
            .tvDpadClick(onClick),
        colors = androidx.tv.material3.CardDefaults.colors(
            containerColor = Color.Transparent,
            focusedContainerColor = tvColor(Color(0xFF202936)),
        ),
    ) {
        SettingRow(title, value, description)
    }
}

@Composable
private fun SettingThemeModeRow(
    selected: TvVisualTheme,
    onSelect: (TvVisualTheme) -> Unit,
    firstFocusRequester: FocusRequester? = null,
) {
    val options = remember { TvVisualTheme.entries.toList() }
    val focusRequesters = remember(options) { List(options.size) { FocusRequester() } }
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text("Tema visual", color = TvText, fontSize = 13.sp)
                Text("Cambia entre claro, oscuro y el tema del sistema", color = TvMuted, fontSize = 10.sp)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                options.forEachIndexed { index, option ->
                    TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                        onClick = { onSelect(option) },
                        modifier = Modifier
                            .width(84.dp)
                            .height(32.dp)
                            .focusRequester(if (index == 0 && firstFocusRequester != null) firstFocusRequester else focusRequesters[index])
                            .focusProperties {
                                if (index > 0) left = focusRequesters[index - 1]
                                if (index < focusRequesters.lastIndex) right = focusRequesters[index + 1]
                            }
                            .onPreviewKeyEvent { event ->
                                if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                                when (event.nativeKeyEvent.keyCode) {
                                    KeyEvent.KEYCODE_DPAD_LEFT -> if (index > 0) {
                                        focusRequesters[index - 1].requestFocus()
                                        true
                                    } else false
                                    KeyEvent.KEYCODE_DPAD_RIGHT -> if (index < focusRequesters.lastIndex) {
                                        focusRequesters[index + 1].requestFocus()
                                        true
                                    } else false
                                    else -> false
                                }
                            }
                            .tvDpadClick { onSelect(option) },
                        colors = androidx.tv.material3.CardDefaults.colors(
                            containerColor = if (option == selected) tvColor(Color(0xFF304A75)) else tvColor(Color(0xFF202532)),
                            focusedContainerColor = tvColor(Color(0xFF536A9F)),
                        ),
                    ) {
                        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text(option.label, color = TvText, fontSize = 11.sp, maxLines = 1)
                        }
                    }
                }
            }
        }
        Box(modifier = Modifier.fillMaxWidth().padding(top = 12.dp).height(1.dp).background(tvColor(Color(0xFF2B3039))))
    }
}

@Composable
internal fun SettingPosterSizeRow(
    selectedSize: String,
    onSelect: (String) -> Unit,
    firstFocusRequester: FocusRequester? = null,
) {
    val options = remember {
        listOf("small" to "Pequeñas", "medium" to "Medianas", "large" to "Grandes")
    }
    val focusRequesters = remember { List(options.size) { FocusRequester() } }
    val normalizedSelection = selectedSize.takeIf { value -> options.any { it.first == value } } ?: "medium"
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text("Tamaño de carátulas", color = TvText, fontSize = 13.sp)
                Text(
                    "Ajusta el tamaño de las tarjetas de películas y series",
                    color = TvMuted,
                    fontSize = 12.sp,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                options.forEachIndexed { index, (value, label) ->
                    TvCard(
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                        onClick = { onSelect(value) },
                        modifier = Modifier
                            .width(94.dp)
                            .height(32.dp)
                            .focusRequester(
                                if (index == 0 && firstFocusRequester != null) firstFocusRequester
                                else focusRequesters[index],
                            )
                            .focusProperties {
                                if (index > 0) left = focusRequesters[index - 1]
                                if (index < focusRequesters.lastIndex) right = focusRequesters[index + 1]
                            }
                            .onPreviewKeyEvent { event ->
                                if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                                when (event.nativeKeyEvent.keyCode) {
                                    KeyEvent.KEYCODE_DPAD_LEFT -> if (index > 0) {
                                        focusRequesters[index - 1].requestFocus()
                                        true
                                    } else false
                                    KeyEvent.KEYCODE_DPAD_RIGHT -> if (index < focusRequesters.lastIndex) {
                                        focusRequesters[index + 1].requestFocus()
                                        true
                                    } else false
                                    else -> false
                                }
                            }
                            .tvDpadClick { onSelect(value) },
                        colors = androidx.tv.material3.CardDefaults.colors(
                            containerColor = if (value == normalizedSelection) tvColor(Color(0xFF304A75)) else tvColor(Color(0xFF202532)),
                            focusedContainerColor = tvColor(Color(0xFF536A9F)),
                        ),
                    ) {
                        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text(label, color = TvText, fontSize = 11.sp, maxLines = 1)
                        }
                    }
                }
            }
        }
        Box(modifier = Modifier.fillMaxWidth().padding(top = 12.dp).height(1.dp).background(tvColor(Color(0xFF2B3039))))
    }
}

@Composable
private fun TvImportSourceGrid(
    selected: TvImportSourceOption,
    focusRequesters: Map<TvImportSourceOption, FocusRequester>,
    formFocusRequester: FocusRequester,
    onSourceFocus: () -> Unit,
    onSelect: (TvImportSourceOption) -> Unit,
) {
    val options = TvImportSourceOption.entries
    fun requesterAt(index: Int): FocusRequester = focusRequesters.getValue(options[index])

    LaunchedEffect(selected) {
        // Start on the active provider (especially when editing a source), and
        // retain that card's focus when selecting it swaps the form below.
        focusRequesters.getValue(selected).requestFocus()
    }

    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        options.chunked(3).forEachIndexed { rowIndex, row ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                row.forEachIndexed { columnIndex, option ->
                    val index = rowIndex * 3 + columnIndex
                    TvCard(
                        onClick = { onSelect(option) },
                            modifier = Modifier
                                .weight(1f)
                                // Concise descriptions keep this source chooser
                                // legible without pushing the form actions below
                                // the initial TV dialog viewport.
                                .height(58.dp)
                            .focusRequester(requesterAt(index))
                            .onFocusChanged { if (it.isFocused) onSourceFocus() }
                            .focusProperties {
                                if (columnIndex > 0) left = requesterAt(index - 1)
                                if (columnIndex < row.lastIndex) right = requesterAt(index + 1)
                                if (rowIndex > 0) up = requesterAt(index - 3)
                                // DOWN follows the grid (the card below) and only
                                // the bottom row enters the form, so reaching a
                                // second-row source never lands in a text field.
                                down = if (rowIndex < 1) requesterAt(index + 3) else formFocusRequester
                            }
                            .border(
                                if (selected == option) 1.5.dp else 1.dp,
                                if (selected == option) tvTone(TvTone.Accent) else tvTone(TvTone.SurfaceTop),
                                RoundedCornerShape(14.dp),
                            )
                            .tvDpadClick { onSelect(option) },
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(14.dp)),
                        scale = androidx.tv.material3.CardDefaults.scale(focusedScale = 1f),
                        colors = androidx.tv.material3.CardDefaults.colors(
                            containerColor = if (selected == option) tvTone(TvTone.Selected) else tvTone(TvTone.Surface),
                            focusedContainerColor = tvTone(TvTone.Focused),
                        ),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                modifier = Modifier
                                    .width(30.dp)
                                    .height(30.dp)
                                    .background(
                                        if (selected == option) tvTone(TvTone.Accent) else tvTone(TvTone.Accent).copy(alpha = 0.14f),
                                        RoundedCornerShape(10.dp),
                                    ),
                                contentAlignment = Alignment.Center,
                            ) {
                                TvImportOptionGlyph(
                                    option,
                                    if (selected == option) tvTone(TvTone.AccentInk) else tvTone(TvTone.Accent),
                                )
                            }
                            Column(Modifier.padding(start = 11.dp).weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text(option.title, color = tvTone(TvTone.Text), fontFamily = TvType.BodyMedium, fontSize = 11.sp, maxLines = 1)
                                Text(option.description, color = tvTone(TvTone.Muted), fontSize = 8.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Line glyphs for the add-source options, drawn to match the rail icons. */
@Composable
private fun TvImportOptionGlyph(option: TvImportSourceOption, color: Color) {
    Canvas(Modifier.width(18.dp).height(18.dp)) {
        val stroke = androidx.compose.ui.graphics.drawscope.Stroke(1.7.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)
        val w = size.width
        val h = size.height
        fun o(x: Float, y: Float) = androidx.compose.ui.geometry.Offset(w * x, h * y)
        when (option) {
            TvImportSourceOption.M3U_URL -> {
                drawRoundRect(color, o(0.08f, 0.38f), androidx.compose.ui.geometry.Size(w * 0.5f, h * 0.3f), CornerRadius(h * 0.15f), style = stroke)
                drawRoundRect(color, o(0.42f, 0.32f), androidx.compose.ui.geometry.Size(w * 0.5f, h * 0.3f), CornerRadius(h * 0.15f), style = stroke)
            }
            TvImportSourceOption.M3U_FILE -> {
                val p = Path().apply {
                    moveTo(w * 0.2f, h * 0.08f); lineTo(w * 0.6f, h * 0.08f); lineTo(w * 0.82f, h * 0.3f)
                    lineTo(w * 0.82f, h * 0.92f); lineTo(w * 0.2f, h * 0.92f); close()
                }
                drawPath(p, color, style = stroke)
                drawLine(color, o(0.34f, 0.55f), o(0.68f, 0.55f), stroke.width, StrokeCap.Round)
                drawLine(color, o(0.34f, 0.72f), o(0.6f, 0.72f), stroke.width, StrokeCap.Round)
            }
            TvImportSourceOption.XTREAM -> {
                drawCircle(color, w * 0.2f, o(0.32f, 0.5f), style = stroke)
                drawLine(color, o(0.52f, 0.5f), o(0.92f, 0.5f), stroke.width, StrokeCap.Round)
                drawLine(color, o(0.8f, 0.5f), o(0.8f, 0.7f), stroke.width, StrokeCap.Round)
                drawLine(color, o(0.66f, 0.5f), o(0.66f, 0.64f), stroke.width, StrokeCap.Round)
            }
            TvImportSourceOption.STALKER -> {
                drawCircle(color, w * 0.08f, o(0.5f, 0.42f))
                drawArc(color, 200f, 140f, false, o(0.22f, 0.14f), androidx.compose.ui.geometry.Size(w * 0.56f, h * 0.56f), style = stroke)
                drawArc(color, 200f, 140f, false, o(0.04f, -0.04f), androidx.compose.ui.geometry.Size(w * 0.92f, h * 0.92f), style = stroke)
                drawLine(color, o(0.5f, 0.5f), o(0.5f, 0.94f), stroke.width, StrokeCap.Round)
            }
            TvImportSourceOption.RAW_M3U -> listOf(0.25f, 0.5f, 0.75f).forEachIndexed { i, y ->
                drawLine(color, o(0.12f, y), o(if (i == 2) 0.6f else 0.88f, y), stroke.width, StrokeCap.Round)
            }
            else -> {
                val p = Path().apply {
                    moveTo(w * 0.5f, h * 0.06f); lineTo(w * 0.62f, h * 0.38f); lineTo(w * 0.94f, h * 0.5f)
                    lineTo(w * 0.62f, h * 0.62f); lineTo(w * 0.5f, h * 0.94f); lineTo(w * 0.38f, h * 0.62f)
                    lineTo(w * 0.06f, h * 0.5f); lineTo(w * 0.38f, h * 0.38f); close()
                }
                drawPath(p, color, style = stroke)
            }
        }
    }
}

@Composable
private fun TvRail(
    items: List<String>,
    onItemClick: (Int) -> Unit = {},
    onLongClick: (Int) -> Unit = {},
    initialFocusRequester: FocusRequester? = null,
    onItemDown: (Int) -> Boolean = { false },
    compact: Boolean = false,
    selectedIndex: Int = -1,
) {
    val railFocusRequesters = remember(items.size) { List(items.size) { FocusRequester() } }
    val navRail = LocalTvNavRailFocus.current
    androidx.compose.runtime.CompositionLocalProvider(LocalTvFocusRadius provides if (compact) 999.dp else 12.dp) {
    LazyRow(
        contentPadding = PaddingValues(vertical = if (compact) 6.dp else 10.dp, horizontal = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(if (compact) 8.dp else 16.dp),
    ) {
        itemsIndexed(items) { index, label ->
            val selected = index == selectedIndex
            TvCard(
                onClick = { onItemClick(index) },
                modifier = Modifier
                    .then(
                        if (compact) Modifier.height(36.dp).widthIn(min = 84.dp)
                        else Modifier.width(236.dp).height(96.dp),
                    )
                    .then(
                        if (index == 0 && initialFocusRequester != null) {
                            Modifier.focusRequester(initialFocusRequester)
                        } else {
                            Modifier
                        },
                    )
                    .focusRequester(railFocusRequesters[index])
                    .focusProperties {
                        if (index > 0) left = railFocusRequesters[index - 1]
                        else navRail?.let { left = it }
                        if (index < railFocusRequesters.lastIndex) right = railFocusRequesters[index + 1]
                    }
                    .tvDpadClick { onItemClick(index) }
                    .onKeyEvent { event ->
                        // TV remotes repeat KEYCODE_DPAD_CENTER while held;
                        // the first repeat is the long-press favourite action.
                        if (event.type == KeyEventType.KeyDown &&
                            event.nativeKeyEvent.keyCode == KeyEvent.KEYCODE_DPAD_CENTER &&
                            event.nativeKeyEvent.repeatCount >= 1
                        ) {
                            onLongClick(index)
                            true
                        } else if (event.type == KeyEventType.KeyDown &&
                            event.nativeKeyEvent.keyCode == KeyEvent.KEYCODE_DPAD_DOWN
                        ) {
                            onItemDown(index)
                        } else false
                    },
                shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(if (compact) 50 else 12)),
                scale = androidx.tv.material3.CardDefaults.scale(focusedScale = 1f),
                colors = androidx.tv.material3.CardDefaults.colors(
                    containerColor = when {
                        selected -> tvTone(TvTone.Accent)
                        compact -> tvTone(TvTone.Surface).copy(alpha = 0.9f)
                        else -> tvTone(TvTone.SurfaceHigh)
                    },
                    focusedContainerColor = if (selected) tvTone(TvTone.AccentSoft) else tvTone(TvTone.Focused),
                ),
            ) {
                if (compact) {
                    Box(Modifier.fillMaxHeight().padding(horizontal = 18.dp), contentAlignment = Alignment.Center) {
                        Text(
                            label,
                            color = if (selected) tvTone(TvTone.AccentInk) else tvTone(TvTone.TextSoft),
                            fontFamily = if (selected) TvType.BodyMedium else TvType.Body,
                            fontSize = 11.sp,
                            maxLines = 1,
                        )
                    }
                } else {
                    val parts = label.split(" · ", limit = 2)
                    Row(Modifier.fillMaxSize().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.width(3.dp).fillMaxHeight().background(tvTone(TvTone.Accent), RoundedCornerShape(2.dp)))
                        Column(Modifier.padding(start = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(parts[0], color = tvTone(TvTone.Text), fontFamily = TvType.BodyMedium, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            parts.getOrNull(1)?.let {
                                Text(it, color = tvTone(TvTone.Muted), fontSize = 9.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                }
            }
        }
    }
    }
}

/**
 * Favorites/history keep the original IPTVnator list semantics, but use a
 * poster/logo treatment that remains legible from a TV viewing distance.
 * The source app always shows the channel logo in its favorite list; using
 * the saved cover here also keeps the same visual identity in the TV rail.
 */
@Composable
internal fun TvSavedItemRail(
    items: List<TvSavedItem>,
    playlistNames: Map<String, String> = emptyMap(),
    onItemClick: (Int) -> Unit = {},
    onRemoveItem: ((Int) -> Unit)? = null,
    onMoveItem: ((Int, Int) -> Unit)? = null,
    onEditEpg: ((Int) -> Unit)? = null,
    initialFocusRequester: FocusRequester? = null,
    firstItemUpFocusRequester: FocusRequester? = null,
) {
    val requesters = remember(items.map { "${it.playlistId}:${it.itemType}:${it.itemKey}" }, initialFocusRequester) {
        items.indices.map { index ->
            if (index == 0 && initialFocusRequester != null) initialFocusRequester else FocusRequester()
        }
    }
    LazyRow(
        contentPadding = PaddingValues(vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        itemsIndexed(items, key = { _, item -> tvFavoriteOrderKey(item) }) { index, item ->
            var selectedActionIndex by remember(item.playlistId, item.itemType, item.itemKey) { mutableStateOf(0) }
            var rowFocused by remember(item.playlistId, item.itemType, item.itemKey) { mutableStateOf(false) }
            TvCard(
                onClick = { onItemClick(index) },
                modifier = Modifier
                    .width(if (onMoveItem == null) 220.dp else 246.dp)
                    .height(116.dp)
                    .onPreviewKeyEvent { event ->
                        if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                        val keyCode = event.nativeKeyEvent.keyCode
                        val moveActionOffset = if (onRemoveItem != null) 2 else 1
                        val epgActionIndex = (if (onRemoveItem != null) 1 else 0) +
                            (if (onMoveItem != null) 2 else 0) + 1
                        val lastActionIndex = epgActionIndex.takeIf { onEditEpg != null }
                            ?: (if (onRemoveItem != null) 1 else 0) + (if (onMoveItem != null) 2 else 0)
                        when {
                            keyCode == KeyEvent.KEYCODE_DPAD_RIGHT && selectedActionIndex < lastActionIndex -> {
                                selectedActionIndex += 1
                                true
                            }
                            keyCode == KeyEvent.KEYCODE_DPAD_LEFT && selectedActionIndex > 0 -> {
                                selectedActionIndex -= 1
                                true
                            }
                            selectedActionIndex > 0 &&
                                isInitialTvSelect(keyCode, event.nativeKeyEvent.repeatCount) -> {
                                when {
                                    onRemoveItem != null && selectedActionIndex == 1 -> onRemoveItem.invoke(index)
                                    onMoveItem != null && selectedActionIndex == moveActionOffset -> onMoveItem.invoke(index, -1)
                                    onMoveItem != null && selectedActionIndex == moveActionOffset + 1 -> onMoveItem.invoke(index, 1)
                                    onEditEpg != null && selectedActionIndex == epgActionIndex -> onEditEpg.invoke(index)
                                }
                                true
                            }
                            else -> false
                        }
                    }
                    .focusRequester(requesters[index])
                    .focusProperties {
                        if (index > 0) left = requesters[index - 1]
                        if (index < requesters.lastIndex) right = requesters[index + 1]
                        if (index == 0 && firstItemUpFocusRequester != null) up = firstItemUpFocusRequester
                    }
                    .tvDpadClick(
                        action = { onItemClick(index) },
                        onFocusChange = { focused ->
                            rowFocused = focused
                            if (focused) selectedActionIndex = 0
                        },
                    ),
                colors = androidx.tv.material3.CardDefaults.colors(
                    containerColor = tvColor(Color(0xFF1A1E27)),
                    focusedContainerColor = tvColor(Color(0xFF536A9F)),
                ),
            ) {
                Row(modifier = Modifier.fillMaxSize().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .width(68.dp)
                            .fillMaxHeight()
                            .clip(RoundedCornerShape(8.dp))
                            .background(tvColor(Color(0xFF29334B))),
                        contentAlignment = Alignment.Center,
                    ) {
                        item.coverUrl?.takeIf(String::isNotBlank)?.let { url ->
                            AsyncImage(
                                model = url,
                                contentDescription = item.title,
                                modifier = Modifier.fillMaxSize().padding(5.dp),
                                contentScale = if (item.itemType == com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL) {
                                    ContentScale.Fit
                                } else {
                                    ContentScale.Crop
                                },
                            )
                        } ?: Text(
                            if (item.itemType == com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL) "TV" else "▶",
                            color = tvColor(Color(0xFF6F91CE)),
                            fontSize = 16.sp,
                        )
                    }
                    Column(
                        modifier = Modifier.padding(start = 12.dp).weight(1f),
                        verticalArrangement = Arrangement.spacedBy(5.dp),
                    ) {
                        Text(item.title, color = TvText, fontSize = 15.sp, maxLines = 2, lineHeight = 17.sp)
                        Text(
                            "${item.itemType.name.lowercase(Locale.getDefault())} · ${playlistNames[item.playlistId] ?: "Fuente desconocida"}",
                            color = TvMuted,
                            fontSize = 10.sp,
                            maxLines = 1,
                        )
                    }
                    if (onRemoveItem != null || onMoveItem != null || onEditEpg != null) {
                        val actionSize = if (onEditEpg != null) 22.dp else 28.dp
                        Column(
                            verticalArrangement = Arrangement.spacedBy(if (onEditEpg != null) 0.dp else 2.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            val actions = buildList {
                                if (onRemoveItem != null) add(Triple(1, 1, "★"))
                                if (onMoveItem != null) {
                                    val offset = if (onRemoveItem != null) 2 else 1
                                    add(Triple(offset, 2, "↑"))
                                    add(Triple(offset + 1, 3, "↓"))
                                }
                                if (onEditEpg != null) {
                                    add(Triple((if (onRemoveItem != null) 1 else 0) + (if (onMoveItem != null) 2 else 0) + 1, 4, "EPG"))
                                }
                            }
                            actions.forEach { (actionIndex, actionType, symbol) ->
                                val enabled = when (actionType) {
                                    2 -> index > 0
                                    3 -> index < items.lastIndex
                                    else -> true
                                }
                                    Box(
                                        modifier = Modifier
                                            .size(actionSize)
                                            .clip(CircleShape)
                                            .background(
                                                if (rowFocused && selectedActionIndex == actionIndex) {
                                                    tvColor(Color(0xFF35496E))
                                                } else {
                                                    Color.Transparent
                                                },
                                            )
                                            .then(
                                                if (rowFocused && selectedActionIndex == actionIndex) {
                                                    Modifier.border(2.dp, tvColor(Color(0xFF9BC4FF)), CircleShape)
                                                } else {
                                                    Modifier
                                                },
                                            ),
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        Text(
                                            symbol,
                                        color = tvColor(
                                            when {
                                                !enabled -> Color(0xFF626B7A)
                                                actionIndex == 1 -> Color(0xFFFFD166)
                                                else -> Color(0xFFB9D4FF)
                                            },
                                        ),
                                        fontSize = if (actionType == 4) 7.sp else 16.sp,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TvImportScreen(
    initialValues: TvImportInitialValues?,
    initialSourceType: TvSourceType,
    maxDialogHeight: Dp,
    errorMessage: String?,
    importInProgress: Boolean,
    importStatus: String? = null,
    imeVisible: Boolean,
    onBack: () -> Unit,
    onPickLocalM3u: (String) -> Unit,
    onImportM3u: (TvPlaylistSource) -> Unit,
    onImportM3uText: (String, String) -> Unit,
    onImportAutoDetect: (String, String) -> Unit,
    onImportXtream: (XtreamCredentials, String) -> Unit,
    onImportStalker: (StalkerCredentials, String) -> Unit,
) {
    val importKeyboardController = LocalSoftwareKeyboardController.current
    var sourceType by remember(initialValues, initialSourceType) { mutableStateOf(initialValues?.sourceType ?: initialSourceType) }
    var selectedOption by remember(initialValues, initialSourceType) {
        mutableStateOf(
            when (initialSourceType) {
                TvSourceType.XTREAM -> TvImportSourceOption.XTREAM
                TvSourceType.STALKER -> TvImportSourceOption.STALKER
                TvSourceType.M3U -> TvImportSourceOption.M3U_URL
            },
        )
    }
    val showStalkerConnectionAction =
        selectedOption == TvImportSourceOption.STALKER && sourceType == TvSourceType.STALKER
    var url by remember(initialValues) { mutableStateOf(initialValues?.url.orEmpty()) }
    var rawText by remember(initialValues) { mutableStateOf("") }
    var autoDetectText by remember(initialValues) { mutableStateOf("") }
    var epgUrl by remember(initialValues) { mutableStateOf(initialValues?.epgUrl.orEmpty()) }
    var userAgent by remember(initialValues) { mutableStateOf(initialValues?.userAgent.orEmpty()) }
    var referrer by remember(initialValues) { mutableStateOf(initialValues?.sourceReferrer.orEmpty()) }
    var origin by remember(initialValues) { mutableStateOf(initialValues?.sourceOrigin.orEmpty()) }
    var showAdvancedM3uOptions by remember(initialValues) {
        mutableStateOf(
            !initialValues?.epgUrl.isNullOrBlank() ||
                !initialValues?.userAgent.isNullOrBlank() ||
                !initialValues?.sourceReferrer.isNullOrBlank() ||
                !initialValues?.sourceOrigin.isNullOrBlank(),
        )
    }
    // New imports follow the original dialog: the title starts empty and the
    // provider/URL becomes the fallback name. Editing restores the saved title.
    var name by remember(initialValues) { mutableStateOf(initialValues?.name.orEmpty()) }
    // Optional request headers and manual XMLTV configuration are available
    // for both add and edit, but stay collapsed on a fresh import to preserve
    // the compact two-field M3U dialog shown by IPTVnator.
    val exposeAdvancedM3uOptions = sourceType == TvSourceType.M3U &&
        selectedOption == TvImportSourceOption.M3U_URL
    val importTextButtonColors = androidx.compose.material3.ButtonDefaults.textButtonColors(
        contentColor = tvColor(Color(0xFF9DBEFF)),
    )
    var username by remember(initialValues) { mutableStateOf(initialValues?.username.orEmpty()) }
    var password by remember(initialValues) { mutableStateOf(initialValues?.password.orEmpty()) }
    var macAddress by remember(initialValues) { mutableStateOf(initialValues?.macAddress.orEmpty()) }
    var serialNumber by remember(initialValues) { mutableStateOf(initialValues?.serialNumber.orEmpty()) }
    var deviceId1 by remember(initialValues) { mutableStateOf(initialValues?.deviceId1.orEmpty()) }
    var deviceId2 by remember(initialValues) { mutableStateOf(initialValues?.deviceId2.orEmpty()) }
    var signature1 by remember(initialValues) { mutableStateOf(initialValues?.signature1.orEmpty()) }
    var signature2 by remember(initialValues) { mutableStateOf(initialValues?.signature2.orEmpty()) }
    var showAdvancedStalkerIdentity by remember(initialValues) {
        mutableStateOf(
            listOf(
                initialValues?.deviceId1,
                initialValues?.deviceId2,
                initialValues?.signature1,
                initialValues?.signature2,
            ).any { !it.isNullOrBlank() },
        )
    }
    var deriveStalkerDeviceIds by remember(initialValues) { mutableStateOf(false) }
    val normalizedStalkerMac = remember(macAddress) {
        runCatching { StalkerRequestBuilder.normalizeMac(macAddress) }.getOrNull()
    }
    val sourceFocusRequesters = remember {
        TvImportSourceOption.entries.associateWith { FocusRequester() }
    }
    val sourceFocusRequester = sourceFocusRequesters.getValue(TvImportSourceOption.M3U_URL)
    val selectedSourceFocusRequester = sourceFocusRequesters.getValue(selectedOption)
    val nameFocusRequester = remember { FocusRequester() }
    val serverFocusRequester = remember { FocusRequester() }
    val usernameFocusRequester = remember { FocusRequester() }
    val passwordFocusRequester = remember { FocusRequester() }
    val epgFocusRequester = remember { FocusRequester() }
    val userAgentFocusRequester = remember { FocusRequester() }
    val referrerFocusRequester = remember { FocusRequester() }
    val originFocusRequester = remember { FocusRequester() }
    val advancedOptionsFocusRequester = remember { FocusRequester() }
    val stalkerMacFocusRequester = remember { FocusRequester() }
    val stalkerSerialFocusRequester = remember { FocusRequester() }
    val stalkerAdvancedFocusRequester = remember { FocusRequester() }
    val stalkerDeriveFocusRequester = remember { FocusRequester() }
    val stalkerDeviceId1FocusRequester = remember { FocusRequester() }
    val stalkerDeviceId2FocusRequester = remember { FocusRequester() }
    val stalkerSignature1FocusRequester = remember { FocusRequester() }
    val stalkerSignature2FocusRequester = remember { FocusRequester() }
    val clearFocusRequester = remember { FocusRequester() }
    val cancelFocusRequester = remember { FocusRequester() }
    val connectFocusRequester = remember { FocusRequester() }
    val importScrollState = rememberScrollState()
    val bringIntoViewRequesters = remember {
        TvImportField.entries.associateWith { BringIntoViewRequester() }
    }
    var focusedField by remember { mutableStateOf(TvImportField.Server) }
    var formHasFocus by remember { mutableStateOf(false) }
    // The original dialog presents the playlist name before connection data
    // for Xtream/Stalker (and for text imports). Keep that first field in the
    // DPAD path instead of always jumping to the server field.
    val firstFormFocusRequester = when (firstTvImportField(sourceType, selectedOption)) {
        TvImportField.Name -> nameFocusRequester
        TvImportField.Server -> serverFocusRequester
        else -> serverFocusRequester
    }

    fun moveImportFocus(keyCode: Int): Boolean {
        if (!formHasFocus) return false
        val target = when (keyCode) {
            KeyEvent.KEYCODE_DPAD_UP -> when (focusedField) {
                TvImportField.Name -> if (sourceType == TvSourceType.M3U) serverFocusRequester else selectedSourceFocusRequester
                TvImportField.Server -> if (sourceType == TvSourceType.M3U) sourceFocusRequester else nameFocusRequester
                TvImportField.StalkerMac -> serverFocusRequester
                TvImportField.StalkerSerial -> stalkerMacFocusRequester
                TvImportField.StalkerAdvanced -> stalkerSerialFocusRequester
                TvImportField.StalkerDerive -> stalkerAdvancedFocusRequester
                TvImportField.StalkerDeviceId1 -> if (initialValues == null) stalkerDeriveFocusRequester else stalkerAdvancedFocusRequester
                TvImportField.StalkerDeviceId2 -> stalkerDeviceId1FocusRequester
                TvImportField.StalkerSignature1 -> stalkerDeviceId2FocusRequester
                TvImportField.StalkerSignature2 -> stalkerSignature1FocusRequester
                TvImportField.Username -> if (sourceType == TvSourceType.STALKER) {
                    if (showAdvancedStalkerIdentity) stalkerSignature2FocusRequester else stalkerAdvancedFocusRequester
                } else serverFocusRequester
                TvImportField.Password -> usernameFocusRequester
                TvImportField.Epg -> advancedOptionsFocusRequester
                TvImportField.UserAgent -> epgFocusRequester
                TvImportField.Referrer -> userAgentFocusRequester
                TvImportField.Origin -> referrerFocusRequester
                TvImportField.Connect -> when {
                    sourceType == TvSourceType.M3U && showAdvancedM3uOptions -> originFocusRequester
                    sourceType == TvSourceType.M3U && exposeAdvancedM3uOptions -> advancedOptionsFocusRequester
                    sourceType == TvSourceType.M3U -> nameFocusRequester
                    else -> passwordFocusRequester
                }
            }
            KeyEvent.KEYCODE_DPAD_DOWN -> when (focusedField) {
                TvImportField.Name -> when {
                    exposeAdvancedM3uOptions -> advancedOptionsFocusRequester
                    connectionImportNameDownField(sourceType) == TvImportField.Connect -> connectFocusRequester
                    // Xtream and Stalker present the playlist name before
                    // connection data, so keep those fields on the D-pad path.
                    else -> serverFocusRequester
                }
                TvImportField.Server -> when {
                    sourceType == TvSourceType.M3U -> nameFocusRequester
                    sourceType == TvSourceType.STALKER -> stalkerMacFocusRequester
                    else -> usernameFocusRequester
                }
                TvImportField.StalkerMac -> stalkerSerialFocusRequester
                TvImportField.StalkerSerial -> stalkerAdvancedFocusRequester
                TvImportField.StalkerAdvanced -> if (showAdvancedStalkerIdentity) {
                    if (initialValues == null) stalkerDeriveFocusRequester else stalkerDeviceId1FocusRequester
                } else usernameFocusRequester
                TvImportField.StalkerDerive -> stalkerDeviceId1FocusRequester
                TvImportField.StalkerDeviceId1 -> stalkerDeviceId2FocusRequester
                TvImportField.StalkerDeviceId2 -> stalkerSignature1FocusRequester
                TvImportField.StalkerSignature1 -> stalkerSignature2FocusRequester
                TvImportField.StalkerSignature2 -> usernameFocusRequester
                TvImportField.Username -> passwordFocusRequester
                TvImportField.Password -> connectFocusRequester
                TvImportField.Epg -> if (exposeAdvancedM3uOptions) userAgentFocusRequester else connectFocusRequester
                TvImportField.UserAgent -> if (exposeAdvancedM3uOptions) referrerFocusRequester else connectFocusRequester
                TvImportField.Referrer -> originFocusRequester
                TvImportField.Origin -> connectFocusRequester
                TvImportField.Connect -> null
            }
            else -> null
        }
        val handled = target?.requestFocus() == true
        return handled
    }

    fun fieldNavigationModifier(
        field: TvImportField,
        current: FocusRequester,
        previous: FocusRequester?,
        next: FocusRequester?,
    ): Modifier = Modifier
        .focusRequester(current)
        .focusProperties {
            previous?.let { up = it }
            next?.let { down = it }
        }
        .bringIntoViewRequester(bringIntoViewRequesters.getValue(field))
        .onFocusChanged {
            if (it.isFocused) {
                focusedField = field
                formHasFocus = true
            }
        }
        .onPreviewKeyEvent { event ->
            if (event.type != KeyEventType.KeyDown) {
                false
            } else when (event.nativeKeyEvent.keyCode) {
                KeyEvent.KEYCODE_DPAD_UP -> {
                    previous?.requestFocus() == true
                }
                KeyEvent.KEYCODE_DPAD_DOWN -> {
                    next?.requestFocus() == true
                }
                else -> false
            }
        }

    fun connectStalker() {
        onImportStalker(
            StalkerCredentials(
                portalUrl = url.trim(),
                macAddress = normalizedStalkerMac ?: macAddress.trim(),
                serialNumber = serialNumber.trim().ifBlank { null },
                username = username.trim().ifBlank { null },
                password = password.ifBlank { null },
                deviceId1 = deviceId1.trim().ifBlank { null },
                deviceId2 = deviceId2.trim().ifBlank { null },
                signature1 = signature1.trim().ifBlank { null },
                signature2 = signature2.trim().ifBlank { null },
            ),
            name.trim(),
        )
    }

    LaunchedEffect(errorMessage, importInProgress) {
        if (importInProgress) {
            // Credential entry may have scrolled the form below the separate
            // Google TV IME window. Bring the live import status back into the
            // visible viewport as soon as the request starts.
            formHasFocus = false
            importScrollState.animateScrollTo(0)
        } else if (errorMessage != null) {
            importScrollState.animateScrollTo(0)
        }
    }
    LaunchedEffect(deriveStalkerDeviceIds, macAddress) {
        if (!deriveStalkerDeviceIds || initialValues != null) return@LaunchedEffect
        // Match the original import-only opt-in. The MAC and both literal IDs
        // are always kept in sync before submission; cancellation of this
        // keyed effect prevents an older MAC digest from winning a fast edit.
        val derived = withContext(Dispatchers.Default) {
            deriveStalkerDeviceIdsFromMac(macAddress)
        }
        deviceId1 = derived?.deviceId1.orEmpty()
        deviceId2 = derived?.deviceId2.orEmpty()
    }
    LaunchedEffect(focusedField, formHasFocus, imeVisible) {
        if (formHasFocus) {
            // Compose focus moves do not automatically scroll a regular Column.
            // Reveal the active field so DPAD entry never lands below the modal.
            bringIntoViewRequesters[focusedField]?.bringIntoView()
            // The Google TV IME is rendered by a separate window. Its insets
            // can arrive after the focus event, so reveal the field again once
            // the dialog has had a frame to settle.
            delay(180)
            bringIntoViewRequesters[focusedField]?.bringIntoView()
            if (focusedField in setOf(
                    TvImportField.Server,
                    TvImportField.StalkerMac,
                    TvImportField.StalkerSerial,
                    TvImportField.StalkerDeviceId1,
                    TvImportField.StalkerDeviceId2,
                    TvImportField.StalkerSignature1,
                    TvImportField.StalkerSignature2,
                    TvImportField.Username,
                    TvImportField.Password,
                    TvImportField.Epg,
                    TvImportField.UserAgent,
                    TvImportField.Referrer,
                    TvImportField.Origin,
                )
            ) {
                // Wait until the IME safety spacer has been measured. On the
                // old path maxValue could still be zero here, leaving the
                // focused field underneath the keyboard.
                delay(220)
                val targetScroll = when (focusedField) {
                    // Keep the field and the connection action above the IME,
                    // not merely just outside its top edge.
                    TvImportField.Password -> 500
                    TvImportField.StalkerDeviceId1 -> 370
                    TvImportField.StalkerDeviceId2,
                    TvImportField.StalkerSignature1 -> 430
                    TvImportField.StalkerSignature2 -> 500
                    TvImportField.Username,
                    TvImportField.StalkerSerial -> 430
                    TvImportField.StalkerMac -> 420
                    TvImportField.Server -> 340
                    TvImportField.Epg -> 240
                    TvImportField.UserAgent -> 300
                    TvImportField.Referrer -> 360
                    TvImportField.Origin -> 420
                    else -> 180
                }
                // Do the first reposition synchronously from the user's point
                // of view. An animated scroll leaves the next credential
                // field underneath the Google TV keyboard for a few frames.
                importScrollState.scrollTo(targetScroll.coerceAtMost(importScrollState.maxValue))
                // Some Google TV images resize the IME window once more after
                // displaying it; re-apply the position after that resize.
                delay(260)
                importScrollState.scrollTo(targetScroll.coerceAtMost(importScrollState.maxValue))
            }
        }
    }

    // A Back meant for the Google TV keyboard can reach the dialog after the
    // keyboard has hidden (or before it appeared). The first Back on each
    // field therefore only dismisses the keyboard and keeps focus in place;
    // a second Back closes the form, so typed data is never lost by accident.
    var backConsumedFor by remember { mutableStateOf<TvImportField?>(null) }
    BackHandler {
        if (formHasFocus && backConsumedFor != focusedField) {
            backConsumedFor = focusedField
            importKeyboardController?.hide()
        } else {
            onBack()
        }
    }
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(max = maxDialogHeight)
            .padding(horizontal = 10.dp, vertical = 8.dp)
            .onPreviewKeyEvent { event ->
                event.type == KeyEventType.KeyDown && moveImportFocus(event.nativeKeyEvent.keyCode)
            },
    ) {
      Column(
          modifier = Modifier
            .fillMaxWidth()
            // The connection row is a fixed sibling at the bottom of the
            // dialog. Shorten the scroll viewport by its height so the last
            // credential field can never slide underneath that row.
            .padding(bottom = if (showStalkerConnectionAction) 72.dp else 0.dp)
            .verticalScroll(importScrollState)
            // The TV IME is a separate window and some emulator images do not
            // propagate its inset to the Dialog. Keep the scroll viewport
            // padded as well, so the focused credential field never ends up
            // underneath the keyboard while typing.
            .imePadding()
            .padding(6.dp),
          // The desktop dialog uses tight 8–14px gaps. Android TV density
          // multiplies dp, so keep the Compose spacing deliberately compact.
          verticalArrangement = Arrangement.spacedBy(2.dp),
      ) {
        Row(modifier = Modifier.padding(bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(4.dp).height(30.dp).background(tvTone(TvTone.Accent), RoundedCornerShape(2.dp)))
            Column(Modifier.padding(start = 10.dp)) {
                Text("Añadir playlist", color = TvText, fontFamily = TvType.Display, fontSize = 18.sp, lineHeight = 20.sp)
                Text(
                    "Elige cómo quieres conectarte. Puedes cambiar el nombre después.",
                    color = TvMuted,
                    fontSize = 10.sp,
                    lineHeight = 12.sp,
                )
            }
        }
        // Progress is rendered by TvImportProgressPanel over this form.
        if (!importInProgress) {
            errorMessage?.let { message ->
                TvPortalUnavailableState(
                    title = if (sourceType == TvSourceType.XTREAM) "Portal no disponible" else "Fuente no disponible",
                    message = message,
                    onEdit = { serverFocusRequester.requestFocus() },
                    onCancel = onBack,
                )
            }
        }
        TvImportSourceGrid(
            selected = selectedOption,
            focusRequesters = sourceFocusRequesters,
            formFocusRequester = firstFormFocusRequester,
            onSourceFocus = { formHasFocus = false },
            onSelect = { option ->
                selectedOption = option
                if (option == TvImportSourceOption.M3U_FILE) {
                    onPickLocalM3u(name.trim())
                } else {
                    sourceType = option.sourceType
                }
            },
        )
        if (sourceType != TvSourceType.M3U ||
            selectedOption == TvImportSourceOption.RAW_M3U ||
            selectedOption == TvImportSourceOption.AUTO_DETECT
        ) {
            TvOutlinedTextField(
                showKeyboardOnFocus = false,
                value = name,
                onValueChange = { name = it },
                label = { Text("Nombre de playlist") },
                modifier = fieldNavigationModifier(TvImportField.Name, nameFocusRequester, selectedSourceFocusRequester, serverFocusRequester)
                    .fillMaxWidth().height(44.dp),
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                keyboardActions = KeyboardActions(onNext = { serverFocusRequester.requestFocus() }),
            )
        }
        if (selectedOption == TvImportSourceOption.RAW_M3U) {
            TvOutlinedTextField(
                showKeyboardOnFocus = false,
                value = rawText,
                onValueChange = { rawText = it },
                label = { Text("Texto M3U") },
                modifier = fieldNavigationModifier(TvImportField.Server, serverFocusRequester, selectedSourceFocusRequester, connectFocusRequester)
                    .fillMaxWidth().height(150.dp),
                minLines = 7,
                maxLines = 10,
            )
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TvTextButton(
                    onClick = onBack,
                    enabled = !importInProgress || sourceType == TvSourceType.XTREAM,
                    modifier = Modifier
                        .focusRequester(cancelFocusRequester)
                        .focusProperties { right = connectFocusRequester }
                        .tvDpadFocus(),
                    colors = importTextButtonColors,
                ) { Text(if (importInProgress && sourceType != TvSourceType.XTREAM) "Importando…" else "Cancelar") }
                TvButton(
                    onClick = { onImportM3uText(rawText, name.trim().ifBlank { "Playlist de texto" }) },
                    modifier = Modifier
                        .focusRequester(connectFocusRequester)
                        .focusProperties { left = cancelFocusRequester }
                        .tvDpadFocus(),
                    enabled = !importInProgress && (rawText.contains("#EXTM3U", ignoreCase = true) || rawText.contains("#EXTINF", ignoreCase = true)),
                    colors = tvImportButtonColors(),
                ) { Text("Añadir playlist") }
            }
        } else if (selectedOption == TvImportSourceOption.AUTO_DETECT) {
            TvOutlinedTextField(
                showKeyboardOnFocus = false,
                value = autoDetectText,
                onValueChange = { autoDetectText = it },
                label = { Text("Mensaje del proveedor o texto M3U") },
                modifier = fieldNavigationModifier(TvImportField.Server, serverFocusRequester, selectedSourceFocusRequester, connectFocusRequester)
                    .fillMaxWidth().height(120.dp),
                minLines = 5,
                maxLines = 8,
            )
            Text(
                "Pega aquí el mensaje del proveedor; se detectarán listas M3U, Xtream o Stalker.",
                color = TvMuted,
                fontSize = 11.sp,
            )
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TvTextButton(
                    onClick = onBack,
                    enabled = !importInProgress || sourceType == TvSourceType.XTREAM,
                    modifier = Modifier
                        .focusRequester(cancelFocusRequester)
                        .focusProperties { right = connectFocusRequester }
                        .tvDpadFocus(),
                    colors = importTextButtonColors,
                ) { Text(if (importInProgress && sourceType != TvSourceType.XTREAM) "Importando…" else "Cancelar") }
                TvButton(
                    onClick = { onImportAutoDetect(autoDetectText, name.trim().ifBlank { "Playlist detectada" }) },
                    modifier = Modifier
                        .focusRequester(connectFocusRequester)
                        .focusProperties { left = cancelFocusRequester }
                        .tvDpadFocus(),
                    enabled = !importInProgress && autoDetectText.isNotBlank(),
                    colors = tvImportButtonColors(),
                ) { Text("Detectar y añadir") }
            }
        } else if (sourceType == TvSourceType.M3U) {
            TvOutlinedTextField(
                showKeyboardOnFocus = false,
                value = url,
                onValueChange = { url = it },
                label = { Text("URL de playlist (m3u, m3u8)*", fontSize = 12.sp) },
                textStyle = LocalTextStyle.current.copy(fontSize = 12.sp, color = TvText),
                modifier = fieldNavigationModifier(TvImportField.Server, serverFocusRequester, sourceFocusRequester, nameFocusRequester).fillMaxWidth().height(44.dp),
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                keyboardActions = KeyboardActions(onNext = { nameFocusRequester.requestFocus() }),
            )
            TvOutlinedTextField(
                showKeyboardOnFocus = false,
                value = name,
                onValueChange = { name = it },
                label = { Text("Nombre de playlist", fontSize = 12.sp) },
                textStyle = LocalTextStyle.current.copy(fontSize = 12.sp, color = TvText),
                modifier = fieldNavigationModifier(TvImportField.Name, nameFocusRequester, serverFocusRequester, if (selectedOption == TvImportSourceOption.M3U_URL && exposeAdvancedM3uOptions) advancedOptionsFocusRequester else connectFocusRequester).fillMaxWidth().height(44.dp),
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                keyboardActions = KeyboardActions(onNext = {
                    if (exposeAdvancedM3uOptions && showAdvancedM3uOptions) {
                        epgFocusRequester.requestFocus()
                    } else {
                        importKeyboardController?.hide()
                        connectFocusRequester.requestFocus()
                    }
                }),
            )
            if (exposeAdvancedM3uOptions) {
                TvTextButton(
                    onClick = {
                        showAdvancedM3uOptions = !showAdvancedM3uOptions
                        if (showAdvancedM3uOptions) epgFocusRequester.requestFocus() else connectFocusRequester.requestFocus()
                    },
                    modifier = Modifier
                        .focusRequester(advancedOptionsFocusRequester)
                        .focusProperties {
                            up = nameFocusRequester
                            down = if (showAdvancedM3uOptions) epgFocusRequester else connectFocusRequester
                        }
                        .tvDpadFocus(),
                    colors = importTextButtonColors,
                ) { Text(if (showAdvancedM3uOptions) "Ocultar opciones avanzadas" else "Opciones avanzadas") }
            }
            if (exposeAdvancedM3uOptions && showAdvancedM3uOptions) {
                TvOutlinedTextField(
                    showKeyboardOnFocus = false,
                    value = epgUrl,
                    onValueChange = { epgUrl = it },
                    label = { Text("URL XMLTV (opcional)", fontSize = 12.sp) },
                    textStyle = LocalTextStyle.current.copy(fontSize = 12.sp, color = TvText),
                    modifier = fieldNavigationModifier(TvImportField.Epg, epgFocusRequester, advancedOptionsFocusRequester, userAgentFocusRequester).fillMaxWidth().height(44.dp),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    keyboardActions = KeyboardActions(onNext = { userAgentFocusRequester.requestFocus() }),
                )
                TvOutlinedTextField(
                    showKeyboardOnFocus = false,
                    value = userAgent,
                    onValueChange = { userAgent = it },
                    label = { Text("Agente de usuario (opcional)", fontSize = 12.sp) },
                    textStyle = LocalTextStyle.current.copy(fontSize = 12.sp, color = TvText),
                    modifier = fieldNavigationModifier(TvImportField.UserAgent, userAgentFocusRequester, epgFocusRequester, referrerFocusRequester).fillMaxWidth().height(44.dp),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    keyboardActions = KeyboardActions(onNext = { referrerFocusRequester.requestFocus() }),
                )
                TvOutlinedTextField(
                    showKeyboardOnFocus = false,
                    value = referrer,
                    onValueChange = { referrer = it },
                    label = { Text("Referer (opcional)", fontSize = 12.sp) },
                    textStyle = LocalTextStyle.current.copy(fontSize = 12.sp, color = TvText),
                    modifier = fieldNavigationModifier(TvImportField.Referrer, referrerFocusRequester, userAgentFocusRequester, originFocusRequester).fillMaxWidth().height(44.dp),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    keyboardActions = KeyboardActions(onNext = { originFocusRequester.requestFocus() }),
                )
                TvOutlinedTextField(
                    showKeyboardOnFocus = false,
                    value = origin,
                    onValueChange = { origin = it },
                    label = { Text("Origin (opcional)", fontSize = 12.sp) },
                    textStyle = LocalTextStyle.current.copy(fontSize = 12.sp, color = TvText),
                    modifier = fieldNavigationModifier(TvImportField.Origin, originFocusRequester, referrerFocusRequester, connectFocusRequester).fillMaxWidth().height(44.dp),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = {
                        importKeyboardController?.hide()
                        connectFocusRequester.requestFocus()
                    }),
                )
            }
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TvTextButton(
                    onClick = {
                        url = ""
                        name = ""
                        userAgent = ""
                        referrer = ""
                        origin = ""
                        epgUrl = ""
                    },
                    modifier = Modifier
                        .focusRequester(clearFocusRequester)
                        .focusProperties { right = cancelFocusRequester }
                        .tvDpadFocus(),
                    colors = importTextButtonColors,
                ) { Text("Limpiar") }
                TvTextButton(
                    onClick = onBack,
                    enabled = !importInProgress || sourceType == TvSourceType.XTREAM,
                    modifier = Modifier
                        .focusRequester(cancelFocusRequester)
                        .focusProperties {
                            left = clearFocusRequester
                            right = connectFocusRequester
                        }
                        .tvDpadFocus(),
                    colors = importTextButtonColors,
                ) { Text(if (importInProgress && sourceType != TvSourceType.XTREAM) "Importando…" else "Cancelar") }
                TvButton(
                    modifier = Modifier
                        .focusRequester(connectFocusRequester)
                        .semantics { contentDescription = "Añadir playlist" }
                        .focusProperties {
                            left = cancelFocusRequester
                            up = if (showAdvancedM3uOptions) originFocusRequester else advancedOptionsFocusRequester
                        }
                        .bringIntoViewRequester(bringIntoViewRequesters.getValue(TvImportField.Connect))
                        .onFocusChanged {
                            if (it.isFocused) {
                                focusedField = TvImportField.Connect
                                formHasFocus = true
                            }
                        }
                        .tvDpadFocus(),
                    onClick = {
                        onImportM3u(
                            TvPlaylistSource(
                                url = url.trim(),
                                name = name.trim(),
                                userAgent = userAgent.trim().ifBlank { null },
                                epgUrl = epgUrl.trim().ifBlank { null },
                                referrer = referrer.trim().ifBlank { null },
                                origin = origin.trim().ifBlank { null },
                            ),
                        )
                    },
                    enabled = !importInProgress && (url.startsWith("http://") || url.startsWith("https://")),
                    colors = tvImportButtonColors(),
                ) { Text("Añadir playlist") }
            }
        } else if (sourceType == TvSourceType.XTREAM) {
            TvXtreamImportFields(
                url = url,
                onUrlChange = { url = it },
                username = username,
                onUsernameChange = { username = it },
                password = password,
                onPasswordChange = { password = it },
                name = name,
                importInProgress = importInProgress,
                serverFocusRequester = serverFocusRequester,
                nameFocusRequester = nameFocusRequester,
                usernameFocusRequester = usernameFocusRequester,
                passwordFocusRequester = passwordFocusRequester,
                connectFocusRequester = connectFocusRequester,
                cancelFocusRequester = cancelFocusRequester,
                fieldNavigationModifier = ::fieldNavigationModifier,
                onImport = onImportXtream,
            )
        } else {
            Text("Introduce el portal Ministra/Stalker y la MAC del dispositivo", color = TvMuted, fontSize = 10.sp)
            TvOutlinedTextField(
                showKeyboardOnFocus = false,
                value = url,
                onValueChange = { url = it },
                label = { Text("Portal o URL /c", fontSize = 12.sp) },
                textStyle = LocalTextStyle.current.copy(fontSize = 12.sp, color = TvText),
                modifier = fieldNavigationModifier(TvImportField.Server, serverFocusRequester, selectedSourceFocusRequester, stalkerMacFocusRequester).fillMaxWidth().height(44.dp),
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                keyboardActions = KeyboardActions(onNext = { stalkerMacFocusRequester.requestFocus() }),
            )
            TvOutlinedTextField(
                showKeyboardOnFocus = false,
                value = macAddress,
                onValueChange = { macAddress = it },
                label = { Text("MAC (00:1A:79:AA:BB:CC)", fontSize = 12.sp) },
                textStyle = LocalTextStyle.current.copy(fontSize = 12.sp, color = TvText),
                modifier = fieldNavigationModifier(TvImportField.StalkerMac, stalkerMacFocusRequester, serverFocusRequester, stalkerSerialFocusRequester)
                    .fillMaxWidth()
                    .heightIn(min = 44.dp),
                singleLine = true,
                isError = macAddress.isNotBlank() && normalizedStalkerMac == null,
                // Only reserve the supporting row for an actual error; an
                // always-present slot squeezed the 44dp field.
                supportingText = if (macAddress.isNotBlank() && normalizedStalkerMac == null) {
                    { Text("MAC no válida: usa 12 dígitos hexadecimales", color = tvColor(Color(0xFFFF9E9E)), fontSize = 10.sp) }
                } else null,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                keyboardActions = KeyboardActions(onNext = { stalkerSerialFocusRequester.requestFocus() }),
            )
            TvOutlinedTextField(
                showKeyboardOnFocus = false,
                value = serialNumber,
                onValueChange = { serialNumber = it },
                label = { Text("Número de serie (opcional)", fontSize = 12.sp) },
                textStyle = LocalTextStyle.current.copy(fontSize = 12.sp, color = TvText),
                modifier = fieldNavigationModifier(TvImportField.StalkerSerial, stalkerSerialFocusRequester, stalkerMacFocusRequester, stalkerAdvancedFocusRequester).fillMaxWidth().height(44.dp),
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                keyboardActions = KeyboardActions(onNext = { stalkerAdvancedFocusRequester.requestFocus() }),
            )
            TvTextButton(
                onClick = { showAdvancedStalkerIdentity = !showAdvancedStalkerIdentity },
                modifier = fieldNavigationModifier(
                    TvImportField.StalkerAdvanced,
                    stalkerAdvancedFocusRequester,
                    stalkerSerialFocusRequester,
                    if (showAdvancedStalkerIdentity) {
                        if (initialValues == null) stalkerDeriveFocusRequester else stalkerDeviceId1FocusRequester
                    } else usernameFocusRequester,
                ).fillMaxWidth(),
                colors = importTextButtonColors,
            ) {
                Text(if (showAdvancedStalkerIdentity) "Ocultar identidad MAG avanzada" else "Identidad MAG avanzada (opcional)")
            }
            if (showAdvancedStalkerIdentity) {
                Text(
                    "Usa estos valores solo si tu proveedor te los ha dado; algunos portales los fijan a la MAC.",
                    color = TvMuted,
                    fontSize = 11.sp,
                )
                if (initialValues != null &&
                    (initialValues.deviceId1.isNotBlank() || initialValues.deviceId2.isNotBlank())
                ) {
                    Text(
                        "Aviso: si el portal ya recibió estos IDs, cambiarlos o borrarlos podría bloquear esta fuente. La edición no los vuelve a derivar.",
                        color = tvColor(Color(0xFFFFC48A)),
                        fontSize = 11.sp,
                    )
                }
                if (initialValues == null) {
                    val hasManualStalkerDeviceIds = !deriveStalkerDeviceIds &&
                        (deviceId1.isNotBlank() || deviceId2.isNotBlank())
                    Row(
                        modifier = Modifier
                            .focusRequester(stalkerDeriveFocusRequester)
                            .focusProperties {
                                up = stalkerAdvancedFocusRequester
                                down = stalkerDeviceId1FocusRequester
                            }
                            .onFocusChanged {
                                if (it.isFocused) {
                                    focusedField = TvImportField.StalkerDerive
                                    formHasFocus = true
                                }
                            }
                            .bringIntoViewRequester(bringIntoViewRequesters.getValue(TvImportField.StalkerDerive))
                            .tvDpadClick {
                                if (!hasManualStalkerDeviceIds && !importInProgress) {
                                    deriveStalkerDeviceIds = !deriveStalkerDeviceIds
                                    if (!deriveStalkerDeviceIds) {
                                        deviceId1 = ""
                                        deviceId2 = ""
                                    }
                                }
                            }
                            .fillMaxWidth()
                            .padding(vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            if (deriveStalkerDeviceIds) "☑" else "☐",
                            color = if (hasManualStalkerDeviceIds) TvMuted else tvColor(Color(0xFF9DBEFF)),
                            fontSize = 18.sp,
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(
                            "Derivar IDs del dispositivo desde la MAC (solo al importar)",
                            color = if (hasManualStalkerDeviceIds) TvMuted else TvText,
                            fontSize = 12.sp,
                        )
                    }
                    Text(
                        "Opt-in: algunos portales vinculan estos IDs permanentemente a la MAC. Si ya escribiste IDs, bórralos antes de activar esta opción.",
                        color = TvMuted,
                        fontSize = 10.sp,
                    )
                }
                TvOutlinedTextField(
                    showKeyboardOnFocus = false,
                    value = deviceId1,
                    onValueChange = { deviceId1 = it },
                    label = { Text("Device ID 1 (opcional)", fontSize = 12.sp) },
                    textStyle = LocalTextStyle.current.copy(fontSize = 12.sp, color = TvText),
                    modifier = fieldNavigationModifier(
                        TvImportField.StalkerDeviceId1,
                        stalkerDeviceId1FocusRequester,
                        if (initialValues == null) stalkerDeriveFocusRequester else stalkerAdvancedFocusRequester,
                        stalkerDeviceId2FocusRequester,
                    )
                        .fillMaxWidth().height(44.dp),
                    readOnly = deriveStalkerDeviceIds,
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    keyboardActions = KeyboardActions(onNext = { stalkerDeviceId2FocusRequester.requestFocus() }),
                )
                TvOutlinedTextField(
                    showKeyboardOnFocus = false,
                    value = deviceId2,
                    onValueChange = { deviceId2 = it },
                    label = { Text("Device ID 2 (opcional)", fontSize = 12.sp) },
                    textStyle = LocalTextStyle.current.copy(fontSize = 12.sp, color = TvText),
                    modifier = fieldNavigationModifier(TvImportField.StalkerDeviceId2, stalkerDeviceId2FocusRequester, stalkerDeviceId1FocusRequester, stalkerSignature1FocusRequester)
                        .fillMaxWidth().height(44.dp),
                    readOnly = deriveStalkerDeviceIds,
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    keyboardActions = KeyboardActions(onNext = { stalkerSignature1FocusRequester.requestFocus() }),
                )
                TvOutlinedTextField(
                    showKeyboardOnFocus = false,
                    value = signature1,
                    onValueChange = { signature1 = it },
                    label = { Text("Firma 1 (opcional)", fontSize = 12.sp) },
                    textStyle = LocalTextStyle.current.copy(fontSize = 12.sp, color = TvText),
                    modifier = fieldNavigationModifier(TvImportField.StalkerSignature1, stalkerSignature1FocusRequester, stalkerDeviceId2FocusRequester, stalkerSignature2FocusRequester)
                        .fillMaxWidth().height(44.dp),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    keyboardActions = KeyboardActions(onNext = { stalkerSignature2FocusRequester.requestFocus() }),
                )
                TvOutlinedTextField(
                    showKeyboardOnFocus = false,
                    value = signature2,
                    onValueChange = { signature2 = it },
                    label = { Text("Firma 2 (opcional)", fontSize = 12.sp) },
                    textStyle = LocalTextStyle.current.copy(fontSize = 12.sp, color = TvText),
                    modifier = fieldNavigationModifier(TvImportField.StalkerSignature2, stalkerSignature2FocusRequester, stalkerSignature1FocusRequester, usernameFocusRequester)
                        .fillMaxWidth().height(44.dp),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                keyboardActions = KeyboardActions(onNext = { stalkerAdvancedFocusRequester.requestFocus() }),
                )
            }
            // Optional portal credentials share one row so the whole Stalker
            // form stays above the pinned connection action on a 1080p TV.
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TvOutlinedTextField(
                    showKeyboardOnFocus = false,
                    value = username,
                    onValueChange = { username = it },
                    label = { Text("Usuario (si el portal lo pide)", fontSize = 12.sp) },
                    textStyle = LocalTextStyle.current.copy(fontSize = 12.sp, color = TvText),
                    modifier = Modifier.weight(1f).then(fieldNavigationModifier(
                        TvImportField.Username,
                        usernameFocusRequester,
                        if (showAdvancedStalkerIdentity) stalkerSignature2FocusRequester else stalkerAdvancedFocusRequester,
                        passwordFocusRequester,
                    )).height(44.dp),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    keyboardActions = KeyboardActions(onNext = { passwordFocusRequester.requestFocus() }),
                )
                TvOutlinedTextField(
                    showKeyboardOnFocus = false,
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("Contraseña (si el portal la pide)", fontSize = 12.sp) },
                    textStyle = LocalTextStyle.current.copy(fontSize = 12.sp, color = TvText),
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.weight(1f).then(fieldNavigationModifier(TvImportField.Password, passwordFocusRequester, usernameFocusRequester, connectFocusRequester)).height(44.dp),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { connectFocusRequester.requestFocus() }),
                )
            }
        }
        // The Android TV IME can be a separate overlay window and therefore
        // not contribute its height to Compose's measured viewport. Reserve
        // room while editing so the scroll range can reveal username,
        // password and the connection action instead of leaving them under
        // the keyboard.
        // Give the scroll container enough range for the explicit IME safety
        // offsets above. This is needed on Google TV images whose keyboard is
        // rendered in a separate window and therefore contributes no inset.
        if (formHasFocus) {
            // On Google TV the IME may not contribute insets to this dialog;
            // keep enough trailing range for the explicit focused-field
            // offsets above even when the shortened IME viewport is active.
            Spacer(modifier = Modifier.height(if (imeVisible) 720.dp else 480.dp))
        }
      }
      if (showStalkerConnectionAction) {
          Row(
              modifier = Modifier
                  .align(Alignment.BottomEnd)
                  .fillMaxWidth()
                  .background(TvBackground)
                  .padding(horizontal = 14.dp, vertical = 8.dp),
              horizontalArrangement = Arrangement.End,
              verticalAlignment = Alignment.CenterVertically,
          ) {
              TvTextButton(
                  onClick = onBack,
                  enabled = !importInProgress,
                  modifier = Modifier
                      .focusRequester(cancelFocusRequester)
                      .focusProperties { right = connectFocusRequester }
                      .tvDpadFocus(),
                  colors = importTextButtonColors,
              ) { Text("Cancelar") }
              TvButton(
                  modifier = Modifier
                      .focusRequester(connectFocusRequester)
                      .focusProperties {
                          left = cancelFocusRequester
                          up = passwordFocusRequester
                      }
                      .onFocusChanged {
                          if (it.isFocused) {
                              focusedField = TvImportField.Connect
                              formHasFocus = true
                          }
                      }
                      .tvDpadFocus(),
                  onClick = ::connectStalker,
                  enabled = !importInProgress &&
                      (url.startsWith("http://") || url.startsWith("https://")) &&
                      normalizedStalkerMac != null,
                  colors = tvImportButtonColors(),
              ) { Text(if (importInProgress) "Conectando…" else "Conectar Stalker") }
          }
      }
    }
}

@Composable
private fun TvXtreamImportFields(
    url: String,
    onUrlChange: (String) -> Unit,
    username: String,
    onUsernameChange: (String) -> Unit,
    password: String,
    onPasswordChange: (String) -> Unit,
    name: String,
    importInProgress: Boolean,
    serverFocusRequester: FocusRequester,
    nameFocusRequester: FocusRequester,
    usernameFocusRequester: FocusRequester,
    passwordFocusRequester: FocusRequester,
    connectFocusRequester: FocusRequester,
    cancelFocusRequester: FocusRequester,
    fieldNavigationModifier: (TvImportField, FocusRequester, FocusRequester?, FocusRequester?) -> Modifier,
    onImport: (XtreamCredentials, String) -> Unit,
) {
    Text("Introduce los datos de tu servidor Xtream", color = TvMuted, fontSize = 10.sp)
    TvOutlinedTextField(
        showKeyboardOnFocus = false,
        value = url,
        onValueChange = onUrlChange,
        label = { Text("Servidor", fontSize = 12.sp) },
        textStyle = LocalTextStyle.current.copy(fontSize = 12.sp, color = TvText),
        modifier = fieldNavigationModifier(TvImportField.Server, serverFocusRequester, nameFocusRequester, usernameFocusRequester).fillMaxWidth().height(44.dp),
        singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
        keyboardActions = KeyboardActions(onNext = { usernameFocusRequester.requestFocus() }),
    )
    TvOutlinedTextField(
        showKeyboardOnFocus = false,
        value = username,
        onValueChange = onUsernameChange,
        label = { Text("Usuario", fontSize = 12.sp) },
        textStyle = LocalTextStyle.current.copy(fontSize = 12.sp, color = TvText),
        modifier = fieldNavigationModifier(TvImportField.Username, usernameFocusRequester, serverFocusRequester, passwordFocusRequester).fillMaxWidth().height(44.dp),
        singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
        keyboardActions = KeyboardActions(onNext = { passwordFocusRequester.requestFocus() }),
    )
    TvOutlinedTextField(
        showKeyboardOnFocus = false,
        value = password,
        onValueChange = onPasswordChange,
        label = { Text("Contraseña", fontSize = 12.sp) },
        textStyle = LocalTextStyle.current.copy(fontSize = 12.sp, color = TvText),
        visualTransformation = PasswordVisualTransformation(),
        modifier = fieldNavigationModifier(TvImportField.Password, passwordFocusRequester, usernameFocusRequester, connectFocusRequester).fillMaxWidth().height(44.dp),
        singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { connectFocusRequester.requestFocus() }),
    )
    TvButton(
        modifier = Modifier
            .focusRequester(connectFocusRequester)
            .focusProperties { left = cancelFocusRequester }
            .tvDpadFocus(),
        onClick = { onImport(XtreamCredentials(url.trim(), username.trim(), password), name.trim()) },
        enabled = !importInProgress && (url.startsWith("http://") || url.startsWith("https://")) &&
            username.isNotBlank() && password.isNotBlank(),
        colors = tvImportButtonColors(),
    ) { Text(if (importInProgress) "Conectando…" else "Conectar Xtream") }
}

@Composable
private fun TvPortalUnavailableState(
    title: String,
    message: String,
    onEdit: () -> Unit,
    onCancel: () -> Unit,
) {
    TvCard(
        onClick = onEdit,
        modifier = Modifier.fillMaxWidth().tvDpadClick(onEdit),
        colors = androidx.tv.material3.CardDefaults.colors(
            containerColor = tvColor(Color(0xFF2B2026)),
            focusedContainerColor = tvColor(Color(0xFF49303A)),
        ),
    ) {
        Column(modifier = Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, color = tvColor(Color(0xFFFFB4AB)), fontSize = 20.sp)
            Text("No se ha podido cargar esta fuente. Comprueba los datos de conexión y vuelve a intentarlo.", color = TvText, fontSize = 14.sp)
            Text(message, color = TvMuted, fontSize = 12.sp, maxLines = 3)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                TvButton(onClick = onEdit, modifier = Modifier.tvDpadClick(onEdit)) { Text("Editar datos") }
                TvButton(onClick = onCancel, modifier = Modifier.tvDpadClick(onCancel)) { Text("Cancelar") }
            }
        }
    }
}

internal data class TvLocalM3uFile(val uri: Uri, val name: String, val location: String)

internal fun isUsableTvDocumentPickerPackage(packageName: String?): Boolean =
    !packageName.isNullOrBlank() && !packageName.contains("frameworkpackagestubs", ignoreCase = true)

@Composable
internal fun TvLocalM3uPicker(
    onDismiss: () -> Unit,
    onUseUrlOrText: () -> Unit,
    onSelect: (TvLocalM3uFile) -> Unit,
) {
    val context = LocalContext.current
    val firstFileFocusRequester = remember { FocusRequester() }
    var files by remember { mutableStateOf<List<TvLocalM3uFile>>(emptyList()) }
    LaunchedEffect(Unit) {
        files = withContext(Dispatchers.IO) {
            val collection = MediaStore.Files.getContentUri("external")
            val projection = arrayOf(
                MediaStore.Files.FileColumns._ID,
                MediaStore.Files.FileColumns.DISPLAY_NAME,
                MediaStore.Files.FileColumns.RELATIVE_PATH,
            )
            val selection = "${MediaStore.Files.FileColumns.DISPLAY_NAME} LIKE ? OR ${MediaStore.Files.FileColumns.DISPLAY_NAME} LIKE ?"
            val args = arrayOf("%.m3u", "%.m3u8")
            buildList {
                context.contentResolver.query(collection, projection, selection, args, "${MediaStore.Files.FileColumns.DATE_MODIFIED} DESC")?.use { cursor ->
                    val idIndex = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
                    val nameIndex = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DISPLAY_NAME)
                    val pathIndex = cursor.getColumnIndex(MediaStore.Files.FileColumns.RELATIVE_PATH)
                    while (cursor.moveToNext()) {
                        val name = cursor.getString(nameIndex)
                        val path = if (pathIndex >= 0) cursor.getString(pathIndex).orEmpty() else ""
                        add(TvLocalM3uFile(ContentUris.withAppendedId(collection, cursor.getLong(idIndex)), name, path))
                    }
                }
                context.getExternalFilesDir(null)?.walkTopDown()?.filter { file ->
                    file.isFile && (file.extension.equals("m3u", true) || file.extension.equals("m3u8", true))
                }?.forEach { file ->
                    add(TvLocalM3uFile(Uri.fromFile(file), file.name, file.parentFile?.name.orEmpty()))
                }
                // Some Google TV emulator images expose no usable DocumentsUI
                // and do not index files copied to public storage immediately.
                // Keep the TV fallback useful for the conventional folders a
                // file manager/provider uses, without scanning the whole disk.
                listOf(
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS),
                ).distinct().forEach { directory ->
                    runCatching {
                        directory.walkTopDown()
                            .filter { file ->
                                file.isFile && file.canRead() &&
                                    (file.extension.equals("m3u", true) || file.extension.equals("m3u8", true))
                            }
                            .forEach { file ->
                                add(TvLocalM3uFile(Uri.fromFile(file), file.name, file.parentFile?.name.orEmpty()))
                            }
                    }
                }
            }
        }
    }
    var fileListHasFocus by remember { mutableStateOf(false) }
    LaunchedEffect(files.firstOrNull()?.uri) {
        // The dialog window may gain input focus after the first frame; keep
        // retrying briefly until the list really owns focus so OK on the
        // remote activates the first file instead of doing nothing.
        if (files.isEmpty()) return@LaunchedEffect
        repeat(30) {
            if (fileListHasFocus) return@LaunchedEffect
            runCatching { firstFileFocusRequester.requestFocus() }
            delay(50)
        }
    }
    TvAlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Elegir archivo M3U") },
        text = {
            if (files.isEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        "No hay archivos M3U accesibles en las carpetas compartidas. Puedes añadir la URL de la lista o pegar su contenido M3U.",
                        color = TvMuted,
                    )
                    TvButton(
                        onClick = onUseUrlOrText,
                        modifier = Modifier.tvDpadClick(onUseUrlOrText),
                    ) { Text("Usar URL o pegar contenido") }
                }
            } else {
                LazyColumn(
                    modifier = Modifier.heightIn(max = 420.dp).onFocusChanged { fileListHasFocus = it.hasFocus },
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    itemsIndexed(files, key = { _, file -> file.uri.toString() }) { index, file ->
                        TvCard(
                            onClick = { onSelect(file) },
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(54.dp)
                                .then(if (index == 0) Modifier.focusRequester(firstFileFocusRequester) else Modifier)
                                .tvDpadClick { onSelect(file) },
                            colors = androidx.tv.material3.CardDefaults.colors(
                                containerColor = tvColor(Color(0xFF202532)),
                                focusedContainerColor = tvColor(Color(0xFF536A9F)),
                            ),
                        ) {
                            Column(modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 7.dp)) {
                            Text(file.name, color = TvText, fontSize = 13.sp, maxLines = 1)
                            Text(file.location, color = TvMuted, fontSize = 10.sp, maxLines = 1)
                        }
                    }
                }
                }
            }
        },
        confirmButton = { TvButton(onClick = onDismiss, modifier = Modifier.tvDpadClick(onDismiss)) { Text("Cancelar") } },
    )
}

internal enum class TvSourceType(val label: String) {
    M3U("M3U / M3U8"),
    XTREAM("Xtream Codes"),
    STALKER("Stalker / Ministra"),
}

internal enum class TvImportSourceOption(
    val title: String,
    val description: String,
    val icon: String,
    val sourceType: TvSourceType,
) {
    M3U_URL("URL M3U", "Enlace remoto .m3u o .m3u8", "↗", TvSourceType.M3U),
    M3U_FILE("Archivo M3U", "Importa desde el dispositivo", "□", TvSourceType.M3U),
    XTREAM("Credenciales Xtream", "Servidor, usuario y contraseña", "⚿", TvSourceType.XTREAM),
    STALKER("Portal Stalker", "Portal y dirección MAC", "◉", TvSourceType.STALKER),
    RAW_M3U("Texto M3U", "Pega texto M3U directamente", "≡", TvSourceType.M3U),
    AUTO_DETECT("Detección automática", "Pega los datos de tu proveedor", "✦", TvSourceType.M3U),
}

private data class TvImportInitialValues(
    val playlistId: String,
    val sourceType: TvSourceType,
    val name: String,
    val url: String,
    val epgUrl: String,
    val epgUrls: List<String> = emptyList(),
    val userAgent: String,
    val username: String,
    val password: String,
    val macAddress: String,
    val serialNumber: String,
    val deviceId1: String,
    val deviceId2: String,
    val signature1: String,
    val signature2: String,
    val sourceReferrer: String? = null,
    val sourceOrigin: String? = null,
)

internal enum class TvImportField {
    Name, Server, StalkerMac, StalkerSerial, StalkerAdvanced, StalkerDerive,
    StalkerDeviceId1, StalkerDeviceId2, StalkerSignature1, StalkerSignature2,
    Username, Password, Epg, UserAgent, Referrer, Origin, Connect,
}

internal fun firstTvImportField(
    sourceType: TvSourceType,
    option: TvImportSourceOption,
): TvImportField = if (
    sourceType != TvSourceType.M3U ||
        option == TvImportSourceOption.RAW_M3U ||
        option == TvImportSourceOption.AUTO_DETECT
) {
    TvImportField.Name
} else {
    TvImportField.Server
}

internal fun connectionImportNameDownField(sourceType: TvSourceType): TvImportField =
    if (sourceType == TvSourceType.M3U) TvImportField.Connect else TvImportField.Server

private fun TvXtreamImportProgress.toTvImportStatus(): String = when (phase) {
    "account" -> "Autenticando con Xtream…"
    "metadata" -> "Cargando canales y categorías…"
    "live" -> "Canales en directo: $current"
    "vod" -> if (current > 0) "Importando películas: $current" else "Preparando películas…"
    "series" -> if (current > 0) "Importando series: $current" else "Preparando series…"
    "complete" -> "Catálogo Xtream listo"
    else -> "Importando catálogo Xtream…"
}

private fun TvChannel.toPlaybackRequest() = TvPlaybackRequest(
    uri = url,
    title = name,
    userAgent = userAgent,
    headers = headers,
    isLive = !isLikelyTvM3uVod(this),
    isAudio = radio,
    drm = drm,
)

private fun TvChannel.toSavedItem(playlistId: String) = TvSavedItem(
    playlistId = playlistId,
    itemType = com.iptvnator.googletv.playlist.TvSavedItemType.CHANNEL,
    itemKey = id,
    title = name,
    uri = url,
    coverUrl = logoUrl,
    savedAt = System.currentTimeMillis(),
    lastPlayedAt = null,
)

private fun TvChannel.toM3uVodItem() = TvVodItem(
    id = id.hashCode(),
    name = name,
    url = url,
    categoryId = group,
    coverUrl = logoUrl,
    extension = m3uVodExtension(),
    rating = null,
    providerType = "m3u",
)

private fun TvChannel.m3uVodExtension(): String =
    Regex("""[?&]ext=([A-Za-z0-9]+)""").find(url)?.groupValues?.get(1)
        ?: url.substringBefore('?').substringBefore('#').substringAfterLast('.', "")
            .takeIf { it.length in 2..5 }
        ?: "mp4"

private fun TvVodItem.toSavedItem(playlistId: String) = TvSavedItem(
    playlistId = playlistId,
    itemType = com.iptvnator.googletv.playlist.TvSavedItemType.VOD,
    itemKey = id.toString(),
    title = name,
    uri = url,
    coverUrl = coverUrl,
    savedAt = System.currentTimeMillis(),
    lastPlayedAt = null,
)

private fun TvSeriesItem.toSavedItem(playlistId: String) = TvSavedItem(
    playlistId = playlistId,
    itemType = com.iptvnator.googletv.playlist.TvSavedItemType.SERIES,
    itemKey = id.toString(),
    title = name,
    uri = "",
    coverUrl = coverUrl,
    savedAt = System.currentTimeMillis(),
    lastPlayedAt = null,
)

private fun TvVodItem.toPlaybackRequest() = TvPlaybackRequest(
    uri = url,
    title = name,
    userAgent = if (providerType == "xtream") XtreamApiClient.ClientUserAgent else null,
    isLive = false,
)

/** Centered empty state: glyph in an amber disc, condensed title and a hint. */
@Composable
internal fun TvEmptyState(title: String, message: String, glyph: TvSection, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxWidth().padding(top = 60.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            Modifier
                .size(64.dp)
                .background(tvTone(TvTone.Accent).copy(alpha = 0.14f), RoundedCornerShape(50)),
            contentAlignment = Alignment.Center,
        ) {
            Box(Modifier.graphicsLayer { scaleX = 1.4f; scaleY = 1.4f }) { SidebarGlyph(glyph, tvTone(TvTone.Accent)) }
        }
        Text(title, color = tvTone(TvTone.Text), fontFamily = TvType.Display, fontSize = 20.sp)
        Text(message, color = tvTone(TvTone.Muted), fontSize = 12.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}
