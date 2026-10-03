package com.iptvnator.googletv.download

import android.app.DownloadManager
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.util.Log
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import okhttp3.Call
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.delay
import java.util.concurrent.ConcurrentHashMap

/** Owns durable IPTV downloads while the app is backgrounded and keeps their partial files resumable. */
class TvDownloadService : Service() {
    private lateinit var store: TvDownloadTaskStore
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val jobs = ConcurrentHashMap<Long, Job>()
    private val calls = ConcurrentHashMap<Long, Call>()
    private val cancelled = ConcurrentHashMap.newKeySet<Long>()
    private val transfer = TvResumableTransfer()
    private lateinit var notifications: NotificationManager
    private var latestStartId = 0
    private var stopWhenIdle: Job? = null

    override fun onCreate() {
        super.onCreate()
        store = TvDownloadTaskStore(this)
        notifications = getSystemService(NotificationManager::class.java)
        createNotificationChannel()
        startAsForeground()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        latestStartId = startId
        stopWhenIdle?.cancel()
        stopWhenIdle = null
        when (intent?.action) {
            ACTION_RECOVER -> Unit
            ACTION_PAUSE -> pause(intent.getLongExtra(EXTRA_ID, -1L))
            ACTION_RESUME -> store.update(intent.getLongExtra(EXTRA_ID, -1L), status = DownloadManager.STATUS_PENDING, replaceError = true)
            ACTION_CANCEL -> cancel(intent.getLongExtra(EXTRA_ID, -1L))
        }
        pumpQueue()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        store.returnRunningTasksToQueue()
        calls.values.forEach(Call::cancel)
        serviceScope.coroutineContext[Job]?.cancel()
        super.onDestroy()
    }

    @Synchronized
    private fun pumpQueue() {
        val slots = (MAX_CONCURRENT - jobs.size).coerceAtLeast(0)
        if (slots > 0) {
            store.all()
                .filter { it.status == DownloadManager.STATUS_PENDING || it.status == DownloadManager.STATUS_RUNNING }
                .sortedBy { it.createdAt }
                .take(slots)
                .forEach { task ->
                    if (!jobs.containsKey(task.id)) {
                        val job = serviceScope.launch(start = CoroutineStart.LAZY) { runTask(task.id) }
                        jobs[task.id] = job
                        job.start()
                    }
                }
        }
        updateNotification()
        if (jobs.isEmpty() && store.all().none {
                it.status == DownloadManager.STATUS_PENDING || it.status == DownloadManager.STATUS_RUNNING
            }
        ) {
            stopWhenIdle?.cancel()
            stopWhenIdle = serviceScope.launch {
                delay(IDLE_STOP_DELAY_MS)
                stopIfStillIdle()
            }
        } else {
            stopWhenIdle?.cancel()
            stopWhenIdle = null
        }
    }

    @Synchronized
    private fun stopIfStillIdle() {
        val activeTaskExists = store.all().any {
            it.status == DownloadManager.STATUS_PENDING || it.status == DownloadManager.STATUS_RUNNING
        }
        if (jobs.isNotEmpty() || activeTaskExists) return
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE) else stopForeground(true)
        stopSelfResult(latestStartId)
    }

    private suspend fun runTask(id: Long) {
        try {
            var task = store.get(id) ?: return
            if (task.status != DownloadManager.STATUS_PENDING && task.status != DownloadManager.STATUS_RUNNING) return
            store.update(id, status = DownloadManager.STATUS_RUNNING, replaceError = true)
            task = store.get(id) ?: return
            val request = store.request(task)
            val headers = buildMap {
                request.userAgent?.let { put("User-Agent", it) }
                putAll(request.headers)
            }
            val result = withContext(Dispatchers.IO) {
                try {
                    transfer.transfer(
                        request.url, headers, store.partialFile(task), task.validator,
                        onProgress = { bytes, total, validator -> persistProgress(id, bytes, total, validator) },
                        onCallCreated = { registerCall(id, it) },
                        onCallFinished = { calls.remove(id) },
                    )
                } catch (_: TvResumableTransfer.ResumeEntityChangedException) {
                    // The unvalidated overlap differs, proving the remote representation changed.
                    store.partialFile(task).delete()
                    transfer.transfer(
                        request.url, headers, store.partialFile(task), null,
                        onProgress = { bytes, total, validator -> persistProgress(id, bytes, total, validator) },
                        onCallCreated = { registerCall(id, it) },
                        onCallFinished = { calls.remove(id) },
                    )
                }
            }
            val latest = store.get(id)
            if (latest?.status == DownloadManager.STATUS_RUNNING && id !in cancelled) {
                store.update(
                    id, downloadedBytes = result.bytesDownloaded, totalBytes = result.totalBytes,
                    validator = result.validator, replaceTotal = true, replaceValidator = true,
                )
                store.markComplete(latest)
            }
        } catch (cancelledWork: CancellationException) {
            throw cancelledWork
        } catch (failure: Exception) {
            val current = store.get(id)
            if (current?.status == DownloadManager.STATUS_RUNNING && id !in cancelled) {
                Log.e(TAG, "Download $id failed: ${failure.message}", failure)
                store.update(
                    id, status = DownloadManager.STATUS_FAILED,
                    error = failure.message ?: "Error de descarga.", replaceError = true,
                )
            }
        } finally {
            calls.remove(id)
            if (id in cancelled) {
                store.forget(id, deleteFiles = true)
                cancelled.remove(id)
            }
            jobs.remove(id)
            pumpQueue()
        }
    }

    private fun persistProgress(id: Long, bytes: Long, total: Long?, validator: String?) {
        if (store.get(id)?.status == DownloadManager.STATUS_RUNNING) {
            store.update(
                id,
                downloadedBytes = bytes,
                totalBytes = total,
                validator = validator,
                replaceTotal = true,
                replaceValidator = validator != null,
            )
            updateNotification()
        }
    }

    private fun registerCall(id: Long, call: Call) {
        calls[id] = call
        if (store.get(id)?.status != DownloadManager.STATUS_RUNNING) call.cancel()
    }

    private fun pause(id: Long) {
        if (store.get(id) == null) return
        store.update(id, status = DownloadManager.STATUS_PAUSED)
        calls[id]?.cancel()
    }

    private fun cancel(id: Long) {
        if (store.get(id) == null) return
        store.update(id, status = DownloadManager.STATUS_FAILED, error = "cancelled", replaceError = true)
        if (jobs.containsKey(id)) {
            cancelled.add(id)
            calls[id]?.cancel()
        } else {
            store.forget(id, deleteFiles = true)
        }
    }

    private fun startAsForeground() {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    @SuppressLint("NotificationPermission")
    private fun updateNotification() {
        if (!::notifications.isInitialized) return
        val task = store.all().firstOrNull { it.status == DownloadManager.STATUS_RUNNING }
        notifications.notify(NOTIFICATION_ID, buildNotification(task))
    }

    @SuppressLint("NotificationPermission")
    private fun buildNotification(task: TvStoredDownload? = null): Notification {
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL_ID) else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        val percent = task?.takeIf { it.totalBytes != null && it.totalBytes > 0 }
            ?.let { ((it.downloadedBytes * 100) / it.totalBytes!!).toInt().coerceIn(0, 100) }
        builder.setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(task?.title ?: "IPTVnator · Descargas")
            .setContentText(if (task == null) "Preparando descargas" else "Descargando" + (percent?.let { " · $it%" } ?: ""))
            .setOngoing(task != null)
            .setOnlyAlertOnce(true)
        if (task != null && percent != null) builder.setProgress(100, percent, false)
        return builder.build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            notifications.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Descargas", NotificationManager.IMPORTANCE_LOW),
            )
        }
    }

    companion object {
        private const val CHANNEL_ID = "iptvnator-downloads"
        private const val NOTIFICATION_ID = 7104
        private const val MAX_CONCURRENT = 2
        private const val IDLE_STOP_DELAY_MS = 700L
        private const val TAG = "TvDownloadService"
        const val ACTION_ENQUEUE = "com.iptvnator.googletv.download.ENQUEUE"
        const val ACTION_RECOVER = "com.iptvnator.googletv.download.RECOVER"
        const val ACTION_PAUSE = "com.iptvnator.googletv.download.PAUSE"
        const val ACTION_RESUME = "com.iptvnator.googletv.download.RESUME"
        const val ACTION_CANCEL = "com.iptvnator.googletv.download.CANCEL"
        const val EXTRA_ID = "download_id"

        fun submit(context: Context, action: String, id: Long) {
            val intent = Intent(context, TvDownloadService::class.java).setAction(action).putExtra(EXTRA_ID, id)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
            else context.startService(intent)
        }
    }
}
