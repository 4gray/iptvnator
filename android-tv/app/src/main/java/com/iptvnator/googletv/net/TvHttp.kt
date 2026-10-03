package com.iptvnator.googletv.net

import java.io.BufferedInputStream
import java.io.InputStream
import java.util.zip.GZIPInputStream
import java.util.zip.InflaterInputStream

/** Decodes the compressed response bodies commonly returned by IPTV panels. */
fun decodeHttpResponseBody(input: InputStream, contentEncoding: String?): InputStream {
    val encodings = contentEncoding.orEmpty().split(',').map { it.trim().lowercase() }.asReversed()
    var decoded: InputStream = BufferedInputStream(input)
    encodings.forEach { encoding ->
        decoded = when (encoding) {
            "gzip", "x-gzip" -> GZIPInputStream(decoded)
            "deflate" -> InflaterInputStream(decoded)
            else -> decoded
        }
    }
    // XMLTV files are often gzip-compressed independently of HTTP
    // Content-Encoding (including after redirects to a .xml.gz URL). Sniff
    // the remaining payload so HTTP gzip + a .gz file is decoded twice, while
    // HTTP gzip alone is not mistakenly decompressed a second time.
    return decodeGzipPayloadIfPresent(decoded)
}

/** Decodes a gzip file payload by magic bytes, regardless of URL or MIME type. */
fun decodeGzipPayloadIfPresent(input: InputStream): InputStream {
    val buffered = if (input is BufferedInputStream) input else BufferedInputStream(input)
    buffered.mark(2)
    val first = buffered.read()
    val second = buffered.read()
    buffered.reset()
    return if (first == 0x1f && second == 0x8b) GZIPInputStream(buffered) else buffered
}
