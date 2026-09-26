package com.iptvnator.googletv.download

/**
 * Normalizes playback headers before handing them to Android DownloadManager.
 * User-Agent is represented by the dedicated argument so a playlist header
 * cannot accidentally override the provider's playback identity.
 */
internal fun normalizedDownloadHeaders(
    userAgent: String?,
    headers: Map<String, String>,
): Map<String, String> = buildMap {
    userAgent?.trim()?.takeIf { it.isNotBlank() }?.let { put("User-Agent", it) }
    headers.forEach { (name, value) ->
        val normalizedName = name.trim()
        val normalizedValue = value.trim()
        if (normalizedName.isNotBlank() && normalizedValue.isNotBlank() && !normalizedName.equals("User-Agent", true)) {
            put(normalizedName, normalizedValue)
        }
    }
}
