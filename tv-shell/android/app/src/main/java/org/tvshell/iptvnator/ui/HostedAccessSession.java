package org.tvshell.iptvnator.ui;

import android.content.Context;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import okhttp3.Call;
import okhttp3.MediaType;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.json.JSONObject;

final class HostedAccessSession {
    private static final Set<String> renewingPairings = new HashSet<>();
    private final PairedCredentialStore store;
    final String origin;
    final String instance;
    final String uiOrigin;
    private final String deviceKey;
    private final String pairingId;
    private JSONObject credential;
    private volatile String encryptedRecord;

    HostedAccessSession(PairedCredentialStore store, String origin, JSONObject credential, String encryptedRecord) {
        this.store = store;
        this.origin = origin;
        this.credential = credential;
        this.encryptedRecord = encryptedRecord;
        // Older records have no pairing ID. Their original ciphertext identifies that sign-in until refresh.
        pairingId = credential.has("pairingId") ? credential.optString("pairingId")
            : UUID.nameUUIDFromBytes(encryptedRecord.getBytes(StandardCharsets.UTF_8)).toString();
        instance = credential.optString("instanceId");
        uiOrigin = HostedOrigin.accessUiOrigin(origin, instance);
        deviceKey = credential.optString("deviceKey");
    }

    static String storageKey(String origin) { return "oauth:" + origin; }

    static HostedAccessSession load(Context context, String origin) {
        if (!origin.startsWith("https://")) return null;
        PairedCredentialStore store = new PairedCredentialStore(context);
        String key = storageKey(origin);
        String encrypted = store.encryptedRecord(key);
        JSONObject record = store.decrypt(key, encrypted);
        return record == null ? null : new HostedAccessSession(store, origin, record, encrypted);
    }

    boolean forget() {
        return store.removeIfCurrent(storageKey(origin), stored -> currentCredential(stored) != null);
    }

    private JSONObject currentCredential(String stored) {
        if (encryptedRecord.equals(stored)) return credential;
        JSONObject latest = store.decrypt(storageKey(origin), stored);
        return latest != null && pairingId.equals(latest.optString("pairingId")) ? latest : null;
    }

    private void requireCurrentPairing() throws IOException {
        if (currentCredential(store.encryptedRecord(storageKey(origin))) == null) throw new IOException("Pairing changed");
    }

    synchronized String accessToken(String rejected) throws Exception {
        // A bridge and a connection probe can hold separate sessions for the same rotating token.
        synchronized (renewingPairings) {
            while (!renewingPairings.add(pairingId)) renewingPairings.wait();
        }
        try {
            return readOrRenewToken(rejected);
        } finally {
            synchronized (renewingPairings) {
                renewingPairings.remove(pairingId);
                renewingPairings.notifyAll();
            }
        }
    }

    private String readOrRenewToken(String rejected) throws Exception {
        String stored = store.encryptedRecord(storageKey(origin));
        JSONObject latest = currentCredential(stored);
        if (latest == null) throw new IOException("Pairing changed");
        credential = latest;
        encryptedRecord = stored;
        String current = credential.getString("accessToken");
        if (current.equals(rejected) || credential.getLong("expiresAt") <= System.currentTimeMillis() + 5_000) {
            JSONObject updated = HostedAccessOAuth.refresh(credential);
            updated.put("pairingId", pairingId);
            String encrypted = store.replaceRecord(storageKey(origin), stored, updated);
            credential = updated;
            encryptedRecord = encrypted;
            current = updated.getString("accessToken");
        }
        return current;
    }

    synchronized void verifyLibrary() throws Exception {
        String token = accessToken(null);
        try {
            HostedAccessOAuth.verifyLibrary(origin, instance, credential);
        } catch (HostedAccessOAuth.Denied expired) {
            accessToken(token);
            HostedAccessOAuth.verifyLibrary(origin, instance, credential);
        }
        requireCurrentPairing();
    }

    Call call(JSONObject input, String token, RequestBody upload) throws Exception {
        requireCurrentPairing();
        return HostedApiRequest.call(origin, instance, token, deviceKey, input, upload);
    }

    String createDeviceInvite() throws Exception {
        JSONObject input = new JSONObject()
            .put("path", "/api/v1/device-pairing/cloudflare-invite").put("method", "POST");
        RequestBody body = RequestBody.create(new byte[0], MediaType.get("application/json"));
        String token = accessToken(null);
        try (Response response = call(input, token, body).execute()) {
            if (response.code() != 401) return deviceInvite(response);
        }
        try (Response response = call(input, accessToken(token), body).execute()) {
            return deviceInvite(response);
        }
    }

    private String deviceInvite(Response response) throws Exception {
        if (response.code() == 403) throw new PairingTransport.StatusException(403);
        if (response.code() != 201 || response.body() == null
            || response.body().source().request(4097)) throw new IOException("Could not create invitation");
        String invite = new JSONObject(response.body().string()).getString("inviteId");
        if (!PairingLink.opaqueId(invite)) throw new IOException("Invalid invitation");
        return origin + "/connect-device.html#iptvnator-access=" + instance + "&invite=" + invite;
    }

}
