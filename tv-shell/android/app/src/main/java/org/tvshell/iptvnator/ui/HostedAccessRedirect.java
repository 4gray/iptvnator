package org.tvshell.iptvnator.ui;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/** A diagnostic hint only: never authorizes a server or follows a Location header. */
public final class HostedAccessRedirect {
    private HostedAccessRedirect() {}

    public static boolean isLogin(String origin, int status, String location) {
        if (status != 301 && status != 302 && status != 303 && status != 307 && status != 308) return false;
        try {
            URI base = new URI(HostedOrigin.normalize(origin));
            URI target = base.resolve(new URI(location));
            String host = target.getHost();
            String path = target.getRawPath();
            if (!"https".equals(base.getScheme()) || !"https".equalsIgnoreCase(target.getScheme())
                || host == null || target.getRawUserInfo() != null || target.getRawFragment() != null
                || (target.getPort() != -1 && target.getPort() != 443)) return false;
            boolean accessHost = host.toLowerCase(Locale.ROOT).endsWith(".cloudflareaccess.com")
                || HostedOrigin.sameOrigin(origin, target.toString());
            return accessHost && path != null && (path.equals("/cdn-cgi/access/login")
                || path.startsWith("/cdn-cgi/access/login/"));
        } catch (URISyntaxException | IllegalArgumentException | NullPointerException e) {
            return false;
        }
    }
}
