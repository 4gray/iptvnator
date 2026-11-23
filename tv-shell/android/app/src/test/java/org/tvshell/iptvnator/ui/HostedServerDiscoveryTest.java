package org.tvshell.iptvnator.ui;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BiPredicate;
import okhttp3.Call;
import okhttp3.Protocol;
import okhttp3.Response;

public final class HostedServerDiscoveryTest {
    private static final String INFO = "{\"service\":\"iptvnator\",\"apiVersion\":1,\"storage\":\"server\","
        + "\"instanceId\":\"fixture\",\"auth\":\"none\",\"capabilities\":[\"sources-v1\"]}";

    public static void main(String[] args) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        String origin = "http://127.0.0.1:" + server.getAddress().getPort();
        AtomicReference<String> payload = new AtomicReference<>(INFO);
        AtomicReference<String> path = new AtomicReference<>();
        AtomicInteger status = new AtomicInteger(200);
        AtomicInteger requests = new AtomicInteger();
        server.createContext("/", exchange -> {
            requests.incrementAndGet();
            path.set(exchange.getRequestURI().toString());
            if (!"GET".equals(exchange.getRequestMethod()) || exchange.getRequestHeaders().containsKey("Authorization")
                || exchange.getRequestHeaders().containsKey("Cookie") || exchange.getRequestHeaders().containsKey("X-IPTVnator-Device-Key"))
                throw new AssertionError("Expected anonymous instance GET");
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.getResponseHeaders().set("Location", origin + "/other");
            byte[] bytes = payload.get().getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status.get(), bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();
        BiPredicate<String, String> saved = (host, instance) -> origin.equals(host) && "fixture".equals(instance);
        try {
            String root = origin + "/api", nested = origin + "/library/nas/api";
            check("sources", nested, saved);
            if (!"/library/nas/api/v1/instance".equals(path.get())) throw new AssertionError("Lost API prefix");
            String token = INFO.replace("\"none\"", "\"token\"");
            payload.set(token);
            check("token", nested, saved);
            payload.set(token.replace("\"sources-v1\"", "\"sources-v1\",\"browser-pairing-v1\""));
            check("reconnect", root, saved);
            check("pair", nested, saved);
            check("pair", root, (host, instance) -> false);
            payload.set(payload.get().replace("\"fixture\"", "\"changed\""));
            check("pair", root, saved);
            for (String invalid : new String[]{INFO.replace("\"sources-v1\"", "\"other\""), INFO.replace(":1,", ":\"1\","),
                    INFO.replace("\"server\"", "\"none\""), INFO.replace("\"fixture\"", "null"), INFO + " ".repeat(16384)}) {
                payload.set(invalid);
                check("unknown", root, saved);
            }
            status.set(302);
            int before = requests.get();
            check("unknown", root, saved);
            if (requests.get() != before + 1) throw new AssertionError("Followed metadata redirect");
            for (String invalid : new String[]{origin, root + "?mode=full", root + "#part", "file:///library/api",
                    "https://example:synthetic@library.example.test/api"}) {
                if (HostedServerDiscovery.instanceRequest(invalid) != null) throw new AssertionError("Unexpected metadata address");
            }
            Call https = HostedServerDiscovery.instanceRequest("https://library.example.test/api");
            Response access = new Response.Builder().request(https.request()).protocol(Protocol.HTTP_1_1)
                .code(401).message("Authentication required").header("WWW-Authenticate",
                    "Bearer resource_metadata=\"https://library.example.test/.well-known/oauth-protected-resource\"").build();
            if (!"access".equals(HostedServerDiscovery.classify(access, saved))) throw new AssertionError("Access challenge");
            Response unrelated = access.newBuilder().header("WWW-Authenticate", "Basic realm=\"other\"").build();
            if (!"unknown".equals(HostedServerDiscovery.classify(unrelated, saved))) throw new AssertionError("Unrelated challenge");
        } finally { server.stop(0); }
        System.out.println("Hosted server discovery checks passed");
    }

    private static void check(String expected, String api, BiPredicate<String, String> saved) throws Exception {
        try (Response response = HostedServerDiscovery.instanceRequest(api).execute()) {
            String kind = HostedServerDiscovery.classify(response, saved);
            if (!expected.equals(kind)) throw new AssertionError("Expected " + expected + ", got " + kind);
        }
    }
}
