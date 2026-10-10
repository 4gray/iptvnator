package com.iptvnator.googletv.playlist

import android.content.Context
import android.util.Base64
import com.iptvnator.googletv.xtream.XtreamCredentials
import com.iptvnator.googletv.stalker.StalkerCredentials
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Encrypts provider credentials with an Android Keystore AES key. */
class TvCredentialVault(context: Context) {
    private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    fun save(id: String, credentials: XtreamCredentials) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val payload = JSONObject()
            .put("serverUrl", credentials.serverUrl)
            .put("username", credentials.username)
            .put("password", credentials.password)
            .toString()
        val encoded = encode(cipher.iv) + ":" + encode(cipher.doFinal(payload.toByteArray(Charsets.UTF_8)))
        preferences.edit().putString(id, encoded).apply()
    }

    fun load(id: String): XtreamCredentials? {
        val stored = preferences.getString(id, null) ?: return null
        return runCatching {
            val parts = stored.split(':', limit = 2)
            require(parts.size == 2)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_BITS, decode(parts[0])))
            val root = JSONObject(String(cipher.doFinal(decode(parts[1])), Charsets.UTF_8))
            XtreamCredentials(
                serverUrl = root.getString("serverUrl"),
                username = root.getString("username"),
                password = root.getString("password"),
            )
        }.getOrNull()
    }

    fun saveStalker(id: String, credentials: StalkerCredentials) {
        savePayload(id, JSONObject()
            .put("provider", "stalker")
            .put("portalUrl", credentials.portalUrl)
            .put("macAddress", credentials.macAddress)
            .put("serialNumber", credentials.serialNumber)
            .put("username", credentials.username)
            .put("password", credentials.password)
            .put("deviceId1", credentials.deviceId1)
            .put("deviceId2", credentials.deviceId2)
            .put("signature1", credentials.signature1)
            .put("signature2", credentials.signature2))
    }

    fun loadStalker(id: String): StalkerCredentials? = runCatching {
        val root = decrypt(preferences.getString(id, null) ?: return null)
        if (root.optString("provider") != "stalker") return null
        StalkerCredentials(
            portalUrl = root.getString("portalUrl"),
            macAddress = root.getString("macAddress"),
            serialNumber = root.optString("serialNumber").takeIf { it.isNotBlank() },
            username = root.optString("username").takeIf { it.isNotBlank() },
            password = root.optString("password").takeIf { it.isNotBlank() },
            deviceId1 = root.optString("deviceId1").takeIf { it.isNotBlank() },
            deviceId2 = root.optString("deviceId2").takeIf { it.isNotBlank() },
            signature1 = root.optString("signature1").takeIf { it.isNotBlank() },
            signature2 = root.optString("signature2").takeIf { it.isNotBlank() },
        )
    }.getOrNull()

    fun remove(id: String) {
        preferences.edit().remove(id).apply()
    }

    fun saveTmdbApiKey(apiKey: String) {
        savePayload(TMDB_KEY_ID, JSONObject().put("provider", "tmdb").put("apiKey", apiKey))
    }

    fun loadTmdbApiKey(): String? = runCatching {
        decrypt(preferences.getString(TMDB_KEY_ID, null) ?: return null)
            .takeIf { it.optString("provider") == "tmdb" }
            ?.optString("apiKey")
            ?.takeIf { it.isNotBlank() }
    }.getOrNull()

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KEY_ALGORITHM, ANDROID_KEYSTORE)
        generator.init(android.security.keystore.KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or
                android.security.keystore.KeyProperties.PURPOSE_DECRYPT,
        ).setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
            .build())
        return generator.generateKey()
    }

    private fun encode(value: ByteArray): String = Base64.encodeToString(value, Base64.NO_WRAP)

    private fun decode(value: String): ByteArray = Base64.decode(value, Base64.NO_WRAP)

    private fun savePayload(id: String, payload: JSONObject) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val encoded = encode(cipher.iv) + ":" + encode(cipher.doFinal(payload.toString().toByteArray(Charsets.UTF_8)))
        preferences.edit().putString(id, encoded).apply()
    }

    private fun decrypt(stored: String): JSONObject {
        val parts = stored.split(':', limit = 2)
        require(parts.size == 2)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_BITS, decode(parts[0])))
        return JSONObject(String(cipher.doFinal(decode(parts[1])), Charsets.UTF_8))
    }

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALGORITHM = "AES"
        private const val KEY_ALIAS = "iptvnator-tv-provider-credentials"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val TAG_BITS = 128
        private const val PREFERENCES = "iptvnator-tv-secure-state"
        private const val TMDB_KEY_ID = "tmdb-api-key"
    }
}
