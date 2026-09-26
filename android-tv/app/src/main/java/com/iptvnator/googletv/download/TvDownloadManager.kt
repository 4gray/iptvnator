package com.iptvnator.googletv.download

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import com.iptvnator.googletv.playlist.TvVodItem
import com.iptvnator.googletv.xtream.XtreamApiClient

data class TvDownloadSnapshot(
    val id: Long,
    val title: String?,
    val status: Int,
    val progressPercent: Int?,
    val reason: Int?,
    val localUri: String?,
    val supportsResume: Boolean = false,
)

data class TvDownloadRecord(
    val downloadId: Long,
    val playlistId: String,
    val vodId: Int,
    val title: String,
    val createdAt: Long,
    /** `vod`, `series-episode`, `m3u` or finite `catchup`; old records default to `vod`. */
    val contentType: String = "vod",
    val seriesId: Int? = null,
    val episodeId: Int? = null,
    val itemKey: String? = null,
    val catchupStartMs: Long? = null,
    val catchupEndMs: Long? = null,
    val cancelled: Boolean = false,
)

class TvDownloadHistory(private val preferences: SharedPreferences) {
    fun load(): List<TvDownloadRecord> = runCatching {
        val rows = JSONArray(preferences.getString(KEY, "[]") ?: "[]")
        (0 until rows.length()).mapNotNull { index ->
            rows.optJSONObject(index)?.let { row ->
                TvDownloadRecord(
                    downloadId = row.getLong("downloadId"),
                    playlistId = row.getString("playlistId"),
                    vodId = row.getInt("vodId"),
                    title = row.getString("title"),
                    createdAt = row.optLong("createdAt"),
                    contentType = row.optString("contentType", "vod"),
                    seriesId = if (row.has("seriesId") && !row.isNull("seriesId")) row.optInt("seriesId") else null,
                    episodeId = if (row.has("episodeId") && !row.isNull("episodeId")) row.optInt("episodeId") else null,
                    itemKey = row.optString("itemKey").takeIf { it.isNotBlank() },
                    catchupStartMs = if (row.has("catchupStartMs") && !row.isNull("catchupStartMs")) row.optLong("catchupStartMs") else null,
                    catchupEndMs = if (row.has("catchupEndMs") && !row.isNull("catchupEndMs")) row.optLong("catchupEndMs") else null,
                    cancelled = row.optBoolean("cancelled", false),
                )
            }
        }
    }.getOrDefault(emptyList())

    fun add(record: TvDownloadRecord) {
        val rows = load().filterNot { it.downloadId == record.downloadId }.toMutableList()
        rows.add(0, record)
        save(rows)
    }

    fun remove(downloadId: Long) {
        save(load().filterNot { it.downloadId == downloadId })
    }

    fun removeAll(downloadIds: Set<Long>) {
        if (downloadIds.isEmpty()) return
        save(load().filterNot { it.downloadId in downloadIds })
    }

    private fun save(records: List<TvDownloadRecord>) {
        val rows = JSONArray()
        records.forEach { record -> rows.put(JSONObject().apply {
            put("downloadId", record.downloadId)
            put("playlistId", record.playlistId)
            put("vodId", record.vodId)
            put("title", record.title)
            put("createdAt", record.createdAt)
            put("contentType", record.contentType)
            put("seriesId", record.seriesId ?: JSONObject.NULL)
            put("episodeId", record.episodeId ?: JSONObject.NULL)
            put("itemKey", record.itemKey ?: JSONObject.NULL)
            put("catchupStartMs", record.catchupStartMs ?: JSONObject.NULL)
            put("catchupEndMs", record.catchupEndMs ?: JSONObject.NULL)
            put("cancelled", record.cancelled)
        }) }
        preferences.edit().putString(KEY, rows.toString()).apply()
    }

    companion object {
        private const val KEY = "downloads"
    }
}

/** Queues already-resolved VOD URLs. Provider-minted Stalker links must be resolved by the repository first. */
class TvDownloadManager(context: Context) {
    private val appContext = context.applicationContext
    private val manager = appContext.getSystemService(DownloadManager::class.java)
    private val taskStore = TvDownloadTaskStore(appContext)

    fun enqueue(item: TvVodItem): Long {
        require(item.providerCommand == null) { "Este VOD requiere un enlace efímero del proveedor y no se puede descargar." }
        return enqueueUrl(
            item.url,
            item.name,
            item.extension,
            userAgent = if (item.providerType == "xtream") XtreamApiClient.ClientUserAgent else null,
        )
    }

    fun enqueueUrl(
        url: String,
        title: String,
        extensionHint: String? = null,
        userAgent: String? = null,
        headers: Map<String, String> = emptyMap(),
    ): Long {
        val uri = Uri.parse(url)
        require(uri.scheme.equals("http", true) || uri.scheme.equals("https", true)) {
            "Solo se pueden descargar URLs HTTP o HTTPS directas."
        }
        val extension = extensionHint.orEmpty().trim()
            .ifBlank { uri.lastPathSegment?.substringAfterLast('.', "mp4") ?: "mp4" }
        val task = taskStore.create(
            TvDownloadRequest(url, title, extension, userAgent, normalizedDownloadHeaders(userAgent, headers)),
        )
        TvDownloadService.submit(appContext, TvDownloadService.ACTION_ENQUEUE, task.id)
        return task.id
    }

    fun query(id: Long): TvDownloadSnapshot? {
        taskStore.get(id)?.let { task ->
            val percent = task.totalBytes?.takeIf { it > 0 }
                ?.let { ((task.downloadedBytes * 100) / it).toInt().coerceIn(0, 100) }
            val localUri = if (task.status == DownloadManager.STATUS_SUCCESSFUL) {
                Uri.fromFile(taskStore.completedFile(task)).toString()
            } else null
            return TvDownloadSnapshot(
                id = id,
                title = task.title,
                status = task.status,
                progressPercent = percent,
                reason = null,
                localUri = localUri,
                supportsResume = true,
            )
        }
        return manager.query(DownloadManager.Query().setFilterById(id)).use { cursor ->
        if (!cursor.moveToFirst()) return null
        val downloaded = cursor.getLongOrNull(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)
        val total = cursor.getLongOrNull(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)
        TvDownloadSnapshot(
            id = id,
            title = cursor.getStringOrNull(DownloadManager.COLUMN_TITLE),
            status = cursor.getIntOrNull(DownloadManager.COLUMN_STATUS) ?: DownloadManager.STATUS_FAILED,
            progressPercent = if (downloaded != null && total != null && total > 0) {
                ((downloaded * 100) / total).toInt().coerceIn(0, 100)
            } else null,
            reason = cursor.getIntOrNull(DownloadManager.COLUMN_REASON),
            localUri = cursor.getStringOrNull(DownloadManager.COLUMN_LOCAL_URI),
        )
        }
    }

    fun isCustom(id: Long): Boolean = taskStore.get(id) != null

    /** Restarts durable queued/running jobs after Android has recreated the app process. */
    fun recoverInterruptedDownloads(): Boolean {
        val hasRecoverableTasks = taskStore.all().any {
            it.status == DownloadManager.STATUS_PENDING || it.status == DownloadManager.STATUS_RUNNING
        }
        if (hasRecoverableTasks) {
            TvDownloadService.submit(appContext, TvDownloadService.ACTION_RECOVER, -1L)
        }
        return hasRecoverableTasks
    }

    fun pause(id: Long): Boolean {
        val task = taskStore.get(id) ?: return false
        if (task.status != DownloadManager.STATUS_PENDING && task.status != DownloadManager.STATUS_RUNNING) return false
        taskStore.update(id, status = DownloadManager.STATUS_PAUSED)
        TvDownloadService.submit(appContext, TvDownloadService.ACTION_PAUSE, id)
        return true
    }

    fun resume(id: Long): Boolean {
        val task = taskStore.get(id) ?: return false
        if (task.status != DownloadManager.STATUS_PAUSED) return false
        taskStore.update(id, status = DownloadManager.STATUS_PENDING, replaceError = true)
        TvDownloadService.submit(appContext, TvDownloadService.ACTION_RESUME, id)
        return true
    }

    fun retry(id: Long, url: String, extension: String?, userAgent: String?, headers: Map<String, String>): Boolean {
        val old = taskStore.get(id) ?: return false
        if (old.status != DownloadManager.STATUS_FAILED && old.status != DownloadManager.STATUS_PAUSED) return false
        val uri = Uri.parse(url)
        require(uri.scheme.equals("http", true) || uri.scheme.equals("https", true)) {
            "Solo se pueden descargar URLs HTTP o HTTPS directas."
        }
        val replacement = taskStore.replaceRequest(
            id,
            TvDownloadRequest(
                url,
                old.title,
                extension.orEmpty().ifBlank { uri.lastPathSegment?.substringAfterLast('.', "mp4") ?: "mp4" },
                userAgent,
                normalizedDownloadHeaders(userAgent, headers),
            ),
        ) ?: return false
        TvDownloadService.submit(appContext, TvDownloadService.ACTION_RESUME, replacement.id)
        return true
    }

    fun forget(id: Long, deleteFile: Boolean = false) {
        taskStore.forget(id, deleteFiles = deleteFile)
    }

    fun cancel(id: Long): Boolean {
        if (taskStore.get(id) != null) {
            taskStore.update(id, status = DownloadManager.STATUS_FAILED, error = "cancelled", replaceError = true)
            TvDownloadService.submit(appContext, TvDownloadService.ACTION_CANCEL, id)
            return true
        }
        return manager.remove(id) > 0
    }

    private fun android.database.Cursor.getStringOrNull(column: String): String? =
        getColumnIndex(column).takeIf { it >= 0 }?.let { index -> if (isNull(index)) null else getString(index) }

    private fun android.database.Cursor.getLongOrNull(column: String): Long? =
        getColumnIndex(column).takeIf { it >= 0 }?.let { index -> if (isNull(index)) null else getLong(index) }

    private fun android.database.Cursor.getIntOrNull(column: String): Int? =
        getColumnIndex(column).takeIf { it >= 0 }?.let { index -> if (isNull(index)) null else getInt(index) }

}
