package org.tvshell.iptvnator.ui;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.function.Predicate;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** Per-origin credentials encrypted with a non-exportable Android Keystore key. */
final class PairedCredentialStore {
    private static final String ALIAS = "iptvnator-hosted-device-v1";
    private final SharedPreferences prefs;

    PairedCredentialStore(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences("hosted-device-credentials", Context.MODE_PRIVATE);
    }

    void saveOrdinaryPairing(String origin, String instanceId, String token) throws Exception {
        if (!HostedOrigin.normalize(origin).equals(origin) || !PairingLink.opaqueId(token)) {
            throw new IllegalArgumentException("Invalid credential");
        }
        // A single preferences edit selects this pairing and invalidates the previous Access session.
        saveRecord(origin, new JSONObject().put("instanceId", instanceId).put("token", token),
            HostedAccessSession.storageKey(origin));
    }

    String saveRecord(String origin, JSONObject record) throws Exception {
        return saveRecord(origin, record, null);
    }

    private String saveRecord(String origin, JSONObject record, String supersededKey) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        cipher.updateAAD(origin.getBytes(StandardCharsets.UTF_8));
        String plaintext = record.toString();
        JSONObject envelope = new JSONObject()
            .put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
            .put("data", Base64.encodeToString(cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP));
        String encrypted = envelope.toString();
        synchronized (prefs) {
            SharedPreferences.Editor changes = prefs.edit().putString(origin, encrypted);
            if (supersededKey != null) changes.remove(supersededKey);
            if (!changes.commit()) throw new java.io.IOException("Could not save credential");
        }
        return encrypted;
    }

    String replaceRecord(String origin, String previous, JSONObject updated) throws Exception {
        // Each Activity or probe has its own store, but Android shares these preferences across them.
        synchronized (prefs) {
            if (!previous.equals(encryptedRecord(origin))) throw new java.io.IOException("Pairing changed during refresh");
            return saveRecord(origin, updated);
        }
    }

    String accessDeviceKey(String origin) throws Exception {
        synchronized (prefs) {
            String storage = "cloudflare-device:" + origin;
            JSONObject record = readRecord(storage);
            if (record != null) return record.getString("key");
            byte[] nonce = new byte[32];
            new java.security.SecureRandom().nextBytes(nonce);
            String value = Base64.encodeToString(nonce, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
            saveRecord(storage, new JSONObject().put("key", value));
            return value;
        }
    }

    String read(String origin, String instanceId) {
        JSONObject record = readRecord(origin);
        return record != null && instanceId.equals(record.optString("instanceId")) ? record.optString("token", null) : null;
    }

    String encryptedRecord(String origin) {
        try { return prefs.getString(origin, null); }
        catch (ClassCastException invalidRecord) { return null; }
    }

    JSONObject readRecord(String origin) { return decrypt(origin, encryptedRecord(origin)); }

    JSONObject decrypt(String origin, String stored) {
        try {
            if (stored == null) return null;
            JSONObject envelope = new JSONObject(stored);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)));
            cipher.updateAAD(origin.getBytes(StandardCharsets.UTF_8));
            return new JSONObject(new String(cipher.doFinal(Base64.decode(envelope.getString("data"), Base64.NO_WRAP)), StandardCharsets.UTF_8));
        } catch (Exception e) { return null; }
    }

    boolean contains(String origin) { return prefs.contains(origin); }

    boolean remove(String... origins) {
        synchronized (prefs) {
            SharedPreferences.Editor changes = prefs.edit();
            for (String origin : origins) changes.remove(origin);
            return changes.commit();
        }
    }

    boolean removeIfCurrent(String origin, Predicate<String> matches) {
        synchronized (prefs) {
            return matches.test(encryptedRecord(origin)) && remove(origin);
        }
    }

    boolean forget(String origin, String instanceId) {
        synchronized (prefs) {
            if (read(origin, instanceId) != null) return remove(origin);
            return !prefs.contains(origin);
        }
    }

    void clear() {
        synchronized (prefs) { prefs.edit().clear().commit(); }
    }

    private static synchronized SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
}
