package org.tvshell.iptvnator.ui;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/** Validated hosted app origin. No credentials, path routing, query or fragment. */
public final class HostedOrigin {
    private static final String ACCESS_UI_SUFFIX = ".iptvnator.localhost";
    private HostedOrigin() {}

    static String accessUiOrigin(String server, String instance) {
        java.util.UUID id = java.util.UUID.nameUUIDFromBytes(
            (server + "\n" + instance).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        // HTTP permits direct HTTP streams; Chromium treats localhost as a secure context.
        return "http://" + id + ACCESS_UI_SUFFIX;
    }

    static boolean isAccessUiHost(String host) {
        if (host == null) return false;
        String name = host.toLowerCase(Locale.ROOT);
        return name.endsWith(ACCESS_UI_SUFFIX) || name.endsWith(".iptvnator.invalid");
    }

    public static String normalize(String input) {
        try {
            URI uri = new URI(input.trim());
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            String host = uri.getHost();
            String path = uri.getRawPath();
            int port = uri.getPort();
            if ((!scheme.equals("http") && !scheme.equals("https")) || host == null
                || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                || port == 0 || port > 65535 || (path != null && !path.matches("/?|/api/?"))) {
                throw new IllegalArgumentException("Invalid server address");
            }
            if ((scheme.equals("http") && port == 80) || (scheme.equals("https") && port == 443)) port = -1;
            return new URI(scheme, null, host.toLowerCase(Locale.ROOT), port, null, null, null).toASCIIString();
        } catch (URISyntaxException | NullPointerException e) {
            throw new IllegalArgumentException("Invalid server address", e);
        }
    }

    public static boolean sameOrigin(String origin, String address) {
        try {
            URI uri = new URI(address);
            return normalize(new URI(uri.getScheme(), null, uri.getHost(), uri.getPort(), null, null, null).toString()).equals(origin);
        } catch (URISyntaxException | IllegalArgumentException | NullPointerException e) {
            return false;
        }
    }
}
