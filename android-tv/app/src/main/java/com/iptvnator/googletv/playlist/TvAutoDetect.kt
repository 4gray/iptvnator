package com.iptvnator.googletv.playlist

import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

sealed interface TvDetectedSource {
    data class M3uText(val content: String) : TvDetectedSource
    data class M3uUrl(val url: String) : TvDetectedSource
    data class Xtream(val server: String, val username: String, val password: String) : TvDetectedSource
    data class Stalker(
        val portal: String,
        val mac: String,
        val username: String?,
        val password: String?,
        val serialNumber: String? = null,
        val deviceId1: String? = null,
        val deviceId2: String? = null,
        val signature1: String? = null,
        val signature2: String? = null,
    ) : TvDetectedSource
}

/** Pure counterpart of IPTVnator's provider-message candidate detection. */
fun detectTvSource(text: String): TvDetectedSource {
    val raw = text.trim()
    require(raw.isNotBlank()) { "Pega un mensaje del proveedor o una lista M3U" }
    if (raw.contains("#EXTM3U", ignoreCase = true) || raw.contains("#EXTINF", ignoreCase = true)) {
        return TvDetectedSource.M3uText(raw)
    }
    val url = Regex("https?://[^\\s<>\\\"']+", RegexOption.IGNORE_CASE)
        .find(raw)?.value?.trimEnd('.', ',', ';', ')', ']')
    val uri = url?.let { runCatching { URI(it) }.getOrNull() }
    val query = uri?.rawQuery.orEmpty().split('&').mapNotNull { pair ->
        val parts = pair.split('=', limit = 2)
        if (parts.size != 2) return@mapNotNull null
        URLDecoder.decode(parts[0], StandardCharsets.UTF_8.name()).lowercase() to
            URLDecoder.decode(parts[1], StandardCharsets.UTF_8.name())
    }.toMap()
    val username = query["username"] ?: query["user"] ?: Regex(
        "(?im)^(?:user(?:name)?|usuario)\\s*[:=]\\s*(\\S+)"
    ).find(raw)?.groupValues?.getOrNull(1)
    val password = query["password"] ?: query["pass"] ?: Regex(
        "(?im)^(?:password|pass|contraseña)\\s*[:=]\\s*(\\S+)"
    ).find(raw)?.groupValues?.getOrNull(1)
    val mac = Regex("(?i)\\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\\b").find(raw)?.value
    if (mac != null && url != null) {
        fun value(key: String, label: String): String? = query[key]
            ?: Regex("(?im)^\\s*(?:$label)\\s*[:=]\\s*(\\S+)").find(raw)?.groupValues?.getOrNull(1)
        return TvDetectedSource.Stalker(
            portal = url,
            mac = mac,
            username = username,
            password = password,
            serialNumber = value("sn", "serial(?:\\s+number)?|sn"),
            deviceId1 = value("device_id", "device[_ -]?id(?:\\s+1|[_ -]?1)?"),
            deviceId2 = value("device_id2", "device[_ -]?id(?:\\s+2|[_ -]?2)"),
            signature1 = value("signature", "signature(?:\\s+1|[_ -]?1)?"),
            signature2 = value("signature2", "signature(?:\\s+2|[_ -]?2)"),
        )
    }
    if (url != null && username != null && password != null &&
        (uri?.path?.contains("get.php", true) == true ||
            uri?.path?.contains("player_api", true) == true || query.isNotEmpty())
    ) {
        val parsed = uri ?: error("URL Xtream no válida")
        return TvDetectedSource.Xtream("${parsed.scheme}://${parsed.authority}", username, password)
    }
    if (url != null && (url.substringBefore('?').endsWith(".m3u", true) ||
            url.substringBefore('?').endsWith(".m3u8", true))) {
        return TvDetectedSource.M3uUrl(url)
    }
    error("No se ha reconocido una fuente M3U, Xtream o Stalker en el texto")
}
