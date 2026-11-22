package org.tvshell.iptvnator.ui;

import java.io.IOException;
import okhttp3.MediaType;
import okhttp3.Request;
import okhttp3.Response;
import org.json.JSONObject;

/** Bounded requests to the confirmed origin. Redirects never receive pairing credentials. */
final class PairingClient {
    private final String origin;

    PairingClient(String origin) { this.origin = HostedOrigin.normalize(origin); }

    String instance() throws Exception {
        JSONObject json = request("/api/v1/instance", null);
        String id = json.optString("instanceId", "");
        if (!"iptvnator".equals(json.optString("service"))
            || !"server".equals(json.optString("storage")) || id.isEmpty() || id.length() > 200) {
            throw new IOException("Incompatible server");
        }
        return id;
    }

    /** Called after anonymous instance verification and native confirmation of this origin. */
    boolean acceptsCredential(String instance, String token) throws IOException {
        Request request = new Request.Builder().url(origin + "/api/v1/sources")
            .header("Authorization", "Bearer " + token)
            .header("X-IPTVnator-Instance-Id", instance)
            .header("Accept", "application/json").header("Cache-Control", "no-cache").build();
        try (Response response = HostedAccessOAuth.HTTP.newCall(request).execute()) {
            if (response.code() == 401 || response.code() == 403) return false;
            MediaType type = response.body() == null ? null : response.body().contentType();
            if (response.code() != 200 || type == null || !"application".equals(type.type()) || !"json".equals(type.subtype()))
                throw new IOException("Protected source inventory unavailable");
            return true;
        }
    }

    JSONObject claim(String invite) throws Exception {
        JSONObject body = new JSONObject().put("inviteId", invite).put("name", "Android device");
        JSONObject result = request("/api/v1/device-pairing/claim", body);
        return validateClaim(result);
    }

    JSONObject start() throws Exception {
        return validateClaim(request("/api/v1/device-pairing/start", new JSONObject().put("name", "Android TV")));
    }

    private JSONObject validateClaim(JSONObject result) throws IOException {
        if (!PairingLink.opaqueId(result.optString("claimId"))
            || !PairingLink.opaqueId(result.optString("claimSecret"))
            || !result.optString("confirmationCode").matches("[0-9]{6}")) {
            throw new IOException("Invalid claim");
        }
        return result;
    }

    JSONObject complete(JSONObject claim) throws Exception {
        return request("/api/v1/device-pairing/complete", new JSONObject()
            .put("claimId", claim.getString("claimId")).put("claimSecret", claim.getString("claimSecret")));
    }

    private JSONObject request(String path, JSONObject body) throws Exception {
        return new JSONObject(PairingTransport.request(origin, path, body == null ? null : body.toString()));
    }
}
