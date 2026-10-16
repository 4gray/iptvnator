package com.iptvnator.googletv.stalker

import java.security.MessageDigest
import java.util.Locale

data class StalkerDerivedDeviceIds(
    val deviceId1: String,
    val deviceId2: String,
)

/**
 * Derives the optional MAG device-ID pair used by StbEmu and
 * `stalker-to-m3u`. This is an import-time prefill only: callers must persist
 * the returned literal values rather than derive them during later requests.
 */
fun deriveStalkerDeviceIdsFromMac(rawMac: String): StalkerDerivedDeviceIds? {
    val mac = runCatching { StalkerRequestBuilder.normalizeMac(rawMac) }.getOrNull()
        ?: return null

    fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { byte -> "%02X".format(Locale.ROOT, byte) }

    return StalkerDerivedDeviceIds(
        deviceId1 = sha256(mac),
        deviceId2 = sha256("${mac}stalker"),
    )
}
