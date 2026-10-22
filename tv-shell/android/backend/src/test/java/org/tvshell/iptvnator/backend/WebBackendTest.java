package org.tvshell.iptvnator.backend;

import static org.tvshell.iptvnator.backend.TestMain.assertEquals;
import static org.tvshell.iptvnator.backend.TestMain.assertTrue;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Route contract checks with a scripted fetcher (no network). */
public class WebBackendTest {

    /** Records requests and answers from a table. */
    static final class FakeFetcher extends HttpFetcher {
        final List<String> urls = new ArrayList<String>();
        final List<Map<String, String>> headers = new ArrayList<Map<String, String>>();
        final Map<String, String> answers = new LinkedHashMap<String, String>();
        ProviderException failure;

        @Override
        public Result get(String url, Map<String, String> requestHeaders, int timeoutMs) throws ProviderException {
            urls.add(url);
            headers.add(requestHeaders == null ? new LinkedHashMap<String, String>() : requestHeaders);
            if (failure != null) throw failure;
            for (Map.Entry<String, String> entry : answers.entrySet()) {
                if (url.startsWith(entry.getKey())) return new Result(200, entry.getValue(), "application/json");
            }
            throw new ProviderException(404, "Not Found");
        }
    }

    static Map<String, List<String>> query(String... keyValues) {
        Map<String, List<String>> q = new LinkedHashMap<String, List<String>>();
        for (int i = 0; i + 1 < keyValues.length; i += 2) q.put(keyValues[i], Collections.singletonList(keyValues[i + 1]));
        return q;
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> body(WebBackend.Response r) {
        return (Map<String, Object>) Json.parse(r.bodyText());
    }

    public void testPayloadIsValidatedNotRebuilt() {
        assertTrue("valid json is raw", WebBackend.payloadOf(" { \"a\" : [ 1 , 2 ] } ") instanceof Json.Raw);
        assertEquals("trimmed, otherwise verbatim", "{ \"a\" : [ 1 , 2 ] }", WebBackend.payloadOf(" { \"a\" : [ 1 , 2 ] } ").toString());
        assertEquals("almost json stays text", "{\"a\":1,}", WebBackend.payloadOf("{\"a\":1,}"));
        assertEquals("text stays text", "Not JSON", WebBackend.payloadOf("Not JSON"));
        assertEquals("null body", "", WebBackend.payloadOf(null));
        assertEquals("scalar", "42", WebBackend.payloadOf("42").toString());
        Map<String, Object> out = Json.object();
        out.put("payload", WebBackend.payloadOf("[1, 2]"));
        assertEquals("written as given", "{\"payload\":[1, 2]}", WebBackend.json(200, out).bodyText());
    }

    static String register(WebBackend backend, String url) {
        WebBackend.Response r = backend.handle("POST", "/provider-targets", null, "{\"url\":" + Json.write(url) + "}");
        assertEquals("register status", 200, Integer.valueOf(r.status));
        return (String) body(r).get("targetId");
    }

    public void testHealthAndConfig() {
        WebBackend backend = new WebBackend(new FakeFetcher(), "/api");
        WebBackend.Response health = backend.handle("GET", "/health", null, null);
        assertEquals("health", "ok", body(health).get("status"));
        WebBackend.Response config = backend.handle("GET", "/config.js", null, null);
        assertTrue("config js", config.bodyText().contains("\"BACKEND_URL\":\"/api\""));
        assertEquals("404", 404, Integer.valueOf(backend.handle("GET", "/nope", null, null).status));
        // The PWA probes /v1/instance at start-up; a 404 means "a backend without
        // server storage", so it keeps its data in the WebView (IndexedDB).
        assertEquals("no server storage", 404, Integer.valueOf(backend.handle("GET", "/v1/instance", null, null).status));
        assertEquals("no storage routes", 404, Integer.valueOf(backend.handle("GET", "/v1/playlists", null, null).status));
        assertEquals("parse-xml unsupported", 501, Integer.valueOf(backend.handle("GET", "/parse-xml", query("targetId", "x"), null).status));
    }

    public void testProviderTargetsValidation() {
        WebBackend backend = new WebBackend(new FakeFetcher(), "/api");
        assertEquals("missing url", 400, Integer.valueOf(backend.handle("POST", "/provider-targets", null, "{}").status));
        assertEquals("bad json", 400, Integer.valueOf(backend.handle("POST", "/provider-targets", null, "{bad").status));
        assertEquals("ftp", 400, Integer.valueOf(backend.handle("POST", "/provider-targets", null, "{\"url\":\"ftp://x/y\"}").status));
        assertEquals("garbage", 400, Integer.valueOf(backend.handle("POST", "/provider-targets", null, "{\"url\":\"not a url\"}").status));
        String id1 = register(backend, "http://Provider.example:8080/get.php?username=u&password=p");
        String id2 = register(backend, "http://Provider.example:8080/get.php?username=u&password=p");
        assertEquals("stable id", id1, id2);
        assertEquals("sha256 hex", 64, Integer.valueOf(id1.length()));
        assertEquals("missing targetId", 400, Integer.valueOf(backend.handle("GET", "/parse", query(), null).status));
        assertEquals("unknown targetId", 404, Integer.valueOf(backend.handle("GET", "/parse", query("targetId", "zzz"), null).status));
        WebBackend.Response reset = backend.handle("POST", "/connectivity-guard/reset", null, "{\"url\":\"http://x\"}");
        assertEquals("reset", Boolean.FALSE, body(reset).get("reset"));
    }

    @SuppressWarnings("unchecked")
    public void testParseBuildsThePlaylistRecord() {
        FakeFetcher fetcher = new FakeFetcher();
        fetcher.answers.put("http://prov.example/lists/tv.m3u",
            "#EXTM3U\n#KODIPROP:inputstream.adaptive.license_type=clearkey\n#KODIPROP:inputstream.adaptive.license_key=00112233445566778899aabbccddeeff:ffeeddccbbaa99887766554433221100\n#EXTINF:-1 tvg-id=\"a\" group-title=\"G\",A\nhttp://s/a.mpd\n#EXTINF:-1,B\nhttp://s/b.ts|User-Agent=X\n");
        WebBackend backend = new WebBackend(fetcher, "/api");
        String id = register(backend, "http://prov.example/lists/tv.m3u");
        WebBackend.Response r = backend.handle("GET", "/parse", query("targetId", id, "userAgent", " MyUA "), null);
        assertEquals("status", 200, Integer.valueOf(r.status));
        assertEquals("user agent forwarded", "MyUA", fetcher.headers.get(0).get("User-Agent"));
        Map<String, Object> playlist = body(r);
        assertEquals("title from last segment", "tv.m3u", playlist.get("title"));
        assertEquals("filename", "tv.m3u", playlist.get("filename"));
        assertEquals("count", 2, Integer.valueOf(((Number) playlist.get("count")).intValue()));
        assertEquals("url", "http://prov.example/lists/tv.m3u", playlist.get("url"));
        assertEquals("userAgent", "MyUA", playlist.get("userAgent"));
        assertEquals("id == _id", playlist.get("id"), playlist.get("_id"));
        assertTrue("importDate iso", ((String) playlist.get("importDate")).matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z"));
        assertEquals("favorites", 0, Integer.valueOf(((List<Object>) playlist.get("favorites")).size()));
        assertEquals("autoRefresh", Boolean.FALSE, playlist.get("autoRefresh"));
        Map<String, Object> inner = (Map<String, Object>) playlist.get("playlist");
        List<Object> items = (List<Object>) inner.get("items");
        Map<String, Object> first = (Map<String, Object>) items.get(0);
        assertTrue("item id", first.get("id") instanceof String && ((String) first.get("id")).length() >= 8);
        assertEquals("item name", "A", first.get("name"));
        assertEquals("item url", "http://s/a.mpd", first.get("url"));
        Map<String, Object> drm = (Map<String, Object>) first.get("drm");
        assertEquals("drm supported", Boolean.TRUE, drm.get("supported"));
        Map<String, Object> second = (Map<String, Object>) items.get(1);
        assertTrue("no drm on plain item", !second.containsKey("drm"));
        assertEquals("pipe ua", "X", ((Map<String, Object>) second.get("http")).get("user-agent"));
        assertEquals("pipe stripped", "http://s/b.ts", second.get("url"));
    }

    public void testParseErrors() {
        FakeFetcher fetcher = new FakeFetcher();
        WebBackend backend = new WebBackend(fetcher, "/api");
        String id = register(backend, "http://prov.example/missing.m3u");
        WebBackend.Response notFound = backend.handle("GET", "/parse", query("targetId", id), null);
        assertEquals("404 passthrough", 404, Integer.valueOf(notFound.status));
        assertEquals("404 message", "Not Found", body(notFound).get("message"));

        fetcher.failure = new ProviderException("getaddrinfo", "ENOTFOUND");
        WebBackend.Response dns = backend.handle("GET", "/parse", query("targetId", id), null);
        assertEquals("dns status", 500, Integer.valueOf(dns.status));
        assertEquals("dns message", "Error, something went wrong (ENOTFOUND)", body(dns).get("message"));
        assertEquals("dns code", "ENOTFOUND", body(dns).get("code"));

        fetcher.failure = null;
        fetcher.answers.put("http://prov.example/missing.m3u", "<html>not a playlist</html>");
        WebBackend.Response invalid = backend.handle("GET", "/parse", query("targetId", id), null);
        assertEquals("invalid playlist", 500, Integer.valueOf(invalid.status));
        assertEquals("invalid message", "Error, something went wrong", body(invalid).get("message"));
    }

    @SuppressWarnings("unchecked")
    public void testXtreamProxy() {
        FakeFetcher fetcher = new FakeFetcher();
        fetcher.answers.put("http://xc.example:8080/player_api.php?username=u%20u&password=p%26p&action=get_live_streams&category_id=7",
            "[{\"stream_id\":1,\"name\":\"One\",\"num\":1.0}]");
        fetcher.answers.put("http://xc.example:8080/player_api.php?username=u%20u&password=p%26p",
            "{\"user_info\":{\"auth\":1}}");
        fetcher.answers.put("http://xc.example:8080/player_api.php?username=x&password=y", "Not JSON at all");
        WebBackend backend = new WebBackend(fetcher, "/api");
        String id = register(backend, "http://xc.example:8080/get.php?username=u&password=p");

        WebBackend.Response r = backend.handle("GET", "/xtream", query("targetId", id, "username", "u u", "password", "p&p", "action", "get_live_streams", "category_id", "7"), null);
        assertEquals("status", 200, Integer.valueOf(r.status));
        Map<String, Object> out = body(r);
        assertEquals("action echoed", "get_live_streams", out.get("action"));
        List<Object> payload = (List<Object>) out.get("payload");
        assertEquals("payload parsed", "One", ((Map<String, Object>) payload.get(0)).get("name"));
        assertTrue("number lexical form kept", r.bodyText().contains("\"num\":1.0"));
        assertTrue("payload passed through verbatim", r.bodyText().contains("\"payload\":[{\"stream_id\":1,\"name\":\"One\",\"num\":1.0}]"));
        assertEquals("endpoint stripped and params encoded", "http://xc.example:8080/player_api.php?username=u%20u&password=p%26p&action=get_live_streams&category_id=7", fetcher.urls.get(0));
        assertEquals("default UA for panels", null, fetcher.headers.get(0).get("User-Agent"));

        WebBackend.Response info = backend.handle("GET", "/xtream", query("targetId", id, "username", "u u", "password", "p&p"), null);
        assertTrue("no action key value", body(info).containsKey("action") && body(info).get("action") == null);

        WebBackend.Response text = backend.handle("GET", "/xtream", query("targetId", id, "username", "x", "password", "y"), null);
        assertEquals("non-json payload kept as string", "Not JSON at all", body(text).get("payload"));

        fetcher.failure = new ProviderException(503, "Service Unavailable");
        WebBackend.Response failed = backend.handle("GET", "/xtream", query("targetId", id, "username", "u", "password", "p", "action", "get_vod_categories"), null);
        assertEquals("provider failure answered with 200", 200, Integer.valueOf(failed.status));
        assertEquals("error status in body", 503, Integer.valueOf(((Number) body(failed).get("status")).intValue()));
        assertEquals("error message", "Service Unavailable", body(failed).get("message"));
        assertTrue("no payload", !body(failed).containsKey("payload"));

        fetcher.failure = new ProviderException("connect", "ECONNREFUSED");
        WebBackend.Response test = backend.handle("GET", "/xtream", query("targetId", id, "username", "u", "password", "p", "connectionTest", "true"), null);
        Map<String, Object> failure = (Map<String, Object>) body(test).get("connectionFailure");
        assertEquals("kind", "connection", failure.get("kind"));
        assertEquals("canTryHttp", Boolean.TRUE, failure.get("canTryHttp"));
        assertEquals("connectionTest not forwarded", "http://xc.example:8080/player_api.php?username=u&password=p", fetcher.urls.get(fetcher.urls.size() - 1));

        fetcher.failure = new ProviderException("network", "ECONNRESET");
        WebBackend.Response reset = backend.handle("GET", "/xtream", query("targetId", id, "username", "u", "password", "p"), null);
        assertEquals("code surfaced", "Bad Gateway (ECONNRESET)", body(reset).get("message"));
        assertEquals("502", 502, Integer.valueOf(((Number) body(reset).get("status")).intValue()));
    }

    @SuppressWarnings("unchecked")
    public void testStalkerProxy() {
        FakeFetcher fetcher = new FakeFetcher();
        fetcher.answers.put("http://portal.example/stalker_portal/server/load.php?", "{\"js\":{\"token\":\"abc\"}}");
        WebBackend backend = new WebBackend(fetcher, "/api");
        String id = register(backend, "http://portal.example/stalker_portal/server/load.php");

        WebBackend.Response handshake = backend.handle("GET", "/stalker",
            query("targetId", id, "macAddress", "00:1A:79:00:00:01", "type", "stb", "action", "handshake", "token", "OLDTOKEN", "skipConnectionGuard", "true"), null);
        assertEquals("status", 200, Integer.valueOf(handshake.status));
        assertEquals("action", "handshake", body(handshake).get("action"));
        assertEquals("payload", "abc", ((Map<String, Object>) ((Map<String, Object>) body(handshake).get("payload")).get("js")).get("token"));
        assertEquals("handshake carries the candidate token in the query and no guard flag",
            "http://portal.example/stalker_portal/server/load.php?type=stb&action=handshake&token=OLDTOKEN&JsHttpRequest=1-xml", fetcher.urls.get(0));
        Map<String, String> headers = fetcher.headers.get(0);
        assertEquals("cookie", "mac=00:1A:79:00:00:01; stb_lang=en_US@rg=dezzzz; timezone=Europe/Berlin", headers.get("Cookie"));
        assertEquals("authorization", "Bearer OLDTOKEN", headers.get("Authorization"));
        assertEquals("mag ua", StalkerIdentity.STALKER_MAG_USER_AGENT, headers.get("User-Agent"));

        WebBackend.Response channels = backend.handle("GET", "/stalker",
            query("targetId", id, "macAddress", "00:1A:79:00:00:01", "token", "T2", "serialNumber", "AB12", "type", "itv", "action", "create_link", "cmd", "ffrt http://x/1?a=b&c"), null);
        assertEquals("create_link url", "http://portal.example/stalker_portal/server/load.php?type=itv&action=create_link&cmd=ffrt%20http://x/1?a=b%26c&JsHttpRequest=1-xml", fetcher.urls.get(1));
        assertEquals("sn header", "AB12", fetcher.headers.get(1).get("SN"));
        assertTrue("cfduid cookie", fetcher.headers.get(1).get("Cookie").contains("__cfduid=ab12e030245495acd6ebfc1000000000"));
        assertEquals("token not in query", -1, Integer.valueOf(fetcher.urls.get(1).indexOf("T2")));
        assertEquals("status", 200, Integer.valueOf(channels.status));

        WebBackend.Response noMac = backend.handle("GET", "/stalker", query("targetId", id, "type", "stb", "action", "handshake"), null);
        assertTrue("no cookie without mac", !fetcher.headers.get(2).containsKey("Cookie"));
        assertEquals("ok", 200, Integer.valueOf(noMac.status));
    }
}
