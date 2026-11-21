package org.tvshell.iptvnator.ui;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/** Real local HTTP checks: redirect refusal, body-only secrets and bounded replies. */
public final class PairingTransportTest {
    public static void main(String[] args) throws Exception {
        String access = "https://team.cloudflareaccess.com/cdn-cgi/access/login/host";
        if (!PairingTransport.trustedAccessRedirect("https://server.example", "https://server.example", 302, access)) throw new AssertionError();
        if (PairingTransport.trustedAccessRedirect("https://server.example", "https://other.example", 302, access)
            || PairingTransport.trustedAccessRedirect("https://server.example", "", 302, access)
            || PairingTransport.trustedAccessRedirect("https://server.example", "https://server.example", 403, access)
            || PairingTransport.trustedAccessRedirect("https://server.example", "https://server.example", 302, "https://evil.example/")) throw new AssertionError();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        String origin = "http://127.0.0.1:" + server.getAddress().getPort();
        AtomicInteger code = new AtomicInteger(200);
        AtomicInteger targetHits = new AtomicInteger();
        AtomicReference<String> reply = new AtomicReference<>("{\"status\":\"pending\"}");
        AtomicReference<String> body = new AtomicReference<>();
        AtomicReference<String> method = new AtomicReference<>();
        AtomicReference<String> query = new AtomicReference<>();
        server.createContext("/api/v1/device-pairing/complete", exchange -> {
            body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            method.set(exchange.getRequestMethod());
            query.set(exchange.getRequestURI().getRawQuery());
            exchange.getResponseHeaders().set("Location", origin + "/redirect-target");
            byte[] bytes = reply.get().getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(code.get(), bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        AtomicReference<String> auth = new AtomicReference<>();
        server.createContext("/api/v1/device-pairing/device-approve", exchange -> {
            auth.set(exchange.getRequestHeaders().getFirst("Authorization"));
            body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            exchange.getResponseHeaders().set("Location", origin + "/redirect-target");
            exchange.sendResponseHeaders(code.get(), -1);
            exchange.close();
        });
        server.createContext("/redirect-target", exchange -> {
            targetHits.incrementAndGet();
            exchange.sendResponseHeaders(200, -1);
            exchange.close();
        });
        server.start();
        String request = "{\"claimSecret\":\"synthetic-secret\"}";
        try {
            if (!reply.get().equals(PairingTransport.request(origin, "/api/v1/device-pairing/complete", request))) throw new AssertionError();
            if (!request.equals(body.get()) || !"POST".equals(method.get()) || query.get() != null) throw new AssertionError("Incorrect request");
            for (int status : new int[] {301, 302, 303, 307, 308, 401, 403, 410, 500}) {
                code.set(status);
                reject(origin, request);
            }
            if (targetHits.get() != 0) throw new AssertionError("Followed redirect");
            String token = "a".repeat(43);
            code.set(204);
            if (!"".equals(PairingTransport.request(origin, "/api/v1/device-pairing/device-approve", "{\"claimId\":\"sample\"}", token))
                || !("Bearer " + token).equals(auth.get()) || !"{\"claimId\":\"sample\"}".equals(body.get())) throw new AssertionError();
            for (int status : new int[] {403, 404}) {
                code.set(status);
                try { PairingTransport.request(origin, "/api/v1/device-pairing/device-approve", "{}", token); throw new AssertionError(); }
                catch (PairingTransport.StatusException expected) { if (expected.status != status) throw new AssertionError(); }
            }
            code.set(302);
            try { PairingTransport.request(origin, "/api/v1/device-pairing/device-approve", "{}", token); throw new AssertionError(); }
            catch (java.io.IOException expected) { }
            if (targetHits.get() != 0) throw new AssertionError("Sent credential to redirect");
            try { PairingTransport.request(origin, "/api/v1/instance", null, token); throw new AssertionError(); }
            catch (java.io.IOException expected) { }
            code.set(200);
            reply.set("x".repeat(16385));
            reject(origin, request);
            try { PairingTransport.request(origin, "/unexpected?token=secret", request); throw new AssertionError(); }
            catch (java.io.IOException expected) { }
        } finally { server.stop(0); }
        System.out.println("Pairing transport checks passed");
    }

    private static void reject(String origin, String request) throws Exception {
        try { PairingTransport.request(origin, "/api/v1/device-pairing/complete", request); throw new AssertionError("Accepted bad response"); }
        catch (java.io.IOException expected) {
            if (expected.getMessage().contains("synthetic-secret")) throw new AssertionError("Secret leaked");
        }
    }
}
