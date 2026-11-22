package org.tvshell.iptvnator.ui;

import android.content.Context;
import android.util.Base64;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.json.JSONObject;

final class HostedAccessSession {
    private static final int REQUEST_LIMIT = 16 * 1024 * 1024;
    private static final Set<String> renewingPairings = new HashSet<>();
    private static final OkHttpClient API = HostedAccessOAuth.HTTP.newBuilder()
        .callTimeout(0, TimeUnit.SECONDS).readTimeout(45, TimeUnit.SECONDS).build();
    private final PairedCredentialStore store;
    final String origin;
    final String instance;
    final String uiOrigin;
    private final String deviceKey;
    private final String pairingId;
    private JSONObject credential;
    private volatile String encryptedRecord;

    private HostedAccessSession(PairedCredentialStore store, String origin, JSONObject credential, String encryptedRecord) {
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

    Call call(JSONObject input, String token) throws Exception {
        requireCurrentPairing();
        String path = input.getString("path");
        String method = input.getString("method");
        if (!allowed(path, method)) throw new IOException("Unsupported hosted request");
        Request.Builder request = new Request.Builder().url(origin + path)
            .header("Authorization", "Bearer " + token)
            .header("X-IPTVnator-Instance-Id", instance);
        if (!deviceKey.isEmpty()) request.header("X-IPTVnator-Device-Key", deviceKey);
        JSONObject headers = input.optJSONObject("headers");
        String contentType = "application/json";
        if (headers != null) {
            contentType = headers.optString("content-type", contentType);
            for (String name : new String[]{"if-match", "if-none-match", "accept"})
                if (headers.has(name)) request.header(name, headers.getString(name));
        }
        byte[] bytes = Base64.decode(input.optString("body"), Base64.DEFAULT);
        if (bytes.length > REQUEST_LIMIT) throw new IOException("Hosted request is too large");
        RequestBody body = ("GET".equals(method) || "HEAD".equals(method) ||
            ("DELETE".equals(method) && bytes.length == 0)) ? null : RequestBody.create(bytes, MediaType.get(contentType));
        return API.newCall(request.method(method, body).build());
    }

    String createDeviceInvite() throws Exception {
        JSONObject input = new JSONObject()
            .put("path", "/api/v1/device-pairing/cloudflare-invite").put("method", "POST");
        String token = accessToken(null);
        try (Response response = call(input, token).execute()) {
            if (response.code() != 401) return deviceInvite(response);
        }
        try (Response response = call(input, accessToken(token)).execute()) {
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

    static JSONObject responseHeaders(Response response) throws Exception {
        JSONObject headers = new JSONObject();
        for (String name : new String[]{"content-type", "etag", "cache-control", "www-authenticate", "x-iptvnator-device-status"}) {
            String value = response.header(name);
            if (value != null) headers.put(name, value);
        }
        return new JSONObject().put("status", response.code()).put("headers", headers);
    }

    private static boolean allowed(String url, String method) {
        if (url.length() > 32768 || url.contains("#") || url.contains("\\")) return false;
        String path = url.split("\\?", 2)[0];
        String lower = path.toLowerCase(Locale.ROOT);
        if (path.contains("..") || lower.contains("%2e") || lower.contains("%2f") || lower.contains("%5c") ||
            path.contains("//") || !method.matches("GET|HEAD|POST|PUT|PATCH|DELETE")) return false;
        if (path.equals("/api/v1/instance")) return method.equals("GET") || method.equals("HEAD");
        if (path.matches("/api/v1/(sources|playlists|activity|favorites|history|user-state|app-state)(/[^/?]+)*")) return true;
        if (path.matches("/api/(parse|parse-xml|xtream|stalker)")) return method.equals("GET");
        return path.matches("/api/(provider-targets|connectivity-guard/reset|v1/tmdb-transfer|v1/device-pairing/cloudflare-invite)") && method.equals("POST");
    }
}
