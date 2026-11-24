package org.tvshell.iptvnator.ui;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.function.BooleanSupplier;
import okhttp3.Call;
import okhttp3.HttpUrl;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.json.JSONObject;

/** A single source-sync endpoint, scoped to its API prefix and confirmed library identity. */
final class NasLibrarySession {
    private static final RequestBody EMPTY = RequestBody.create(new byte[0], null);
    final String appBase;
    final String instance;
    final String serverOrigin;
    final String uiOrigin;
    private final String token;
    // Null until anonymous discovery authorizes this endpoint and instance.
    private String verifiedToken;

    private NasLibrarySession(String appBase, String instance, String token) {
        this.appBase = appBase;
        this.instance = instance;
        serverOrigin = HostedOrigin.normalize(HttpUrl.get(appBase).resolve("/").toString());
        this.token = token;
        uiOrigin = HostedOrigin.accessUiOrigin("nas:" + appBase, instance);
    }

    static String storageKey(String appBase) { return "nas:" + appBase; }

    static NasLibrarySession load(PairedCredentialStore store, String appBase) {
        JSONObject record = store.readRecord(storageKey(appBase));
        if (record == null || record.optString("instanceId").isEmpty()) return null;
        return new NasLibrarySession(appBase, record.optString("instanceId"), record.optString("token"));
    }

    static NasLibrarySession connect(PairedCredentialStore store, String apiUrl, String enteredToken,
                                     BooleanSupplier active) throws Exception {
        Call discovery = HostedServerDiscovery.instanceRequest(apiUrl);
        if (discovery == null) throw new IOException("Invalid source server address");
        String base = apiUrl.substring(0, apiUrl.length() - "/api".length());
        Map<?, ?> info;
        try (Response response = discovery.execute()) { info = metadata(response); }
        if (info == null || !active.getAsBoolean()) throw new IOException("Incompatible or cancelled source server");
        String instance = (String) info.get("instanceId");
        String token = "";
        if ("token".equals(info.get("auth"))) {
            token = enteredToken.isEmpty() ? store.read(storageKey(base), instance) : enteredToken;
            if (token == null || token.isEmpty()) throw new AuthenticationRequired();
        }
        NasLibrarySession result = new NasLibrarySession(base, instance, token);
        result.verifiedToken = token;
        JSONObject sourceList = new JSONObject().put("path", "/api/v1/sources").put("method", "GET");
        try (Response response = result.call(sourceList, EMPTY).execute()) {
            if (response.code() == 401 || response.code() == 403) throw new AuthenticationRequired();
            okhttp3.MediaType type = response.body() == null ? null : response.body().contentType();
            if (response.code() != 200 || type == null || !"application".equals(type.type()) || !"json".equals(type.subtype()))
                throw new IOException("Source inventory unavailable");
        }
        return result;
    }

    void save(PairedCredentialStore store) throws Exception {
        store.saveRecord(storageKey(appBase), new JSONObject().put("instanceId", instance).put("token", token));
    }

    static final class AuthenticationRequired extends IOException {}

    private static Map<?, ?> metadata(Response response) throws IOException {
        Map<?, ?> info = HostedServerDiscovery.sourceMetadata(response);
        if (info == null) return null;
        List<?> capabilities = (List<?>) info.get("capabilities");
        if (capabilities.contains("cloudflare-device-v1") ||
            ("token".equals(info.get("auth")) && capabilities.contains("browser-pairing-v1"))) return null;
        return info;
    }

    private static boolean discovery(JSONObject input) {
        String path = input.optString("path").split("\\?", 2)[0];
        return "/api/v1/instance".equals(path);
    }

    void observe(JSONObject input, Response response) throws IOException {
        if (discovery(input) && "GET".equals(input.optString("method"))) verifyResponse(response);
    }

    private synchronized void verifyResponse(Response response) throws IOException {
        verifiedToken = null;
        Map<?, ?> info = metadata(response);
        if (info != null && instance.equals(info.get("instanceId")))
            verifiedToken = "token".equals(info.get("auth")) ? token : "";
    }

    private synchronized String verifiedToken() throws IOException {
        if (verifiedToken != null) return verifiedToken;
        Call discovery = HostedServerDiscovery.instanceRequest(appBase + "/api");
        if (discovery == null) throw new IOException("Invalid source server address");
        try (Response response = discovery.execute()) {
            verifyResponse(response);
            if (verifiedToken == null) throw new IOException("Source library changed");
            return verifiedToken;
        }
    }

    Call call(JSONObject input, RequestBody body) throws Exception {
        boolean publicRequest = discovery(input);
        return HostedApiRequest.call(appBase, publicRequest ? "" : instance,
            publicRequest ? "" : verifiedToken(), "", input, body);
    }
}
