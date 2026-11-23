package org.tvshell.iptvnator.ui;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Fixed-route JSON transport: no redirects, credentials in bodies only, bounded responses. */
final class PairingTransport {
    static final class StatusException extends IOException {
        final int status;
        StatusException(int status) { super("Pairing request failed: " + status); this.status = status; }
    }

    static boolean trustedAccessRedirect(String origin, String trusted, int status, String location) {
        return origin.equals(trusted) && HostedAccessRedirect.isLogin(origin, status, location);
    }

    static boolean isAccessProtected(String origin, String trusted) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(HostedOrigin.normalize(origin) + "/api/v1/instance").openConnection();
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setUseCaches(false);
            return trustedAccessRedirect(origin, trusted, connection.getResponseCode(), connection.getHeaderField("Location"));
        } finally { connection.disconnect(); }
    }

    static String request(String origin, String path, String body) throws IOException {
        return request(origin, path, body, null);
    }

    static String request(String origin, String path, String body, String token) throws IOException {
        if (!path.equals("/api/v1/instance") && !path.equals("/api/v1/device-pairing/claim")
            && !path.equals("/api/v1/device-pairing/start") && !path.equals("/api/v1/device-pairing/complete")
            && !path.equals("/api/v1/device-pairing/device-request") && !path.equals("/api/v1/device-pairing/device-approve")) throw new IOException("Invalid route");
        boolean approval = path.endsWith("/device-request") || path.endsWith("/device-approve");
        if (approval != (token != null) || (token != null && !PairingLink.opaqueId(token))) throw new IOException("Invalid credential");
        HttpURLConnection connection = (HttpURLConnection) new URL(HostedOrigin.normalize(origin) + path).openConnection();
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setUseCaches(false);
            connection.setRequestProperty("Accept", "application/json");
            if (token != null) connection.setRequestProperty("Authorization", "Bearer " + token);
            if (body != null) {
                byte[] payload = body.getBytes(StandardCharsets.UTF_8);
                connection.setRequestMethod("POST");
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setFixedLengthStreamingMode(payload.length);
                try (OutputStream out = connection.getOutputStream()) { out.write(payload); }
            }
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new StatusException(status);
            if (status == 204) return "";
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream in = connection.getInputStream()) {
                byte[] buffer = new byte[1024];
                int count;
                while ((count = in.read(buffer)) != -1) {
                    if (bytes.size() + count > 16384) throw new IOException("Invalid response");
                    bytes.write(buffer, 0, count);
                }
            }
            return bytes.toString("UTF-8");
        } finally { connection.disconnect(); }
    }
}
