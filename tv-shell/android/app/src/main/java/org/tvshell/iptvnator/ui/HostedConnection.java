package org.tvshell.iptvnator.ui;

import android.app.Activity;
import android.app.AlertDialog;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.function.BooleanSupplier;

import org.json.JSONObject;
import org.tvshell.iptvnator.R;

final class HostedConnection {
    private HostedConnection() {}

    static final int PAIR_AGAIN = -1;

    static String approvalOrigin(String input) {
        String address = input.trim();
        if (address.isEmpty()) return "";
        String origin = HostedOrigin.normalize(address);
        if (!origin.startsWith("https://") || !(address.equals(origin) || address.equals(origin + "/"))) {
            throw new IllegalArgumentException("Invalid approval address");
        }
        return origin;
    }

    static int probeSavedLibrary(Activity activity, String origin, BooleanSupplier active) {
        HostedAccessSession saved = HostedAccessSession.load(activity, origin);
        if (saved == null) return probe(origin, new PairedCredentialStore(activity), active);
        try {
            saved.verifyLibrary();
            return 0;
        } catch (HostedAccessOAuth.Denied | HostedAccessOAuth.NeedsInvite e) {
            return R.string.connection_access;
        } catch (HostedAccessOAuth.RevokedDevice e) {
            return R.string.access_device_revoked;
        } catch (HostedAccessOAuth.WrongLibrary e) {
            return R.string.access_wrong_library;
        } catch (Exception e) {
            return R.string.access_tunnel_unavailable;
        }
    }

    /** Discover the identity anonymously before verifying any matching device credential. */
    private static int probe(String origin, PairedCredentialStore credentials, BooleanSupplier active) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(origin + "/api/v1/instance").openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            int code = connection.getResponseCode();
            if (HostedAccessRedirect.isLogin(origin, code, connection.getHeaderField("Location"))) {
                return R.string.connection_access;
            }
            String challenge = connection.getHeaderField("WWW-Authenticate");
            if (code == 401 && challenge != null && challenge.contains("resource_metadata="))
                return R.string.connection_access;
            if (code == 401 || code == 403) return R.string.connection_auth;
            if (code != 200) return R.string.connection_incompatible;
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream in = connection.getInputStream()) {
                byte[] buffer = new byte[1024];
                int count;
                while ((count = in.read(buffer)) != -1) {
                    if (bytes.size() + count > 16384) return R.string.connection_incompatible;
                    bytes.write(buffer, 0, count);
                }
            }
            JSONObject json = new JSONObject(bytes.toString("UTF-8"));
            String instance = json.optString("instanceId", "");
            if (!"iptvnator".equals(json.optString("service")) || json.optInt("apiVersion") != 1
                || !"server".equals(json.optString("storage")) || instance.isEmpty() || instance.length() > 200)
                return R.string.connection_incompatible;
            String auth = json.optString("auth");
            if ("none".equals(auth)) return 0;
            String savedToken = "token".equals(auth) ? credentials.read(origin, instance) : null;
            if (savedToken == null) return R.string.connection_auth;
            if (!active.getAsBoolean()) return R.string.connection_failed;
            return new PairingClient(origin).acceptsCredential(instance, savedToken) ? 0 : PAIR_AGAIN;
        } catch (javax.net.ssl.SSLException e) {
            return R.string.connection_certificate;
        } catch (java.io.IOException e) {
            return R.string.connection_failed;
        } catch (org.json.JSONException | IllegalArgumentException e) {
            return R.string.connection_incompatible;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    static AlertDialog offerAccessQr(Activity activity, Runnable scan) {
        AlertDialog.Builder dialog = new AlertDialog.Builder(activity)
            .setTitle(R.string.connection_access_title)
            .setMessage(R.string.connection_access_qr)
            .setNegativeButton(android.R.string.cancel, null);
        if (scan != null && LibraryQrScanner.available(activity)) {
            dialog.setPositiveButton(R.string.scan_qr, (ignored, button) -> scan.run());
        }
        return dialog.show();
    }
}
