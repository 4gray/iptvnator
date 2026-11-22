package org.tvshell.iptvnator.ui;

import android.net.Uri;
import android.util.Base64;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;

import okhttp3.FormBody;
import okhttp3.OkHttpClient;
import okhttp3.MediaType;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.json.JSONArray;
import org.json.JSONObject;

final class HostedAccessOAuth {
    static final String SCHEME = "org.tvshell.iptvnator";
    static final String CALLBACK = SCHEME + "://oauth/callback";
    static final String PENDING_KEY = "pending-cloudflare-sign-in";
    private static final long MAX_WAIT_MS = 10 * 60 * 1000L;
    private static final SecureRandom RANDOM = new SecureRandom();
    static final OkHttpClient HTTP = new OkHttpClient.Builder().followRedirects(false)
        .followSslRedirects(false).cookieJar(okhttp3.CookieJar.NO_COOKIES)
        .callTimeout(30, java.util.concurrent.TimeUnit.SECONDS).build();

    static final class Denied extends IOException {}
    static final class Unavailable extends IOException {}
    static final class WrongLibrary extends IOException {}
    static final class RevokedDevice extends IOException {}
    static final class NeedsInvite extends IOException {}
    static final class LibraryFailed extends IOException {
        final int status;
        LibraryFailed(int status) { this.status = status; }
    }
    final String origin;
    final String instance;
    final String invite;
    private final String tokenEndpoint;
    private final String resource;
    private final String client;
    private final String verifier;
    private final String state;
    final Uri authorization;
    private long expiresAt;
    private String pendingRecord;

    HostedAccessOAuth(String origin, String instance, String invite) throws Exception {
        if (!origin.startsWith("https://")) throw new IOException("HTTPS required");
        this.origin = origin;
        this.instance = instance;
        this.invite = invite;
        JSONObject metadata = json(new Request.Builder()
            .url(origin + "/.well-known/oauth-authorization-server").build());
        String issuer = metadata.getString("issuer");
        String authorizationEndpoint = endpoint(origin, issuer, metadata.getString("authorization_endpoint"));
        tokenEndpoint = endpoint(origin, issuer, metadata.getString("token_endpoint"));
        String registration = endpoint(origin, issuer, metadata.getString("registration_endpoint"));
        resource = origin;
        JSONObject definition = new JSONObject().put("client_name", "IPTVnator for Android")
            .put("client_uri", "https://github.com/4gray/iptvnator")
            .put("redirect_uris", new JSONArray().put(CALLBACK))
            .put("grant_types", new JSONArray().put("authorization_code").put("refresh_token"))
            .put("response_types", new JSONArray().put("code"))
            .put("token_endpoint_auth_method", "none");
        client = json(new Request.Builder().url(registration)
            .post(RequestBody.create(definition.toString(), MediaType.get("application/json"))).build())
            .getString("client_id");
        verifier = random();
        state = random();
        String challenge = Base64.encodeToString(MessageDigest.getInstance("SHA-256")
            .digest(verifier.getBytes(StandardCharsets.US_ASCII)), Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        Uri.Builder authorizationUri = Uri.parse(authorizationEndpoint).buildUpon()
            .appendQueryParameter("response_type", "code").appendQueryParameter("client_id", client)
            .appendQueryParameter("redirect_uri", CALLBACK).appendQueryParameter("resource", resource)
            .appendQueryParameter("state", state).appendQueryParameter("code_challenge", challenge)
            .appendQueryParameter("code_challenge_method", "S256");
        // A browser may still have the old hosted PWA worker controlling this origin.
        if (HostedOrigin.sameOrigin(origin, authorizationEndpoint)) {
            authorizationUri.appendQueryParameter("ngsw-bypass", "true");
        }
        authorization = authorizationUri.build();
    }

    private HostedAccessOAuth(JSONObject saved) throws Exception {
        origin = HostedOrigin.normalize(saved.getString("origin"));
        if (!origin.startsWith("https://") || !origin.equals(saved.getString("origin")))
            throw new IOException("Invalid sign-in origin");
        resource = origin;
        instance = saved.getString("instance");
        invite = saved.getString("invite");
        String address = saved.getString("tokenEndpoint");
        tokenEndpoint = endpoint(origin, address, address);
        client = saved.getString("client");
        verifier = saved.getString("verifier");
        state = saved.getString("state");
        expiresAt = saved.getLong("expiresAt");
        if (!PairingLink.opaqueId(state) || !PairingLink.opaqueId(verifier) || remainingMillis() == 0)
            throw new IOException("Invalid or expired sign-in");
        authorization = null; // The browser already owns the authorization page.
    }

    void savePending(PairedCredentialStore store) throws Exception {
        expiresAt = System.currentTimeMillis() + MAX_WAIT_MS;
        pendingRecord = store.saveRecord(PENDING_KEY, pendingData());
    }

    void awaitFallbackLink(PairedCredentialStore store) throws Exception {
        // A fallback Custom Tab can report cancellation just before delivering its deep link.
        expiresAt = Math.min(expiresAt, System.currentTimeMillis() + 700);
        pendingRecord = store.replaceRecord(PENDING_KEY, pendingRecord, pendingData());
    }

    private JSONObject pendingData() throws Exception {
        return new JSONObject().put("origin", origin)
            .put("instance", instance).put("invite", invite).put("tokenEndpoint", tokenEndpoint)
            .put("client", client).put("verifier", verifier).put("state", state).put("expiresAt", expiresAt);
    }

    static HostedAccessOAuth restorePending(PairedCredentialStore store) {
        String record = store.encryptedRecord(PENDING_KEY);
        if (record == null) return null;
        try {
            HostedAccessOAuth oauth = new HostedAccessOAuth(store.decrypt(PENDING_KEY, record));
            oauth.pendingRecord = record;
            return oauth;
        } catch (Exception invalid) {
            store.removeIfCurrent(PENDING_KEY, record::equals);
            return null;
        }
    }

    long remainingMillis() {
        long remaining = expiresAt - System.currentTimeMillis();
        return remaining > 0 && remaining <= MAX_WAIT_MS ? remaining : 0;
    }

    String launcherKey() {
        // ActivityResultRegistry saves this key outside the encrypted credential store.
        return "hosted-auth:" + java.util.UUID.nameUUIDFromBytes(state.getBytes(StandardCharsets.UTF_8));
    }

    boolean discardPending(PairedCredentialStore store) {
        return pendingRecord != null && store.removeIfCurrent(PENDING_KEY, pendingRecord::equals);
    }

    private static String random() {
        byte[] value = new byte[32];
        RANDOM.nextBytes(value);
        return Base64.encodeToString(value, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    boolean matches(Uri uri) {
        if (uri == null || !SCHEME.equals(uri.getScheme()) || !"oauth".equals(uri.getEncodedAuthority())
            || !"/callback".equals(uri.getEncodedPath()) || uri.getFragment() != null
            || uri.getQueryParameters("state").size() != 1 || !state.equals(uri.getQueryParameter("state"))) return false;
        String code = uri.getQueryParameter("code");
        String error = uri.getQueryParameter("error");
        if (error != null) return !error.isEmpty() && uri.getQueryParameters("error").size() == 1 && code == null;
        return code != null && !code.isEmpty() && code.length() <= 8192 && uri.getQueryParameters("code").size() == 1;
    }

    JSONObject finish(Uri uri, PairedCredentialStore store) throws Exception {
        if (!matches(uri) || uri.getQueryParameter("error") != null) throw new Denied();
        String code = uri.getQueryParameter("code");
        JSONObject token = token(tokenEndpoint, new FormBody.Builder().add("grant_type", "authorization_code")
            .add("client_id", client).add("code", code).add("code_verifier", verifier)
            .add("redirect_uri", CALLBACK).add("resource", resource));
        JSONObject info = json(new Request.Builder().url(origin + "/api/v1/instance")
            .header("Authorization", "Bearer " + token.getString("accessToken")).build());
        if (!"iptvnator".equals(info.optString("service")) || info.optInt("apiVersion") != 1
            || !"server".equals(info.optString("storage")) || !instance.equals(info.optString("instanceId")))
            throw new WrongLibrary();
        JSONArray capabilities = info.getJSONArray("capabilities");
        boolean supported = false;
        boolean enroll = false;
        for (int i = 0; i < capabilities.length(); i++) {
            if ("sources-v1".equals(capabilities.optString(i))) supported = true;
            if ("cloudflare-device-v1".equals(capabilities.optString(i))) enroll = true;
        }
        if (!supported) throw new IOException("Source sync unavailable");
        if (enroll || !invite.isEmpty()) {
            String key = store.accessDeviceKey(origin);
            registerDevice(token.getString("accessToken"), key);
            token.put("deviceKey", key);
        }
        return token.put("instanceId", instance).put("tokenEndpoint", tokenEndpoint)
            .put("clientId", client).put("resource", resource);
    }

    void verifyLibrary(JSONObject credential) throws Exception {
        verifyLibrary(origin, instance, credential);
    }

    static void verifyLibrary(String origin, String instance, JSONObject credential) throws Exception {
        String token = credential.getString("accessToken");
        Request.Builder request = new Request.Builder().url(origin + "/api/v1/sources")
            .header("Authorization", "Bearer " + token)
            .header("X-IPTVnator-Instance-Id", instance)
            .header("Accept", "application/json").header("Cache-Control", "no-cache");
        String key = credential.optString("deviceKey");
        if (!key.isEmpty()) request.header("X-IPTVnator-Device-Key", key);
        try (Response response = HTTP.newCall(request.build()).execute()) {
            MediaType content = response.body() == null ? null : response.body().contentType();
            if (response.code() == 200 && content != null && "json".equals(content.subtype())) return;
            if (response.code() == 409) throw new WrongLibrary();
            if (response.code() >= 500) throw new Unavailable();
            if (response.code() == 403 && "revoked".equals(response.header("X-IPTVnator-Device-Status")))
                throw new RevokedDevice();
            if (response.code() == 403 && "registration_required".equals(response.header("X-IPTVnator-Device-Status")))
                throw new NeedsInvite();
            if (response.code() == 401 || HostedAccessRedirect.isLogin(origin, response.code(), response.header("Location")))
                throw new Denied();
            throw new LibraryFailed(response.code());
        }
    }

    private void registerDevice(String token, String key) throws Exception {
        String name = ("Android " + android.os.Build.MODEL).trim();
        if (name.length() > 80) name = name.substring(0, 80);
        String body = new JSONObject().put("inviteId", invite).put("name", name).toString();
        Request request = new Request.Builder().url(origin + "/api/v1/device-pairing/cloudflare")
            .header("Authorization", "Bearer " + token).header("X-IPTVnator-Device-Key", key)
            .header("X-IPTVnator-Instance-Id", instance)
            .post(RequestBody.create(body, MediaType.get("application/json"))).build();
        try (Response response = HTTP.newCall(request).execute()) {
            if (response.code() == 204) return;
            if (response.code() == 403 && "revoked".equals(response.header("X-IPTVnator-Device-Status")))
                throw new RevokedDevice();
            if (response.code() == 403 && "registration_required".equals(response.header("X-IPTVnator-Device-Status")))
                throw new NeedsInvite();
            if (response.code() == 409) throw new WrongLibrary();
            if (response.code() >= 500) throw new Unavailable();
            if (response.code() == 401 || response.code() == 403) throw new Denied();
            throw new IOException("Device registration failed");
        }
    }

    static JSONObject refresh(JSONObject previous) throws Exception {
        String refresh = previous.optString("refreshToken");
        if (refresh.isEmpty()) throw new Denied();
        JSONObject updated = token(previous.getString("tokenEndpoint"), new FormBody.Builder()
            .add("grant_type", "refresh_token").add("refresh_token", refresh)
            .add("client_id", previous.getString("clientId")).add("resource", previous.getString("resource")));
        if (updated.optString("refreshToken").isEmpty()) updated.put("refreshToken", refresh);
        if (previous.has("deviceKey")) updated.put("deviceKey", previous.getString("deviceKey"));
        return updated.put("instanceId", previous.getString("instanceId"))
            .put("clientId", previous.getString("clientId")).put("resource", previous.getString("resource"))
            .put("tokenEndpoint", previous.getString("tokenEndpoint"));
    }

    private static JSONObject token(String endpoint, FormBody.Builder form) throws Exception {
        JSONObject result = json(new Request.Builder().url(endpoint).post(form.build()).build());
        String access = result.getString("access_token");
        if (!"bearer".equalsIgnoreCase(result.optString("token_type", "Bearer"))
            || access.isEmpty() || access.length() > 8192 || !access.matches("[!-~]+")) throw new IOException("Invalid token");
        return new JSONObject().put("accessToken", access).put("refreshToken", result.optString("refresh_token"))
            .put("expiresAt", System.currentTimeMillis() + Math.max(0, Math.min(86400, result.optLong("expires_in", 900))) * 1000L);
    }

    private static JSONObject json(Request request) throws Exception {
        try (Response response = HTTP.newCall(request).execute()) {
            if (response.code() >= 500) throw new Unavailable();
            if (response.code() == 401 || response.code() == 403 || response.code() == 400) throw new Denied();
            if (!response.isSuccessful() || response.body() == null) throw new IOException("OAuth request failed");
            if (response.body().source().request(64 * 1024 + 1)) throw new IOException("OAuth response too large");
            return new JSONObject(response.body().string());
        }
    }

    private static String endpoint(String origin, String issuer, String address) throws Exception {
        URI target = new URI(address);
        URI issuerUri = new URI(issuer);
        String issuerOrigin = HostedOrigin.normalize(issuerUri.getScheme() + "://" + issuerUri.getRawAuthority());
        String host = issuerUri.getHost();
        boolean teamHost = host != null && host.matches("[a-z0-9-]+\\.cloudflareaccess\\.com")
            && "https".equals(issuerUri.getScheme()) && issuerUri.getPort() == -1 && issuerUri.getRawUserInfo() == null;
        if ((!origin.equals(issuerOrigin) && !teamHost) || !"https".equals(target.getScheme())
            || target.getRawUserInfo() != null || target.getRawFragment() != null
            || (!HostedOrigin.sameOrigin(origin, address) && !HostedOrigin.sameOrigin(issuerOrigin, address)))
            throw new IOException("Unexpected OAuth endpoint");
        return address;
    }
}
