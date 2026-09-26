package com.iptvnator.googletv.recording

import java.io.IOException

internal data class TvHlsEncryptionKey(
    val method: String,
    val uri: String?,
    val iv: String?,
    val keyFormat: String,
)

internal data class TvHlsInitMap(
    val uri: String,
    val encryptionKey: TvHlsEncryptionKey?,
    val byteRange: TvHlsByteRange? = null,
)

internal data class TvHlsByteRange(val length: Long, val offset: Long) {
    val endInclusive: Long get() = offset + length - 1L
}

internal data class TvHlsMediaSegment(
    val uri: String,
    val sequence: Long,
    val encryptionKey: TvHlsEncryptionKey?,
    val byteRange: TvHlsByteRange? = null,
)

internal data class TvHlsMediaPlaylist(
    val initMap: TvHlsInitMap?,
    val segments: List<TvHlsMediaSegment>,
    val ended: Boolean,
    val iFramesOnly: Boolean = false,
)

/** Parse the tags whose state affects the bytes written to a recording. */
internal fun parseTvHlsMediaPlaylist(content: String): TvHlsMediaPlaylist {
    var nextSequence = 0L
    var encryptionKey: TvHlsEncryptionKey? = null
    var initMap: TvHlsInitMap? = null
    var ended = false
    var iFramesOnly = false
    var pendingByteRange: String? = null
    var previousByteRangeUri: String? = null
    var previousByteRange: TvHlsByteRange? = null
    val segments = mutableListOf<TvHlsMediaSegment>()

    content.lineSequence().map(String::trim).filter(String::isNotEmpty).forEach { line ->
        when {
            line.startsWith("#EXT-X-MEDIA-SEQUENCE:", ignoreCase = true) -> {
                if (segments.isNotEmpty()) throw IOException("EXT-X-MEDIA-SEQUENCE aparece después de segmentos.")
                nextSequence = line.substringAfter(':').trim().toLongOrNull()
                    ?.takeIf { it >= 0L }
                    ?: throw IOException("Número de secuencia HLS no válido.")
            }

            line.startsWith("#EXT-X-KEY:", ignoreCase = true) -> {
                val attributes = parseTvHlsAttributes(line.substringAfter(':'))
                val method = attributes["METHOD"]?.uppercase()
                    ?: throw IOException("La etiqueta EXT-X-KEY no especifica METHOD.")
                encryptionKey = if (method == "NONE") {
                    null
                } else {
                    val uri = attributes["URI"]
                    if (method == "AES-128" && uri.isNullOrBlank()) {
                        throw IOException("La clave AES-128 HLS no especifica URI.")
                    }
                    TvHlsEncryptionKey(
                        method = method,
                        uri = uri,
                        iv = attributes["IV"],
                        keyFormat = attributes["KEYFORMAT"] ?: "identity",
                    )
                }
            }

            line.startsWith("#EXT-X-MAP:", ignoreCase = true) -> {
                val attributes = parseTvHlsAttributes(line.substringAfter(':'))
                val uri = attributes["URI"]
                    ?.takeIf(String::isNotBlank)
                    ?: throw IOException("La etiqueta EXT-X-MAP no especifica URI.")
                val byteRange = attributes["BYTERANGE"]?.let { parseTvHlsByteRange(it, null) }
                initMap = TvHlsInitMap(uri = uri, encryptionKey = encryptionKey, byteRange = byteRange)
            }

            line.startsWith("#EXT-X-BYTERANGE:", ignoreCase = true) -> {
                if (pendingByteRange != null) throw IOException("Hay más de un EXT-X-BYTERANGE para el mismo segmento.")
                pendingByteRange = line.substringAfter(':').trim()
            }

            line.equals("#EXT-X-ENDLIST", ignoreCase = true) -> ended = true
            line.equals("#EXT-X-I-FRAMES-ONLY", ignoreCase = true) -> iFramesOnly = true
            line.startsWith('#') -> Unit
            else -> {
                val byteRange = pendingByteRange?.let { value ->
                    val parsed = parseTvHlsByteRange(value, 0L)
                    val offset = if (value.contains('@')) {
                        parsed.offset
                    } else {
                        val previous = previousByteRange
                        if (previousByteRangeUri != line || previous == null) {
                            throw IOException("El desplazamiento implícito EXT-X-BYTERANGE no tiene un segmento anterior del mismo recurso.")
                        }
                        previous.endInclusive + 1L
                    }
                    if (offset > Long.MAX_VALUE - parsed.length) throw IOException("El rango de bytes HLS excede el límite permitido.")
                    TvHlsByteRange(parsed.length, offset)
                }
                segments += TvHlsMediaSegment(
                    uri = line,
                    sequence = nextSequence,
                    encryptionKey = encryptionKey,
                    byteRange = byteRange,
                )
                previousByteRangeUri = line
                previousByteRange = byteRange
                pendingByteRange = null
                nextSequence++
            }
        }
    }

    if (pendingByteRange != null) throw IOException("EXT-X-BYTERANGE no va seguido por un segmento.")

    return TvHlsMediaPlaylist(initMap = initMap, segments = segments, ended = ended, iFramesOnly = iFramesOnly)
}

private fun parseTvHlsByteRange(value: String, defaultOffset: Long?): TvHlsByteRange {
    val match = Regex("""^(\d+)(?:@(\d+))?$""").matchEntire(value.trim())
        ?: throw IOException("El valor EXT-X-BYTERANGE no es válido.")
    val length = match.groupValues[1].toLongOrNull()?.takeIf { it > 0L }
        ?: throw IOException("La longitud EXT-X-BYTERANGE no es válida.")
    val offset = match.groupValues[2].takeIf(String::isNotEmpty)?.toLongOrNull() ?: defaultOffset
        ?: throw IOException("El rango EXT-X-MAP requiere un desplazamiento explícito.")
    if (offset < 0L || offset > Long.MAX_VALUE - length) throw IOException("El desplazamiento EXT-X-BYTERANGE no es válido.")
    return TvHlsByteRange(length, offset)
}

internal fun parseTvHlsAttributes(source: String): Map<String, String> =
    Regex("""([A-Z0-9-]+)\s*=\s*(?:"([^"]*)"|([^,]*))""", RegexOption.IGNORE_CASE)
        .findAll(source)
        .associate { match ->
            val value = match.groups[2]?.value ?: match.groups[3]?.value.orEmpty().trim()
            match.groupValues[1].uppercase() to value
        }
