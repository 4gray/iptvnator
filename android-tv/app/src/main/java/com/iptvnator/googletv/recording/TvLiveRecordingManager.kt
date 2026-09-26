@file:androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])

package com.iptvnator.googletv.recording

import android.content.Context
import android.net.Uri
import android.os.Environment
import com.iptvnator.googletv.playback.TvPlaybackRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancel
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.io.ByteArrayInputStream
import java.net.URI
import java.util.Locale
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlin.coroutines.resume
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import androidx.media3.exoplayer.dash.manifest.DashManifestParser
import androidx.media3.common.C
import androidx.media3.exoplayer.dash.DashSegmentIndex
import androidx.media3.exoplayer.dash.manifest.Representation

enum class TvRecordingStatus { RECORDING, COMPLETED, FAILED, INTERRUPTED }

data class TvRecording(
    val file: File,
    val title: String,
    val sourceUri: String = "",
    val startedAtMs: Long,
    val endedAtMs: Long? = null,
    val status: TvRecordingStatus = TvRecordingStatus.RECORDING,
    val bytes: Long = 0L,
    val error: String? = null,
)

/**
 * Captures the already-resolved live URL while it is being watched.
 *
 * The desktop player delegates this to embedded mpv. Android TV has no mpv
 * process, so this manager owns a second HTTP stream and writes it to the
 * app's private Movies directory. The request headers and user agent are
 * copied from the playback request; this is important for Xtream/Stalker
 * links and for M3U streams protected by Referer/Origin.
 */
class TvLiveRecordingManager(context: Context) : AutoCloseable {
    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .callTimeout(0, TimeUnit.MILLISECONDS)
        .build()
    private val _active = MutableStateFlow<TvRecording?>(null)
    val active: StateFlow<TvRecording?> = _active.asStateFlow()
    private var activeCall: Call? = null
    private var activeJob: Job? = null
    @Volatile
    private var stopRequested = false

    fun supportsRecording(request: TvPlaybackRequest): Boolean =
        request.isLive && !request.isAudio && request.uri.isNotBlank()

    @Synchronized
    fun start(request: TvPlaybackRequest): Boolean {
        if (!supportsRecording(request) || _active.value != null) return false
        val directory = File(
            appContext.getExternalFilesDir(Environment.DIRECTORY_MOVIES) ?: appContext.filesDir,
            "recordings",
        ).apply { mkdirs() }
        val startedAt = System.currentTimeMillis()
        val extension = if (isDashStream(request)) "mpd" else "ts"
        val file = File(directory, "${safeFileName(request.title)}-$startedAt.$extension")
        val recording = TvRecording(file = file, title = request.title, sourceUri = request.uri, startedAtMs = startedAt)
        stopRequested = false
        _active.value = recording
        activeJob = scope.launch {
            val result = runCatching { copyStream(request, recording) }
            synchronized(this@TvLiveRecordingManager) {
                activeCall = null
                activeJob = null
                val completedRecording = _active.value?.takeIf { it.startedAtMs == recording.startedAtMs } ?: recording
                val bytes = recordingBytes(completedRecording.file)
                _active.value = when {
                    (stopRequested || result.getOrDefault(false)) && bytes > 0L -> completedRecording.copy(
                        endedAtMs = System.currentTimeMillis(),
                        status = TvRecordingStatus.COMPLETED,
                        bytes = bytes,
                    )
                    result.isSuccess && bytes > 0L -> completedRecording.copy(
                        endedAtMs = System.currentTimeMillis(),
                        status = TvRecordingStatus.INTERRUPTED,
                        bytes = bytes,
                    )
                    else -> {
                        deleteRecordingFiles(completedRecording.file)
                        completedRecording.copy(
                            endedAtMs = System.currentTimeMillis(),
                            status = TvRecordingStatus.FAILED,
                            bytes = bytes,
                            error = result.exceptionOrNull()?.message ?: "El servidor no entregó datos.",
                        )
                    }
                }
            }
        }
        return true
    }

    suspend fun stop(): TvRecording? {
        val job: Job
        synchronized(this) {
            if (_active.value == null) return null
            stopRequested = true
            activeCall?.cancel()
            job = activeJob ?: return _active.value
        }
        job.join()
        return _active.value
    }

    @Synchronized
    fun dismissFinished(): TvRecording? {
        val recording = _active.value ?: return null
        if (recording.status == TvRecordingStatus.RECORDING) return null
        _active.value = null
        return recording
    }

    private suspend fun copyStream(request: TvPlaybackRequest, recording: TvRecording): Boolean {
        if (isDashStream(request)) return copyDash(request, recording)
        // A live IPTV URL is very often an HLS manifest. Saving that response
        // directly would produce a text .m3u8 file instead of a recording;
        // follow the media playlist and append each unseen segment instead.
        if (isHlsManifest(request.uri)) {
            return copyHls(request, recording)
        }
        val httpRequest = Request.Builder().url(request.uri).apply {
            request.userAgent?.takeIf(String::isNotBlank)?.let { header("User-Agent", it) }
            request.headers.forEach { (name, value) -> header(name, value) }
        }.build()
        suspendCancellableCoroutine<Unit> { continuation ->
            val call = httpClient.newCall(httpRequest)
            synchronized(this) { activeCall = call }
            call.enqueue(object : okhttp3.Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (continuation.isActive) continuation.resumeWith(Result.failure(e))
                }

                override fun onResponse(call: Call, response: okhttp3.Response) {
                    response.use {
                        if (!response.isSuccessful) {
                            if (continuation.isActive) continuation.resumeWith(
                                Result.failure(IOException("HTTP ${response.code}")),
                            )
                            return
                        }
                        val outputFile = recordingOutputFile(
                            recording,
                            directStreamExtension(response.header("Content-Type"), request.uri),
                        )
                        val body = response.body
                        if (body == null) {
                            if (continuation.isActive) continuation.resumeWith(
                                Result.failure(IOException("La respuesta no tiene contenido.")),
                            )
                            return
                        }
                        runCatching {
                            outputFile.outputStream().use { output ->
                                body.byteStream().use { input ->
                                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                                    while (true) {
                                        val read = input.read(buffer)
                                        if (read < 0) break
                                        output.write(buffer, 0, read)
                                    }
                                }
                            }
                        }.fold(
                            onSuccess = {
                                publishProgress(recording.startedAtMs)
                                if (continuation.isActive) continuation.resume(Unit)
                            },
                            onFailure = { if (continuation.isActive) continuation.resumeWith(Result.failure(it)) },
                        )
                    }
                }
            })
            continuation.invokeOnCancellation { call.cancel() }
        }
        return false
    }

    /**
     * Save clear, finite DASH presentations as an offline MPD package. Dynamic
     * manifests need segment-window remuxing and DRM needs a license; neither
     * is silently saved as a broken text file.
     */
    private suspend fun copyDash(request: TvPlaybackRequest, recording: TvRecording): Boolean {
        val manifestBytes = fetchBytes(request, request.uri)
        val manifestText = manifestBytes.toString(Charsets.UTF_8)
        val rootTag = Regex("<(?:[\\w.-]+:)?MPD\\b[^>]*>", RegexOption.IGNORE_CASE).find(manifestText)?.value.orEmpty()
        val dynamicType = Regex("\\btype\\s*=\\s*[\"']dynamic[\"']", RegexOption.IGNORE_CASE).containsMatchIn(rootTag)
        val parsed = runCatching {
            DashManifestParser().parse(Uri.parse(request.uri), ByteArrayInputStream(manifestBytes))
        }.getOrElse { error ->
            if (dynamicType) throw IOException("El manifiesto DASH dinámico no es válido o no se puede analizar.", error)
            throw error
        }
        if (dynamicType || parsed.dynamic) return copyDynamicDash(parsed, request, recording, manifestText)
        if (parsed.periodCount == 0 || parsed.periodCount > 1) {
            throw IOException("La grabación DASH requiere una sola sección de reproducción.")
        }
        if (parsed.getPeriod(0).adaptationSets.any { set ->
                set.representations.any { it.format.drmInitData != null }
            }
        ) {
            throw IOException("No se pueden grabar streams DASH protegidos por DRM.")
        }
        if (Regex("<(?:[\\w.-]+:)?(?:SegmentTemplate|SegmentList)\\b", RegexOption.IGNORE_CASE)
                .containsMatchIn(manifestText)
        ) {
            if (Regex("<(?:[\\w.-]+:)?SegmentBase\\b", RegexOption.IGNORE_CASE).containsMatchIn(manifestText)) {
                throw IOException("No se puede mezclar SegmentBase con SegmentTemplate/SegmentList en una grabación DASH.")
            }
            return copySegmentedDash(parsed, request, recording)
        }

        val baseUrlPattern = Regex(
            "(<(?:[\\w.-]+:)?BaseURL(?:\\s[^>]*)?>)([^<]*)(</(?:[\\w.-]+:)?BaseURL\\s*>)",
            RegexOption.IGNORE_CASE,
        )
        val matches = baseUrlPattern.findAll(manifestText).toList()
        if (matches.isEmpty()) throw IOException("El manifiesto DASH no declara recursos BaseURL grabables.")
        if (Regex("<(?:[\\w.-]+:)?ContentProtection\\b", RegexOption.IGNORE_CASE).containsMatchIn(manifestText)) {
            throw IOException("No se pueden grabar streams DASH protegidos por DRM.")
        }

        val resourcesDirectory = dashResourcesDirectory(recording.file)
        resourcesDirectory.deleteRecursively()
        if (!resourcesDirectory.mkdirs()) throw IOException("No se pudo crear la carpeta de la grabación DASH.")

        val copiedResources = linkedMapOf<String, String>()
        matches.forEach { match ->
            val base = match.groupValues[2].trim()
            if (base.isBlank()) throw IOException("El manifiesto DASH contiene un BaseURL vacío.")
            val resolved = java.net.URI(request.uri).resolve(base).toString()
            copiedResources.getOrPut(resolved) {
                val remoteName = resolved.substringBefore('?').substringBefore('#').substringAfterLast('/')
                val safeName = remoteName.replace(Regex("[^\\p{L}\\p{N}._-]"), "_")
                    .take(100).ifBlank { "media-${copiedResources.size}.mp4" }
                val uniqueName = if (safeName in copiedResources.values) "${copiedResources.size}-$safeName" else safeName
                val body = fetchBytes(request, resolved)
                if (body.isEmpty()) throw IOException("El servidor devolvió un recurso DASH vacío.")
                File(resourcesDirectory, uniqueName).outputStream().use { it.write(body) }
                uniqueName
            }
        }

        val namesByBase = matches.associate { match ->
            val base = match.groupValues[2].trim()
            val resolved = java.net.URI(request.uri).resolve(base).toString()
            base to "${resourcesDirectory.name}/${copiedResources.getValue(resolved)}"
        }
        val offlineManifest = baseUrlPattern.replace(manifestText) { match ->
            val local = namesByBase[match.groupValues[2].trim()]
                ?: throw IOException("No se pudo resolver un recurso DASH.")
            "${match.groupValues[1]}$local${match.groupValues[3]}"
        }
        recording.file.writeText(offlineManifest)
        return true
    }

    private data class DynamicDashTrack(
        val key: String,
        val type: Int,
        var representation: Representation,
        var initializationFile: String? = null,
        val segments: MutableList<LocalDashSegment> = mutableListOf(),
        val seenTimes: MutableSet<Long> = mutableSetOf(),
    )

    private suspend fun copyDynamicDash(
        initialManifest: androidx.media3.exoplayer.dash.manifest.DashManifest,
        request: TvPlaybackRequest,
        recording: TvRecording,
        initialText: String,
    ): Boolean {
        fun validateSnapshot(text: String, manifest: androidx.media3.exoplayer.dash.manifest.DashManifest) {
            if (manifest.periodCount != 1) throw IOException("La grabación DASH dinámico requiere un único periodo activo.")
            if (Regex("<(?:[\\w.-]+:)?ContentProtection\\b", RegexOption.IGNORE_CASE).containsMatchIn(text)) {
                throw IOException("No se pueden grabar streams DASH protegidos por DRM.")
            }
            if (!Regex("<(?:[\\w.-]+:)?(?:SegmentTemplate|SegmentList)\\b", RegexOption.IGNORE_CASE).containsMatchIn(text) ||
                Regex("<(?:[\\w.-]+:)?SegmentBase\\b", RegexOption.IGNORE_CASE).containsMatchIn(text)
            ) {
                throw IOException("DASH dinámico requiere SegmentTemplate o SegmentList sin DRM ni SegmentBase.")
            }
        }

        validateSnapshot(initialText, initialManifest)
        val resourcesDirectory = dashResourcesDirectory(recording.file)
        resourcesDirectory.deleteRecursively()
        if (!resourcesDirectory.mkdirs()) throw IOException("No se pudo crear la carpeta de la grabación DASH.")

        val captures = linkedMapOf<String, DynamicDashTrack>()
        var manifest = initialManifest
        var manifestText = initialText
        var refreshFailures = 0
        var completed = false
        while (!completed) {
            validateSnapshot(manifestText, manifest)
            val period = manifest.getPeriod(0)
            val periodDurationUs = manifest.getPeriodDurationUs(0)
            val selected = period.adaptationSets.mapIndexedNotNull { adaptationIndex, adaptation ->
                val type = adaptation.type
                if (type != C.TRACK_TYPE_VIDEO && type != C.TRACK_TYPE_AUDIO) return@mapIndexedNotNull null
                val representation = adaptation.representations.maxByOrNull { it.format.bitrate }
                    ?: return@mapIndexedNotNull null
                val stableId = representation.format.id ?: "rep-$adaptationIndex"
                Triple("$type:$adaptationIndex:${adaptation.id}:$stableId", type, representation)
            }
            if (selected.none { it.second == C.TRACK_TYPE_VIDEO }) {
                throw IOException("El manifiesto DASH dinámico no contiene una pista de vídeo grabable.")
            }

            selected.forEach { (key, type, representation) ->
                val capture = captures.getOrPut(key) { DynamicDashTrack(key, type, representation) }
                capture.representation = representation
                val index = representation.index
                    ?: throw IOException("Una pista DASH dinámica no tiene índice de segmentos.")
                val baseUrl = representation.baseUrls.firstOrNull()?.url
                    ?: throw IOException("Una pista DASH dinámica no tiene URL base.")
                if (capture.initializationFile == null) {
                    representation.getInitializationUri()?.let { range ->
                        val name = "track-${captures.keys.indexOf(key)}-init.mp4"
                        try {
                            writeDashResource(request, range, baseUrl, File(resourcesDirectory, name))
                            capture.initializationFile = name
                        } catch (error: Exception) {
                            File(resourcesDirectory, name).delete()
                            if (!stopRequested) throw error
                        }
                    }
                }

                val firstAvailable = index.getFirstAvailableSegmentNum(periodDurationUs, System.currentTimeMillis())
                var availableCount = index.getAvailableSegmentCount(periodDurationUs, System.currentTimeMillis())
                if (availableCount <= 0L || availableCount == DashSegmentIndex.INDEX_UNBOUNDED.toLong()) {
                    val definedCount = index.getSegmentCount(periodDurationUs)
                    if (definedCount > 0L && definedCount != DashSegmentIndex.INDEX_UNBOUNDED.toLong()) {
                        availableCount = definedCount
                    }
                }
                if (availableCount <= 0L) return@forEach
                if (availableCount > MAX_DYNAMIC_DASH_WINDOW_SEGMENTS) {
                    throw IOException("La ventana DASH dinámica excede el límite de segmentos grabables.")
                }
                val lastAvailable = firstAvailable + availableCount - 1L
                val previousTimeUs = capture.segments.maxOfOrNull { it.timeUs } ?: Long.MIN_VALUE
                val firstToRead = if (capture.segments.isEmpty()) lastAvailable else firstAvailable
                for (number in firstToRead..lastAvailable) {
                    val timeUs = index.getTimeUs(number)
                    if (timeUs <= previousTimeUs || !capture.seenTimes.add(timeUs)) continue
                    val range = index.getSegmentUrl(number)
                    val name = "track-${captures.keys.indexOf(key)}-segment-${capture.segments.size.toString().padStart(6, '0')}.m4s"
                    val durationUs = index.getDurationUs(number, periodDurationUs)
                    try {
                        writeDashResource(request, range, baseUrl, File(resourcesDirectory, name))
                    } catch (error: Exception) {
                        capture.seenTimes.remove(timeUs)
                        File(resourcesDirectory, name).delete()
                        if (stopRequested) break
                        throw error
                    }
                    capture.segments += LocalDashSegment(timeUs, durationUs.coerceAtLeast(1L), name)
                    publishProgress(recording.startedAtMs)
                    if (stopRequested) break
                }
            }

            if (stopRequested || !manifest.dynamic) {
                completed = true
            } else {
                val updateInterval = manifest.minUpdatePeriodMs.takeIf { it > 0L }?.coerceIn(500L, 5_000L) ?: 1_500L
                var waitRemaining = updateInterval
                while (waitRemaining > 0L && !stopRequested) {
                    val slice = minOf(waitRemaining, 200L)
                    delay(slice)
                    waitRemaining -= slice
                }
                if (stopRequested) {
                    completed = true
                } else {
                    try {
                        val updatedBytes = fetchBytes(request, request.uri)
                        val updatedText = updatedBytes.toString(Charsets.UTF_8)
                        val updatedManifest = DashManifestParser().parse(Uri.parse(request.uri), ByteArrayInputStream(updatedBytes))
                        validateSnapshot(updatedText, updatedManifest)
                        manifestText = updatedText
                        manifest = updatedManifest
                        refreshFailures = 0
                    } catch (error: Exception) {
                        if (stopRequested) {
                            completed = true
                        } else if (++refreshFailures >= MAX_DYNAMIC_DASH_REFRESH_FAILURES) {
                            throw IOException("No se pudo actualizar el manifiesto DASH tras varios intentos.", error)
                        } else {
                            delay(500L)
                        }
                    }
                }
            }
        }

        val tracks = captures.values.mapNotNull { capture ->
            if (capture.segments.isEmpty()) return@mapNotNull null
            LocalDashTrack(
                type = capture.type,
                representation = capture.representation,
                initializationFile = capture.initializationFile,
                segments = capture.segments.sortedBy { it.timeUs },
            )
        }
        if (tracks.none { it.type == C.TRACK_TYPE_VIDEO && it.segments.isNotEmpty() }) {
            throw IOException("No se recibió ningún segmento de vídeo DASH antes de detener la grabación.")
        }
        val firstTimeUs = tracks.flatMap { it.segments }.minOf { it.timeUs }
        val endTimeUs = tracks.flatMap { it.segments }.maxOf { it.timeUs + it.durationUs }
        val durationMs = TimeUnit.MICROSECONDS.toMillis((endTimeUs - firstTimeUs).coerceAtLeast(1L)).coerceAtLeast(1L)
        recording.file.writeText(buildOfflineDashManifest(durationMs, tracks, resourcesDirectory.name))
        return true
    }

    private data class LocalDashSegment(val timeUs: Long, val durationUs: Long, val fileName: String)

    private data class LocalDashTrack(
        val type: Int,
        val representation: Representation,
        val initializationFile: String?,
        val segments: List<LocalDashSegment>,
    )

    private suspend fun copySegmentedDash(
        manifest: androidx.media3.exoplayer.dash.manifest.DashManifest,
        request: TvPlaybackRequest,
        recording: TvRecording,
    ): Boolean {
        val period = manifest.getPeriod(0)
        val periodDurationUs = manifest.getPeriodDurationUs(0)
        if (periodDurationUs <= 0L || periodDurationUs == C.TIME_UNSET) {
            throw IOException("El manifiesto DASH no tiene una duración estática válida.")
        }
        val selected = period.adaptationSets.mapNotNull { adaptation ->
            val type = adaptation.type
            if (type != C.TRACK_TYPE_VIDEO && type != C.TRACK_TYPE_AUDIO) return@mapNotNull null
            val representation = adaptation.representations.maxByOrNull { it.format.bitrate }
                ?: return@mapNotNull null
            type to representation
        }
        if (selected.none { it.first == C.TRACK_TYPE_VIDEO }) {
            throw IOException("El manifiesto DASH no contiene una pista de vídeo grabable.")
        }

        val resourcesDirectory = dashResourcesDirectory(recording.file)
        resourcesDirectory.deleteRecursively()
        if (!resourcesDirectory.mkdirs()) throw IOException("No se pudo crear la carpeta de la grabación DASH.")

        val tracks = selected.mapIndexed { trackIndex, (type, representation) ->
            val index: DashSegmentIndex = representation.index
                ?: throw IOException("Una pista DASH no tiene índice de segmentos.")
            val segmentCount = index.getSegmentCount(periodDurationUs)
            if (segmentCount <= 0L || segmentCount > MAX_DASH_SEGMENTS) {
                throw IOException("El índice DASH no tiene un número finito de segmentos compatible con una grabación.")
            }
            val baseUrl = representation.baseUrls.firstOrNull()?.url
                ?: throw IOException("Una pista DASH no tiene URL base.")
            val initializationFile = representation.getInitializationUri()?.let { range ->
                val name = "track-$trackIndex-init.mp4"
                writeDashResource(request, range, baseUrl, File(resourcesDirectory, name))
                name
            }
            val firstSegment = index.getFirstSegmentNum()
            val segments = (firstSegment until firstSegment + segmentCount).map { number ->
                val range = index.getSegmentUrl(number)
                val name = "track-$trackIndex-segment-${number - firstSegment}.m4s"
                writeDashResource(request, range, baseUrl, File(resourcesDirectory, name))
                LocalDashSegment(
                    timeUs = index.getTimeUs(number).coerceAtLeast(0L),
                    durationUs = index.getDurationUs(number, periodDurationUs).coerceAtLeast(1L),
                    fileName = name,
                )
            }
            LocalDashTrack(type, representation, initializationFile, segments)
        }
        val durationMs = TimeUnit.MICROSECONDS.toMillis(periodDurationUs).coerceAtLeast(1L)
        recording.file.writeText(buildOfflineDashManifest(durationMs, tracks, resourcesDirectory.name))
        return true
    }

    private suspend fun writeDashResource(
        request: TvPlaybackRequest,
        range: androidx.media3.exoplayer.dash.manifest.RangedUri,
        baseUrl: String,
        outputFile: File,
    ) {
        val byteRange = if (range.length > 0L) TvHlsByteRange(range.length, range.start) else null
        val bytes = fetchBytes(request, range.resolveUriString(baseUrl), byteRange)
        if (bytes.isEmpty()) throw IOException("El servidor devolvió un segmento DASH vacío.")
        outputFile.outputStream().use { it.write(bytes) }
        val startedAtMs = synchronized(this) { _active.value?.startedAtMs }
        if (startedAtMs != null) publishProgress(startedAtMs)
    }

    private fun buildOfflineDashManifest(durationMs: Long, tracks: List<LocalDashTrack>, directory: String): String =
        buildString {
            append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>")
            append("<MPD xmlns=\"urn:mpeg:dash:schema:mpd:2011\" type=\"static\"")
            append(" mediaPresentationDuration=\"").append(dashDuration(durationMs)).append("\">")
            append("<Period id=\"0\" duration=\"").append(dashDuration(durationMs)).append("\">")
        tracks.forEachIndexed { trackIndex, track ->
                val format = track.representation.format
                val typeName = if (track.type == C.TRACK_TYPE_VIDEO) "video" else "audio"
                val mime = format.sampleMimeType.orEmpty()
                append("<AdaptationSet id=\"").append(trackIndex).append("\" contentType=\"")
                    .append(typeName).append("\" mimeType=\"").append(xmlEscape(mime)).append("\">")
                append("<Representation id=\"").append(xmlEscape(format.id ?: "track-$trackIndex"))
                    .append("\" bandwidth=\"").append(format.bitrate.coerceAtLeast(1))
                    .append("\" mimeType=\"").append(xmlEscape(mime)).append("\"")
                format.codecs?.let { append(" codecs=\"").append(xmlEscape(it)).append("\"") }
                if (format.width > 0) append(" width=\"").append(format.width).append("\"")
                if (format.height > 0) append(" height=\"").append(format.height).append("\"")
                if (format.sampleRate > 0) append(" audioSamplingRate=\"").append(format.sampleRate).append("\"")
                append("><SegmentList timescale=\"1000000\">")
                track.initializationFile?.let {
                    append("<Initialization sourceURL=\"").append(directory).append('/').append(it).append("\"/>")
                }
                append("<SegmentTimeline>")
                val timelineOriginUs = tracks.flatMap { it.segments }.minOfOrNull { it.timeUs } ?: 0L
                track.segments.forEach { segment ->
                    append("<S t=\"").append((segment.timeUs - timelineOriginUs).coerceAtLeast(0L))
                        .append("\" d=\"").append(segment.durationUs).append("\"/>")
                }
                append("</SegmentTimeline>")
                track.segments.forEach { segment ->
                    append("<SegmentURL media=\"").append(directory).append('/').append(segment.fileName).append("\"/>")
                }
                append("</SegmentList></Representation></AdaptationSet>")
            }
            append("</Period></MPD>")
        }

    private fun dashDuration(durationMs: Long): String = "PT${durationMs.coerceAtLeast(1L) / 1000.0}S"

    private fun xmlEscape(value: String): String = value
        .replace("&", "&amp;")
        .replace("\"", "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")

    private val MAX_DASH_SEGMENTS = 100_000L
    private val MAX_DYNAMIC_DASH_WINDOW_SEGMENTS = 10_000L
    private val MAX_DYNAMIC_DASH_REFRESH_FAILURES = 5

    private suspend fun copyHls(request: TvPlaybackRequest, recording: TvRecording): Boolean {
        var playlistUrl = request.uri
        var playlist = fetchText(request, playlistUrl)

        // Resolve a master playlist once, preferring the highest advertised
        // bandwidth. Xtream panels commonly return a master even for live TV.
        while (playlist.contains("#EXT-X-STREAM-INF", ignoreCase = true)) {
            val variant = selectHlsVariant(playlist)
                ?: throw IOException("La playlist HLS no contiene una variante reproducible.")
            playlistUrl = resolveHlsUri(playlistUrl, variant)
            playlist = fetchText(request, playlistUrl)
        }

        var currentMediaPlaylist = parseTvHlsMediaPlaylist(playlist)
        val outputFile = if (currentMediaPlaylist.initMap != null) {
            recordingOutputFile(recording, "mp4")
        } else {
            recording.file
        }

        val seenSegments = linkedSetOf<Pair<Long, String>>()
        val keyCache = mutableMapOf<String, ByteArray>()
        var initSegment: TvHlsInitMap? = null
        outputFile.outputStream().use { output ->
            while (true) {
                if (stopRequested) return false
                val mediaPlaylist = currentMediaPlaylist
                val currentMap = mediaPlaylist.initMap?.let { map ->
                    map.copy(uri = resolveHlsUri(playlistUrl, map.uri))
                }
                if (currentMap != null && currentMap != initSegment) {
                    output.write(
                        fetchHlsResource(
                            request = request,
                            baseUrl = playlistUrl,
                            uri = currentMap.uri,
                            encryptionKey = currentMap.encryptionKey,
                            mediaSequence = null,
                            keyCache = keyCache,
                            initializationSection = true,
                            byteRange = currentMap.byteRange,
                        ),
                    )
                    initSegment = currentMap
                }

                var appended = false
                mediaPlaylist.segments.forEach { segment ->
                    val segmentUrl = resolveHlsUri(playlistUrl, segment.uri)
                    if (seenSegments.add(segment.sequence to segmentUrl)) {
                        if (mediaPlaylist.iFramesOnly && segment.byteRange != null && segment.encryptionKey != null) {
                            throw IOException("La grabación HLS todavía no admite rangos AES-128 en listas I-frame.")
                        }
                        output.write(
                            fetchHlsResource(
                                request = request,
                                baseUrl = playlistUrl,
                                uri = segmentUrl,
                                encryptionKey = segment.encryptionKey,
                                mediaSequence = segment.sequence,
                                keyCache = keyCache,
                                byteRange = segment.byteRange,
                            ),
                        )
                        output.flush()
                        publishProgress(recording.startedAtMs)
                        appended = true
                    }
                }

                if (mediaPlaylist.ended) return true
                // Live playlists slide their window. Poll even when no new
                // URL appeared yet; cancellation of delay is handled by the
                // recording Job when the user presses Detener.
                delay(if (appended) 1_500L else 2_500L)
                if (stopRequested) return false
                playlist = fetchText(request, playlistUrl)
                currentMediaPlaylist = parseTvHlsMediaPlaylist(playlist)
            }
        }
    }

    private suspend fun fetchHlsResource(
        request: TvPlaybackRequest,
        baseUrl: String,
        uri: String,
        encryptionKey: TvHlsEncryptionKey?,
        mediaSequence: Long?,
        keyCache: MutableMap<String, ByteArray>,
        initializationSection: Boolean = false,
        byteRange: TvHlsByteRange? = null,
    ): ByteArray {
        val key = encryptionKey ?: return fetchBytes(request, uri, byteRange)
        if (key.method != "AES-128") {
            throw IOException("El cifrado HLS ${key.method} no está disponible en Android TV.")
        }
        if (!key.keyFormat.equals("identity", ignoreCase = true)) {
            throw IOException("El formato de clave HLS ${key.keyFormat} no está disponible en Android TV.")
        }

        val keyUri = key.uri?.takeIf(String::isNotBlank)
            ?: throw IOException("La clave AES-128 HLS no especifica URI.")
        val resolvedKeyUri = resolveHlsUri(baseUrl, keyUri)
        val keyBytes = keyCache[resolvedKeyUri] ?: fetchBytes(request, resolvedKeyUri).also { fetchedKey ->
            if (fetchedKey.size != 16) throw IOException("La clave AES-128 HLS debe tener 16 bytes.")
            keyCache[resolvedKeyUri] = fetchedKey
        }
        val iv = key.iv?.let(::parseHlsIv) ?: when {
            mediaSequence != null -> hlsIvForSequence(mediaSequence)
            initializationSection -> throw IOException("El mapa HLS cifrado requiere un IV explícito.")
            else -> throw IOException("No se pudo determinar el IV del segmento HLS cifrado.")
        }
        val encryptedBytes = fetchBytes(request, uri, byteRange)

        return try {
            Cipher.getInstance("AES/CBC/PKCS5Padding").run {
                init(Cipher.DECRYPT_MODE, SecretKeySpec(keyBytes, "AES"), IvParameterSpec(iv))
                doFinal(encryptedBytes)
            }
        } catch (error: Exception) {
            throw IOException("No se pudo descifrar un segmento HLS AES-128.", error)
        }
    }

    private fun parseHlsIv(value: String): ByteArray {
        val hex = value.removePrefix("0x").removePrefix("0X")
        if (hex.isEmpty() || hex.length > 32 || !hex.all { it.digitToIntOrNull(16) != null }) {
            throw IOException("El IV de la clave HLS no es un valor hexadecimal de 128 bits.")
        }
        val padded = hex.padStart(32, '0')
        return ByteArray(16) { index -> padded.substring(index * 2, index * 2 + 2).toInt(16).toByte() }
    }

    private fun hlsIvForSequence(sequence: Long): ByteArray = ByteArray(16).also { iv ->
        var remaining = sequence
        for (index in 15 downTo 8) {
            iv[index] = remaining.toByte()
            remaining = remaining ushr 8
        }
    }

    private suspend fun fetchText(request: TvPlaybackRequest, url: String): String =
        fetchBytes(request, url).toString(Charsets.UTF_8)

    private suspend fun fetchBytes(
        request: TvPlaybackRequest,
        url: String,
        byteRange: TvHlsByteRange? = null,
    ): ByteArray =
        suspendCancellableCoroutine { continuation ->
            val httpRequest = Request.Builder().url(url).apply {
                request.userAgent?.takeIf(String::isNotBlank)?.let { header("User-Agent", it) }
                request.headers.forEach { (name, value) -> header(name, value) }
                byteRange?.let { header("Range", "bytes=${it.offset}-${it.endInclusive}") }
            }.build()
            val call = httpClient.newCall(httpRequest)
            synchronized(this) { activeCall = call }
            call.enqueue(object : okhttp3.Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (continuation.isActive) continuation.resumeWith(Result.failure(e))
                }

                override fun onResponse(call: Call, response: okhttp3.Response) {
                    response.use {
                        if (!response.isSuccessful) {
                            if (continuation.isActive) continuation.resumeWith(
                                Result.failure(IOException("HTTP ${response.code}")),
                            )
                            return
                        }
                        val body = response.body
                        if (body == null) {
                            if (continuation.isActive) continuation.resumeWith(
                                Result.failure(IOException("La respuesta no tiene contenido.")),
                            )
                            return
                        }
                        runCatching {
                            val bytes = body.bytes()
                            byteRange?.let { range ->
                                val expectedLength = range.length
                                when (response.code) {
                                    206 -> {
                                        val contentRange = response.header("Content-Range")
                                        val match = contentRange?.let { Regex("""^bytes (\d+)-(\d+)/(?:\d+|\*)$""").matchEntire(it.trim()) }
                                        if (match == null ||
                                            match.groupValues[1].toLongOrNull() != range.offset ||
                                            match.groupValues[2].toLongOrNull() != range.endInclusive
                                        ) {
                                            throw IOException("El servidor devolvió un Content-Range distinto al solicitado.")
                                        }
                                        if (bytes.size.toLong() != expectedLength) {
                                            throw IOException("El servidor devolvió un rango HLS incompleto.")
                                        }
                                        bytes
                                    }
                                    200 -> {
                                        if (range.endInclusive >= bytes.size.toLong()) {
                                            throw IOException("El servidor ignoró Range y el recurso no contiene el rango solicitado.")
                                        }
                                        bytes.copyOfRange(range.offset.toInt(), (range.endInclusive + 1L).toInt())
                                    }
                                    else -> throw IOException("HTTP ${response.code} al descargar un rango HLS.")
                                }
                            } ?: bytes
                        }.fold(
                            onSuccess = { if (continuation.isActive) continuation.resume(it) },
                            onFailure = { if (continuation.isActive) continuation.resumeWith(Result.failure(it)) },
                        )
                    }
                }
            })
            continuation.invokeOnCancellation { call.cancel() }
        }

    private fun selectHlsVariant(playlist: String): String? {
        var bestBandwidth = Long.MIN_VALUE
        var bestUri: String? = null
        val lines = playlist.lineSequence().map(String::trim).toList()
        lines.forEachIndexed { index, line ->
            if (!line.startsWith("#EXT-X-STREAM-INF", ignoreCase = true)) return@forEachIndexed
            val bandwidth = Regex("(?:AVERAGE-BANDWIDTH|BANDWIDTH)=(\\d+)")
                .find(line)?.groupValues?.getOrNull(1)?.toLongOrNull() ?: 0L
            val uri = lines.drop(index + 1).firstOrNull { it.isNotEmpty() && !it.startsWith("#") }
            if (uri != null && bandwidth >= bestBandwidth) {
                bestBandwidth = bandwidth
                bestUri = uri
            }
        }
        return bestUri
    }

    private fun resolveHlsUri(baseUrl: String, child: String): String =
        runCatching { URI(baseUrl).resolve(child).toString() }.getOrElse { child }

    private fun recordingOutputFile(recording: TvRecording, extension: String): File {
        val output = if (recording.file.extension.equals(extension, ignoreCase = true)) {
            recording.file
        } else {
            File(recording.file.parentFile, "${recording.file.nameWithoutExtension}.$extension")
        }
        if (output != recording.file) {
            synchronized(this) {
                val activeRecording = _active.value
                if (activeRecording?.startedAtMs == recording.startedAtMs) {
                    _active.value = activeRecording.copy(file = output)
                }
            }
        }
        return output
    }

    private fun directStreamExtension(contentType: String?, url: String): String {
        val mime = contentType?.substringBefore(';')?.trim()?.lowercase(Locale.US)
        return when (mime) {
            "video/mp4", "application/mp4" -> "mp4"
            "video/mp2t", "application/mp2t" -> "ts"
            "video/webm" -> "webm"
            "video/x-matroska" -> "mkv"
            else -> url.substringBefore('?').substringBefore('#').substringAfterLast('.', "")
                .lowercase(Locale.US)
                .takeIf { it in setOf("mp4", "ts", "webm", "mkv") }
                ?: "ts"
        }
    }

    private fun recordingBytes(file: File): Long =
        file.length() + dashResourcesDirectory(file).takeIf(File::isDirectory)
            ?.walkTopDown()?.filter(File::isFile)?.sumOf(File::length).orZero()

    private fun publishProgress(startedAtMs: Long) {
        synchronized(this) {
            val activeRecording = _active.value ?: return
            if (activeRecording.startedAtMs != startedAtMs || activeRecording.status != TvRecordingStatus.RECORDING) return
            _active.value = activeRecording.copy(bytes = recordingBytes(activeRecording.file))
        }
    }

    private fun dashResourcesDirectory(file: File): File =
        File(file.parentFile, "${file.nameWithoutExtension}.dash")

    private fun deleteRecordingFiles(file: File) {
        file.delete()
        dashResourcesDirectory(file).deleteRecursively()
    }

    private fun Long?.orZero(): Long = this ?: 0L

    private fun isHlsManifest(url: String): Boolean =
        url.substringBefore('?').substringBefore('#').endsWith(".m3u8", ignoreCase = true)

    override fun close() {
        synchronized(this) {
            activeCall?.cancel()
            scope.cancel()
            activeCall = null
            activeJob = null
        }
    }

    companion object {
        internal fun isDashStream(request: TvPlaybackRequest): Boolean =
            request.mimeType.equals("application/dash+xml", ignoreCase = true) ||
                request.uri.substringBefore('?').substringBefore('#').endsWith(".mpd", ignoreCase = true)

        internal fun safeFileName(title: String): String {
            val normalized = title.trim().replace(Regex("[^\\p{L}\\p{N}._-]+"), "_")
            return normalized.trim('_').take(80).ifBlank { "iptvnator-recording" }
        }
    }
}

/** Small durable index for recordings; stream URLs are intentionally never persisted. */
class TvRecordingHistory(private val preferences: SharedPreferences) {
    fun load(): List<TvRecording> = runCatching {
        val rows = JSONArray(preferences.getString(KEY, "[]") ?: "[]")
        (0 until rows.length()).mapNotNull { index ->
            rows.optJSONObject(index)?.let { row ->
                val file = File(row.optString("file"))
                if (!file.isFile) return@let null
                TvRecording(
                    file = file,
                    title = row.optString("title", file.nameWithoutExtension),
                    startedAtMs = row.optLong("startedAtMs"),
                    endedAtMs = row.optLong("endedAtMs").takeIf { it > 0L },
                    status = runCatching { TvRecordingStatus.valueOf(row.optString("status")) }
                        .getOrDefault(TvRecordingStatus.COMPLETED),
                    bytes = row.optLong("bytes", file.length()),
                    error = row.optString("error").takeIf { it.isNotBlank() },
                )
            }
        }
    }.getOrDefault(emptyList())

    fun add(recording: TvRecording) {
        if (!recording.file.isFile || recording.bytes <= 0L) return
        val rows = load().filterNot { it.file.absolutePath == recording.file.absolutePath }.toMutableList()
        rows.add(0, recording.copy(sourceUri = ""))
        save(rows)
    }

    fun remove(recording: TvRecording) {
        save(load().filterNot { it.file.absolutePath == recording.file.absolutePath })
    }

    private fun save(recordings: List<TvRecording>) {
        val rows = JSONArray()
        recordings.forEach { recording ->
            rows.put(JSONObject().apply {
                put("file", recording.file.absolutePath)
                put("title", recording.title)
                put("startedAtMs", recording.startedAtMs)
                put("endedAtMs", recording.endedAtMs ?: JSONObject.NULL)
                put("status", recording.status.name)
                put("bytes", recording.bytes)
                put("error", recording.error ?: JSONObject.NULL)
            })
        }
        preferences.edit().putString(KEY, rows.toString()).apply()
    }

    companion object {
        private const val KEY = "recordings"

        fun deleteFiles(file: File) {
            file.delete()
            File(file.parentFile, "${file.nameWithoutExtension}.dash").deleteRecursively()
        }
    }
}
