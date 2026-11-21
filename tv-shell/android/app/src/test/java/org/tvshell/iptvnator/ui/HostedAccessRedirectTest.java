package org.tvshell.iptvnator.ui;

/** JVM checks: this hint must never mistake arbitrary redirects for an Access login. */
public class HostedAccessRedirectTest {
    private static void check(boolean expected, int code, String location) {
        if (HostedAccessRedirect.isLogin("https://server.example", code, location) != expected) {
            throw new AssertionError("Unexpected redirect classification: " + code + " " + location);
        }
    }

    public static void main(String[] args) throws Exception {
        org.tvshell.iptvnator.LayoutPolicyTest.main(args);
        HostedOriginTest.main(args);
        PairingLinkTest.main(args);
        PairingQrTest.main(args);
        PairingTransportTest.main(args);
        PairingAttemptsTest.main(args);
        for (int status : new int[] {301, 302, 303, 307, 308}) {
            check(true, status, "https://team.cloudflareaccess.com/cdn-cgi/access/login/server.example?redirect_url=%2F");
        }
        check(true, 302, "/cdn-cgi/access/login/server.example");
        check(true, 302, "https://TEAM.CLOUDFLAREACCESS.COM:443/cdn-cgi/access/login");
        check(false, 200, "https://team.cloudflareaccess.com/cdn-cgi/access/login");
        check(false, 401, "https://team.cloudflareaccess.com/cdn-cgi/access/login");
        check(false, 304, "https://team.cloudflareaccess.com/cdn-cgi/access/login");
        check(false, 302, "https://team.cloudflareaccess.com.evil.test/cdn-cgi/access/login");
        check(false, 302, "https://evilcloudflareaccess.com/cdn-cgi/access/login");
        check(false, 302, "https://cloudflareaccess.com@evil.test/cdn-cgi/access/login");
        check(false, 302, "https://user@team.cloudflareaccess.com/cdn-cgi/access/login");
        check(false, 302, "http://team.cloudflareaccess.com/cdn-cgi/access/login");
        check(false, 302, "https://team.cloudflareaccess.com:444/cdn-cgi/access/login");
        check(false, 302, "https://team.cloudflareaccess.com/cdn-cgi/access/login-evil");
        check(false, 302, "https://team.cloudflareaccess.com/cdn-cgi/access/login#fragment");
        check(false, 302, "https://team.cloudflareaccess.com/other");
        check(false, 302, "javascript:alert(1)");
        check(false, 302, "https://[");
        check(false, 302, null);
        if (HostedAccessRedirect.isLogin("http://server.example", 302,
            "https://team.cloudflareaccess.com/cdn-cgi/access/login")) throw new AssertionError();
        System.out.println("Hosted Access redirect checks passed");
    }
}
