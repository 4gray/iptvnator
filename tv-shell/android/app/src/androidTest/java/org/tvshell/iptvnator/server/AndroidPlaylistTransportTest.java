package org.tvshell.iptvnator.server;

import fi.iki.elonen.NanoHTTPD;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import junit.framework.TestCase;
import okhttp3.Call;
import okhttp3.EventListener;
import okhttp3.OkHttpClient;
import org.json.JSONObject;
import org.tvshell.iptvnator.backend.WebBackend;

public class AndroidPlaylistTransportTest extends TestCase {
    public void testPlaylistFallsBackToAnotherAddressAndPreservesUserAgent() throws Exception {
        AtomicReference<String> userAgent = new AtomicReference<>();
        NanoHTTPD provider = new NanoHTTPD("127.0.0.1", 0) {
            @Override public Response serve(IHTTPSession session) {
                userAgent.set(session.getHeaders().get("user-agent"));
                return newFixedLengthResponse("#EXTM3U\n#EXTINF:-1,Synthetic channel\nhttps://media.test/clip");
            }
        };
        provider.start();
        try {
            List<String> attempts = new ArrayList<>();
            OkHttpClient.Builder client = new OkHttpClient.Builder().proxy(Proxy.NO_PROXY)
                .dns(host -> Arrays.asList(InetAddress.getByName("127.0.0.2"), InetAddress.getByName("127.0.0.1")))
                .eventListener(new EventListener() {
                    @Override public void connectStart(Call call, InetSocketAddress address, Proxy proxy) {
                        attempts.add(address.getAddress().getHostAddress());
                    }
                });
            WebBackend backend = new WebBackend(new AndroidHttpFetcher(client), "/api");
            String registration = new JSONObject().put("url", "http://provider.test:"
                + provider.getListeningPort() + "/playlist.m3u").toString();
            WebBackend.Response target = backend.handle("POST", "/provider-targets", null, registration);
            Map<String, List<String>> query = new LinkedHashMap<>();
            query.put("targetId", Collections.singletonList(new JSONObject(target.bodyText()).getString("targetId")));
            query.put("requestId", Collections.singletonList("00000000-0000-4000-8000-000000000003"));
            query.put("userAgent", Collections.singletonList("Synthetic café"));

            WebBackend.Response playlist = backend.handle("GET", "/parse", query, null);
            assertEquals(200, playlist.status);
            assertEquals(Arrays.asList("127.0.0.2", "127.0.0.1"), attempts);
            assertEquals("Synthetic café", userAgent.get());

            query.put("userAgent", Collections.singletonList("Synthetic\u0001agent"));
            WebBackend.Response badAgent = backend.handle("GET", "/parse", query, null);
            assertEquals("ERR_INVALID_CHAR", new JSONObject(badAgent.bodyText()).getString("code"));
        } finally {
            provider.stop();
        }
    }
}
