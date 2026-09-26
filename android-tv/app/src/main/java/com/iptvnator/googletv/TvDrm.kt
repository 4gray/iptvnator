package com.iptvnator.googletv

import android.util.Base64
import org.json.JSONObject
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

data class TvDrmConfig(
    val licenseType: String,
    val supported: Boolean,
    val clearKeys: Map<String, String> = emptyMap(),
    val licenseUrl: String? = null,
    val licenseHeaders: Map<String, String> = emptyMap(),
    /** Raw Kodi POST template. Media3's default callback supports its common R{SSM} form. */
    val licenseRequestData: String? = null,
    /** Raw Kodi response template. Media3's default callback supports the common R form. */
    val licenseResponseData: String? = null,
    /** Retain advanced KODIPROP properties that this Media3 adapter cannot apply yet. */
    val additionalProperties: Map<String, String> = emptyMap(),
)

/** Parses the ClearKey and network-license subset of the legacy Kodi #KODIPROP contract. */
fun parseTvDrmProperties(properties: Map<String, String>): TvDrmConfig? {
    var type = properties["inputstream.adaptive.license_type"].orEmpty().trim().lowercase()
    var keyValue = properties["inputstream.adaptive.license_key"].orEmpty().trim()
    properties["inputstream.adaptive.drm_legacy"]?.let { legacy ->
        if (type.isBlank() || keyValue.isBlank()) {
            val parts = legacy.split('|', limit = 2)
            if (type.isBlank()) type = parts.firstOrNull()?.trim()?.lowercase().orEmpty()
            if (keyValue.isBlank()) keyValue = parts.getOrNull(1)?.trim().orEmpty()
        }
    }
    if (type.isBlank() && keyValue.isBlank()) return null
    val clearKeys = if (type.isBlank() || type == "clearkey" || type == "org.w3.clearkey") {
        parseTvClearKeys(keyValue)
    } else null
    return if (!clearKeys.isNullOrEmpty()) {
        TvDrmConfig(type.ifBlank { "clearkey" }, supported = true, clearKeys)
    } else {
        val networkDrm = type == "com.widevine.alpha" || type == "widevine" ||
            type == "com.microsoft.playready" || type == "playready"
        val licenseParts = keyValue.split('|')
        val rawLicenseKeyUrl = licenseParts.firstOrNull().orEmpty().trim()
        val separateLicenseUrl = buildString {
            append(properties["inputstream.adaptive.license_url"].orEmpty().trim())
            append(properties["inputstream.adaptive.license_url_append"].orEmpty().trim())
        }
        val rawLicenseUrl = rawLicenseKeyUrl.ifBlank { separateLicenseUrl }
        val licenseUrl = rawLicenseUrl.takeIf { value ->
            value.startsWith("http://", true) || value.startsWith("https://", true)
        }
        val rawHeaders = licenseParts.getOrNull(1).orEmpty()
        val licenseHeaders = parseTvLicenseHeaders(rawHeaders)
        val requestData = licenseParts.getOrNull(2)?.takeIf(String::isNotBlank)
        val responseData = licenseParts.getOrNull(3)?.takeIf(String::isNotBlank)
        val additionalProperties = properties.filterKeys {
            it != "inputstream.adaptive.license_type" &&
                it != "inputstream.adaptive.license_key" &&
                it != "inputstream.adaptive.drm_legacy" &&
                it != "inputstream.adaptive.license_url" &&
                it != "inputstream.adaptive.license_url_append"
        }
        val requestDataSupported = requestData == null || decodeTvLicenseValue(requestData) == "R{SSM}"
        val responseDataSupported = responseData == null || decodeTvLicenseValue(responseData) == "R"
        val licenseUrlTemplateSupported = !Regex("\\{(?:SSM|HASH)\\}", RegexOption.IGNORE_CASE)
            .containsMatchIn(rawLicenseUrl)
        val supported = networkDrm &&
            (rawLicenseUrl.isBlank() || licenseUrl != null) &&
            licenseUrlTemplateSupported &&
            licenseHeaders != null &&
            licenseParts.size <= 4 &&
            requestDataSupported && responseDataSupported &&
            additionalProperties.isEmpty()
        TvDrmConfig(
            licenseType = type,
            supported = supported,
            licenseUrl = licenseUrl,
            licenseHeaders = licenseHeaders.orEmpty(),
            licenseRequestData = requestData,
            licenseResponseData = responseData,
            additionalProperties = additionalProperties,
        )
    }
}

/** Kodi stores license headers as URL-encoded query components after the first pipe. */
private fun parseTvLicenseHeaders(value: String): Map<String, String>? {
    if (value.isBlank()) return emptyMap()
    val headers = linkedMapOf<String, String>()
    value.split('&').forEach { component ->
        if (component.isBlank()) return@forEach
        val separator = component.indexOf('=')
        if (separator <= 0) return null
        val name = decodeTvLicenseValue(component.substring(0, separator))?.trim().orEmpty()
        val headerValue = decodeTvLicenseValue(component.substring(separator + 1)) ?: return null
        if (name.isBlank() || name.any { it == '\r' || it == '\n' } ||
            headerValue.any { it == '\r' || it == '\n' }
        ) return null
        headers.keys.firstOrNull { it.equals(name, ignoreCase = true) }?.let(headers::remove)
        headers[name] = headerValue
    }
    return headers
}

private fun decodeTvLicenseValue(value: String): String? = runCatching {
    URLDecoder.decode(value, StandardCharsets.UTF_8.name())
}.getOrNull()

private fun parseTvClearKeys(value: String): Map<String, String>? {
    if (value.isBlank()) return null
    if (value.trimStart().startsWith("{")) {
        return runCatching {
            val root = JSONObject(value)
            val result = linkedMapOf<String, String>()
            if (root.has("keys")) {
                val keys = root.getJSONArray("keys")
                for (index in 0 until keys.length()) {
                    val item = keys.getJSONObject(index)
                    val kid = normalizeTvKey(item.optString("kid")) ?: return@runCatching null
                    val key = normalizeTvKey(item.optString("k")) ?: return@runCatching null
                    result[kid] = key
                }
            } else {
                root.keys().forEach { kid ->
                    val key = normalizeTvKey(root.optString(kid)) ?: return@runCatching null
                    result[normalizeTvKey(kid) ?: return@runCatching null] = key
                }
            }
            result.takeIf { it.isNotEmpty() }
        }.getOrNull()
    }
    val result = linkedMapOf<String, String>()
    for (pair in value.split(',')) {
        val parts = pair.split(':', limit = 2)
        val kid = normalizeTvKey(parts.getOrNull(0)) ?: return null
        val key = normalizeTvKey(parts.getOrNull(1)) ?: return null
        result[kid] = key
    }
    return result.takeIf { it.isNotEmpty() }
}

private fun normalizeTvKey(value: String?): String? {
    val compact = value?.trim()?.replace("-", "")?.lowercase().orEmpty()
    if (compact.matches(Regex("[0-9a-f]{32}"))) return compact
    if (compact.isBlank()) return null
    return runCatching {
        val bytes = Base64.decode(value, Base64.DEFAULT or Base64.URL_SAFE or Base64.NO_WRAP)
        bytes.joinToString("") { byte -> "%02x".format(byte) }.takeIf { it.length == 32 }
    }.getOrNull()
}
