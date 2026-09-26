package com.iptvnator.googletv.download

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

internal data class TvDownloadRequest(
    val url: String,
    val title: String,
    val extension: String,
    val userAgent: String?,
    val headers: Map<String, String>,
) {
    companion object
}

internal data class TvStoredDownload(
    val id: Long,
    val title: String,
    val extension: String,
    val createdAt: Long,
    val status: Int,
    val downloadedBytes: Long,
    val totalBytes: Long?,
    val validator: String?,
    val encryptedRequest: String,
    val error: String? = null,
)

/** Durable task metadata and app-private partial/completed files for the foreground transfer service. */
internal class TvDownloadTaskStore(context: Context) {
    private val app = context.applicationContext
    private val preferences = app.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    private val vault = TvDownloadTaskVault()
    private val movies = app.getExternalFilesDir(Environment.DIRECTORY_MOVIES) ?: File(app.filesDir, "Movies")
    private val lock = Any()

    fun create(request: TvDownloadRequest): TvStoredDownload = synchronized(lock) {
        val id = nextId()
        val task = TvStoredDownload(
            id = id,
            title = request.title,
            extension = normalizeExtension(request.extension),
            createdAt = System.currentTimeMillis(),
            status = DownloadManager.STATUS_PENDING,
            downloadedBytes = 0,
            totalBytes = null,
            validator = null,
            encryptedRequest = vault.seal(request.toJson()),
        )
        write(load() + task)
        task
    }

    fun get(id: Long): TvStoredDownload? = synchronized(lock) { load().firstOrNull { it.id == id } }
    fun all(): List<TvStoredDownload> = synchronized(lock) { load() }
    fun request(task: TvStoredDownload): TvDownloadRequest = TvDownloadRequest.fromJson(vault.open(task.encryptedRequest))

    /** Puts in-flight rows back in the durable queue before service teardown cancels their sockets. */
    fun returnRunningTasksToQueue() = synchronized(lock) {
        write(load().map { task ->
            if (task.status == DownloadManager.STATUS_RUNNING) {
                task.copy(status = DownloadManager.STATUS_PENDING)
            } else task
        })
    }

    fun update(
        id: Long,
        status: Int? = null,
        downloadedBytes: Long? = null,
        totalBytes: Long? = null,
        validator: String? = null,
        error: String? = null,
        replaceValidator: Boolean = false,
        replaceTotal: Boolean = false,
        replaceError: Boolean = false,
    ) = synchronized(lock) {
        write(load().map { old ->
            if (old.id != id) old else old.copy(
                status = status ?: old.status,
                downloadedBytes = downloadedBytes ?: old.downloadedBytes,
                totalBytes = if (replaceTotal) totalBytes else totalBytes ?: old.totalBytes,
                validator = if (replaceValidator) validator else validator ?: old.validator,
                error = if (replaceError) error else error ?: old.error,
            )
        })
    }

    fun replaceRequest(id: Long, request: TvDownloadRequest): TvStoredDownload? = synchronized(lock) {
        var result: TvStoredDownload? = null
        write(load().map { old ->
            if (old.id != id) old else old.copy(
                encryptedRequest = vault.seal(request.toJson()),
                status = DownloadManager.STATUS_PENDING,
                error = null,
            ).also { result = it }
        })
        result
    }

    fun forget(id: Long, deleteFiles: Boolean) = synchronized(lock) {
        val task = load().firstOrNull { it.id == id }
        write(load().filterNot { it.id == id })
        if (deleteFiles && task != null) {
            runCatching { partialFile(task).delete() }
            runCatching { completedFile(task).delete() }
        }
    }

    fun partialFile(task: TvStoredDownload): File = File(movies, "${fileStem(task)}.${task.extension}.part")
    fun completedFile(task: TvStoredDownload): File = File(movies, "${fileStem(task)}.${task.extension}")
    fun markComplete(task: TvStoredDownload): String {
        movies.mkdirs()
        val partial = partialFile(task)
        val target = completedFile(task)
        if (!partial.exists()) throw IllegalStateException("No existe el archivo parcial de la descarga.")
        if (target.exists() && !target.delete()) throw IllegalStateException("No se pudo reemplazar el archivo final.")
        if (!partial.renameTo(target)) throw IllegalStateException("No se pudo finalizar el archivo descargado.")
        val uri = Uri.fromFile(target).toString()
        update(task.id, status = DownloadManager.STATUS_SUCCESSFUL, downloadedBytes = target.length(), totalBytes = target.length(), replaceTotal = true, replaceError = true)
        return uri
    }

    private fun nextId(): Long {
        val id = preferences.getLong(NEXT_ID, FIRST_ID)
        preferences.edit().putLong(NEXT_ID, id + 1).commit()
        return id
    }

    private fun fileStem(task: TvStoredDownload): String {
        val safe = task.title.replace(Regex("[^a-zA-Z0-9._-]+"), "_").trim('_').take(72).ifBlank { "iptvnator-download" }
        return "$safe-${task.id}"
    }

    private fun normalizeExtension(extension: String): String =
        extension.trim().trimStart('.').lowercase().filter { it.isLetterOrDigit() }.take(10).ifBlank { "mp4" }

    private fun load(): List<TvStoredDownload> = runCatching {
        val json = JSONArray(preferences.getString(TASKS, "[]") ?: "[]")
        (0 until json.length()).mapNotNull { index -> json.optJSONObject(index)?.toTask() }
    }.getOrDefault(emptyList())

    private fun write(tasks: List<TvStoredDownload>) {
        val json = JSONArray()
        tasks.forEach { json.put(it.toJson()) }
        preferences.edit().putString(TASKS, json.toString()).commit()
    }

    private fun TvStoredDownload.toJson() = JSONObject()
        .put("id", id).put("title", title).put("extension", extension).put("createdAt", createdAt)
        .put("status", status).put("downloadedBytes", downloadedBytes)
        .put("totalBytes", totalBytes ?: JSONObject.NULL).put("validator", validator ?: JSONObject.NULL)
        .put("encryptedRequest", encryptedRequest).put("error", error ?: JSONObject.NULL)

    private fun JSONObject.toTask() = TvStoredDownload(
        id = getLong("id"), title = getString("title"), extension = getString("extension"),
        createdAt = optLong("createdAt"), status = optInt("status", DownloadManager.STATUS_FAILED),
        downloadedBytes = optLong("downloadedBytes"),
        totalBytes = if (isNull("totalBytes")) null else optLong("totalBytes"),
        validator = optString("validator").takeIf { it.isNotBlank() && it != "null" },
        encryptedRequest = getString("encryptedRequest"),
        error = optString("error").takeIf { it.isNotBlank() && it != "null" },
    )

    private fun TvDownloadRequest.toJson() = JSONObject()
        .put("url", url).put("title", title).put("extension", extension)
        .put("userAgent", userAgent ?: JSONObject.NULL)
        .put("headers", JSONArray().also { rows -> headers.forEach { (key, value) -> rows.put(JSONArray().put(key).put(value)) } })

    private fun TvDownloadRequest.Companion.fromJson(json: JSONObject): TvDownloadRequest {
        val headersJson = json.optJSONArray("headers") ?: JSONArray()
        val headers = buildMap {
            for (index in 0 until headersJson.length()) {
                val pair = headersJson.optJSONArray(index) ?: continue
                if (pair.length() >= 2) put(pair.getString(0), pair.getString(1))
            }
        }
        return TvDownloadRequest(
            url = json.getString("url"), title = json.getString("title"), extension = json.getString("extension"),
            userAgent = json.optString("userAgent").takeIf { it.isNotBlank() && it != "null" }, headers = headers,
        )
    }

    private companion object {
        const val PREFERENCES = "iptvnator-tv-download-tasks"
        const val TASKS = "tasks"
        const val NEXT_ID = "next_id"
        const val FIRST_ID = 1L shl 50
    }
}
