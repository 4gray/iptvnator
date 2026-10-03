package com.iptvnator.googletv.download

import okhttp3.OkHttpClient
import okhttp3.Call
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.util.concurrent.TimeUnit

internal data class TvTransferCheckpoint(
    val bytesDownloaded: Long,
    val totalBytes: Long?,
    val validator: String?,
)

/** Byte-exact HTTP transfer with Range/If-Range and overlap verification without validators. */
internal class TvResumableTransfer(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build(),
) {
    fun transfer(
        url: String,
        headers: Map<String, String>,
        partialFile: File,
        resumeValidator: String?,
        onProgress: (Long, Long?, String?) -> Unit = { _, _, _ -> },
        onCallCreated: (Call) -> Unit = {},
        onCallFinished: () -> Unit = {},
    ): TvTransferCheckpoint {
        partialFile.parentFile?.mkdirs()
        val offset = if (partialFile.exists()) partialFile.length() else 0L
        val overlap = if (offset > 0 && resumeValidator.isNullOrBlank()) minOf(offset, OVERLAP_VERIFICATION_BYTES) else 0L
        val requestOffset = offset - overlap
        val sendsRange = requestOffset > 0
        val request = Request.Builder().url(url).apply {
            headers.forEach { (name, value) ->
                if (!name.equals("Range", true) && !name.equals("If-Range", true)) header(name, value)
            }
            header("Accept-Encoding", "identity")
            if (sendsRange) {
                header("Range", "bytes=$requestOffset-")
                if (!resumeValidator.isNullOrBlank()) header("If-Range", resumeValidator)
            }
        }.get().build()

        val call = client.newCall(request)
        onCallCreated(call)
        try {
        call.execute().use { response ->
            if (response.code == 416 && offset > 0) {
                val total = UNSATISFIED_RANGE.matchEntire(response.header("Content-Range").orEmpty())
                    ?.groupValues?.get(1)?.toLongOrNull()
                if (total == offset && !resumeValidator.isNullOrBlank()) {
                    return TvTransferCheckpoint(offset, total, resumeValidator)
                }
                throw IOException("El servidor rechazó el rango de reanudación (HTTP 416).")
            }
            if (!response.isSuccessful) throw IOException("Error HTTP ${response.code} al descargar.")

            val responseStart: Long
            val appendAt: Long
            val verifyAt: Long
            when {
                sendsRange && response.code == 206 -> {
                    responseStart = CONTENT_RANGE.matchEntire(response.header("Content-Range").orEmpty())
                        ?.groupValues?.get(1)?.toLongOrNull()
                        ?: throw IOException("El servidor devolvió un Content-Range inválido.")
                    if (responseStart != requestOffset) throw IOException("El servidor reanudó desde un byte incorrecto.")
                    appendAt = offset
                    verifyAt = if (overlap > 0) requestOffset else -1L
                }
                response.code == 200 -> {
                    // Range ignored or If-Range detected a changed entity: rebuild from byte zero.
                    responseStart = 0L
                    appendAt = 0L
                    verifyAt = -1L
                }
                response.code == 206 -> throw IOException("El servidor devolvió un rango que no se solicitó.")
                else -> throw IOException("Respuesta HTTP inesperada (${response.code}).")
            }

            val body = response.body ?: throw IOException("El servidor devolvió una respuesta vacía.")
            val totalBytes = response.header("Content-Range")?.let(CONTENT_RANGE_TOTAL::matchEntire)
                ?.groupValues?.get(1)?.takeIf { it != "*" }?.toLongOrNull()
                ?: body.contentLength().takeIf { it >= 0 }?.let { responseStart + it }
            val responseEnd = response.header("Content-Range")?.let(CONTENT_RANGE_END::matchEntire)
                ?.groupValues?.get(1)?.toLongOrNull()
            val responseValidator = response.header("ETag")?.takeUnless { it.startsWith("W/", true) }
                ?: response.header("Last-Modified")

            RandomAccessFile(partialFile, "rw").use { output ->
                output.setLength(appendAt)
                output.seek(appendAt)
                var remainingOverlap = if (verifyAt >= 0) overlap else 0L
                val verifier = if (remainingOverlap > 0) RandomAccessFile(partialFile, "r") else null
                verifier?.seek(verifyAt)
                try {
                    var effectiveValidator = if (verifyAt >= 0) resumeValidator else responseValidator
                    onProgress(maxOf(offset, appendAt), totalBytes, effectiveValidator)
                    val input = body.byteStream()
                    val buffer = ByteArray(BUFFER_SIZE)
                    var received = responseStart
                    var lastProgressNanos = 0L
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        var appendFrom = 0
                        if (remainingOverlap > 0) {
                            val compareCount = minOf(count.toLong(), remainingOverlap).toInt()
                            val expected = ByteArray(compareCount)
                            if (verifier!!.read(expected) != compareCount ||
                                !buffer.copyOfRange(0, compareCount).contentEquals(expected)
                            ) throw ResumeEntityChangedException()
                            remainingOverlap -= compareCount
                            appendFrom = compareCount
                            if (remainingOverlap == 0L) {
                                effectiveValidator = responseValidator
                                onProgress(maxOf(offset, output.filePointer), totalBytes, effectiveValidator)
                            }
                        }
                        if (appendFrom < count) output.write(buffer, appendFrom, count - appendFrom)
                        received += count
                        val now = System.nanoTime()
                        if (now - lastProgressNanos >= PROGRESS_INTERVAL_NANOS) {
                            output.fd.sync()
                            onProgress(maxOf(offset, output.filePointer), totalBytes, effectiveValidator)
                            lastProgressNanos = now
                        }
                    }
                    if (remainingOverlap > 0) throw IOException("La conexión terminó antes de validar los bytes parciales.")
                    if (responseEnd != null && received != responseEnd + 1) {
                        throw IOException("La descarga terminó antes de completar el rango HTTP recibido.")
                    }
                    if (totalBytes != null && output.length() != totalBytes) {
                        throw IOException("La descarga quedó incompleta (${output.length()} de $totalBytes bytes).")
                    }
                    output.fd.sync()
                    val completeBytes = output.length()
                    onProgress(completeBytes, totalBytes, effectiveValidator)
                    return TvTransferCheckpoint(
                        completeBytes,
                        totalBytes,
                        effectiveValidator,
                    )
                } finally {
                    verifier?.close()
                }
            }
        }
        } finally {
            onCallFinished()
        }
    }

    class ResumeEntityChangedException : IOException("El archivo remoto cambió; debe reiniciarse desde cero.")

    companion object {
        private const val BUFFER_SIZE = 64 * 1024
        private const val PROGRESS_INTERVAL_NANOS = 500_000_000L
        const val OVERLAP_VERIFICATION_BYTES = 256L * 1024L
        private val CONTENT_RANGE = Regex("bytes\\s+(\\d+)-(\\d+)/(?:\\d+|\\*)", RegexOption.IGNORE_CASE)
        private val CONTENT_RANGE_TOTAL = Regex("bytes\\s+\\d+-\\d+/(\\d+|\\*)", RegexOption.IGNORE_CASE)
        private val CONTENT_RANGE_END = Regex("bytes\\s+\\d+-(\\d+)/(?:\\d+|\\*)", RegexOption.IGNORE_CASE)
        private val UNSATISFIED_RANGE = Regex("bytes\\s+\\*/(\\d+)", RegexOption.IGNORE_CASE)
    }
}
