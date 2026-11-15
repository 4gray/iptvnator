package org.tvshell.iptvnator.ui;

/** JVM regression checks, runnable without an Android runtime. */
public class HostedOriginTest {
    private static void equal(String expected, String actual) {
        if (!expected.equals(actual)) throw new AssertionError(actual);
    }
    private static void reject(String address) {
        try { HostedOrigin.normalize(address); throw new AssertionError(address); }
        catch (IllegalArgumentException expected) { }
    }
    public static void main(String[] args) {
        equal("http://server.example", HostedOrigin.normalize(" HTTP://Server.Example:80/api/ "));
        equal("https://server.example", HostedOrigin.normalize("https://server.example:443/"));
        equal("http://server.example:8080", HostedOrigin.normalize("http://server.example:8080"));
        equal("http://[::1]:8080", HostedOrigin.normalize("http://[::1]:8080/api"));
        reject("https://user:password@server.example");
        reject("file:///etc/passwd");
        reject("https://server.example/other");
        reject("https://server.example/?token=secret");
        reject("https://server.example:0");
        if (!HostedOrigin.sameOrigin("https://server.example", "https://server.example:443/path")) throw new AssertionError();
        if (HostedOrigin.sameOrigin("https://server.example", "https://server.example.evil.test/path")) throw new AssertionError();
        if (HostedOrigin.sameOrigin("https://server.example", "http://server.example/path")) throw new AssertionError();
        if (HostedOrigin.sameOrigin("https://server.example", "https://server.example:444/path")) throw new AssertionError();
    }
}
