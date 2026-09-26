package com.iptvnator.googletv.playlist

import com.iptvnator.googletv.epg.TvEpgEntry
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

/** Resolves the common M3U catch-up conventions used by IPTVnator sources. */
fun resolveM3uCatchupUrl(
    channel: TvChannel,
    program: TvEpgEntry,
    nowMs: Long = System.currentTimeMillis(),
): String? {
    if (program.endMs <= program.startMs || !supportsM3uCatchup(channel)) return null
    val source = channel.catchupSource?.trim().takeIf { it != null && isHttpUrl(it) }
        ?: channel.url.trim().takeIf {
            isHttpUrl(it) && (channel.catchupType.isNullOrBlank() || channel.catchupType.equals("shift", true))
        }
        ?: return null
    val parsed = parseHttpUrl(source) ?: return null
    val existing = parsed.rawQuery.orEmpty()
        .split('&')
        .filter(String::isNotEmpty)
        .map { part ->
            val separator = part.indexOf('=')
            val key = if (separator < 0) part else part.substring(0, separator)
            val value = if (separator < 0) "" else part.substring(separator + 1)
            decodeFormComponent(key) to decodeFormComponent(value)
        }
    val start = (program.startMs / 1_000L).toString()
    val now = (nowMs / 1_000L).toString()
    var utcWritten = false
    var lutcWritten = false
    val query = buildList {
        existing.forEach { (key, value) ->
            when (key) {
                "utc" -> if (!utcWritten) {
                    add("utc" to start)
                    utcWritten = true
                }
                "lutc" -> if (!lutcWritten) {
                    add("lutc" to now)
                    lutcWritten = true
                }
                else -> add(key to value)
            }
        }
        if (!utcWritten) add("utc" to start)
        if (!lutcWritten) add("lutc" to now)
    }.joinToString("&") { (key, value) ->
        "${encodeFormComponent(key)}=${encodeFormComponent(value)}"
    }
    return buildString {
        append(parsed.scheme).append("://").append(parsed.rawAuthority)
        append(encodePathPreservingEscapes(parsed.rawPath.orEmpty()))
        append('?').append(query)
        parsed.rawFragment?.let { append('#').append(it) }
    }
}

/** Whether this M3U entry declares an archive route this client can actually resolve. */
fun supportsM3uCatchup(channel: TvChannel): Boolean {
    if (channel.catchupDays <= 0) return false
    if (channel.catchupSource?.trim()?.let(::isHttpUrl) == true) return true
    val streamType = channel.catchupType?.trim().orEmpty()
    return isHttpUrl(channel.url.trim()) && (streamType.isBlank() || streamType.equals("shift", true))
}

private fun isHttpUrl(value: String): Boolean = parseHttpUrl(value) != null

private fun parseHttpUrl(value: String): URI? = runCatching {
    URI(encodeIllegalUrlCharacters(value.trim())).takeIf { uri ->
        (uri.scheme.equals("http", true) || uri.scheme.equals("https", true)) &&
            !uri.host.isNullOrBlank()
    }
}.getOrNull()

/** Java URI is stricter than the browser URL parser for template braces and spaces. */
private fun encodeIllegalUrlCharacters(value: String): String = buildString {
    val bytes = value.toByteArray(StandardCharsets.UTF_8)
    var index = 0
    while (index < bytes.size) {
        val byte = bytes[index]
        val code = byte.toInt() and 0xff
        val character = code.toChar()
        val validEscape = character == '%' && index + 2 < bytes.size &&
            bytes[index + 1].toInt().toChar().isHexDigit() &&
            bytes[index + 2].toInt().toChar().isHexDigit()
        if (validEscape) {
            append('%')
            append(bytes[index + 1].toInt().toChar())
            append(bytes[index + 2].toInt().toChar())
            index += 3
        } else if (code < 128 && character != '%' &&
            (character.isLetterOrDigit() || character in URL_SAFE_CHARACTERS)
        ) {
            append(character)
            index += 1
        } else {
            append('%')
            append(HEX_DIGITS[code ushr 4])
            append(HEX_DIGITS[code and 0x0f])
            index += 1
        }
    }
}

private fun decodeFormComponent(value: String): String = runCatching {
    URLDecoder.decode(value, StandardCharsets.UTF_8.name())
}.getOrDefault(value)

private fun encodeFormComponent(value: String): String = URLEncoder.encode(
    value,
    StandardCharsets.UTF_8.name(),
)

/** Encodes template characters and spaces while keeping already escaped URL path octets intact. */
private fun encodePathPreservingEscapes(value: String): String = buildString {
    var index = 0
    while (index < value.length) {
        val current = value[index]
        if (current == '%' && index + 2 < value.length &&
            value[index + 1].isHexDigit() && value[index + 2].isHexDigit()
        ) {
            append(value, index, index + 3)
            index += 3
            continue
        }
        val codePoint = Character.codePointAt(value, index)
        val characterCount = Character.charCount(codePoint)
        if (codePoint < 128 && codePoint.toChar() in PATH_SAFE_CHARACTERS) {
            append(codePoint.toChar())
        } else {
            String(Character.toChars(codePoint)).toByteArray(StandardCharsets.UTF_8).forEach { byte ->
                append('%')
                append(HEX_DIGITS[(byte.toInt() shr 4) and 0x0f])
                append(HEX_DIGITS[byte.toInt() and 0x0f])
            }
        }
        index += characterCount
    }
}

private fun Char.isHexDigit(): Boolean = this in '0'..'9' || this in 'a'..'f' || this in 'A'..'F'

private const val PATH_SAFE_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~/:@!$&'()*+,;=%"
private const val URL_SAFE_CHARACTERS = "-._~:/?#[]@!$&'()*+,;=%"
private const val HEX_DIGITS = "0123456789ABCDEF"
