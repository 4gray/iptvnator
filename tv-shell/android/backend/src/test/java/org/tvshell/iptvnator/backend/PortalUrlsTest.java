package org.tvshell.iptvnator.backend;

import static org.tvshell.iptvnator.backend.TestMain.assertEquals;
import static org.tvshell.iptvnator.backend.TestMain.assertTrue;

import java.util.LinkedHashMap;
import java.util.Map;

/** Reference values computed with the TypeScript originals (devserver/backend-logic.mjs). */
public class PortalUrlsTest {

    public void testNormalizeXtreamServerUrl() {
        assertEquals("lowercases + strips endpoint", "http://example.com/path/", PortalUrls.normalizeXtreamServerUrl("HTTP://Example.COM:80/path//player_api.php?x=1"));
        assertEquals("keeps non-default port", "https://host:8443", PortalUrls.normalizeXtreamServerUrl("https://host:8443/get.php"));
        assertEquals("trailing slash after endpoint", "http://h.com", PortalUrls.normalizeXtreamServerUrl("http://h.com/panel_api.php/"));
        assertEquals("api url", "http://h.com/player_api.php", PortalUrls.xtreamApiUrl("http://h.com"));
        assertEquals("api url with base path", "http://example.com/path/player_api.php", PortalUrls.xtreamApiUrl("http://example.com/path/"));
        try {
            PortalUrls.normalizeXtreamServerUrl("ftp://x");
            assertTrue("ftp rejected", false);
        } catch (IllegalArgumentException expected) {
            // ok
        }
        try {
            PortalUrls.normalizeXtreamServerUrl("http://user:pw@x/");
            assertTrue("credentials rejected", false);
        } catch (IllegalArgumentException expected) {
            // ok
        }
    }

    public void testEncodeStalkerCmdValue() {
        assertEquals("cmd encoding", "ffrt%20http://x/1%20%3A%20%3B%26%23%22%C3%A9+%20%C3%BC",
            PortalUrls.encodeStalkerCmdValue("ffrt http://x/1 %3A ;&#\"é+ ü"));
    }

    public void testBuildStalkerRequestUrl() {
        Map<String, String> params = new LinkedHashMap<String, String>();
        params.put("type", "itv");
        params.put("action", "create_link");
        params.put("cmd", "ffrt http://a/b?c=d&e");
        params.put("JsHttpRequest", "1-xml");
        params.put("a b", "c&d");
        assertEquals("full url",
            "http://portal.example:8080/stalker_portal/server/load.php?type=itv&action=create_link&cmd=ffrt%20http://a/b?c=d%26e&JsHttpRequest=1-xml&a b=c%26d",
            PortalUrls.buildStalkerRequestUrl("http://portal.example:8080/stalker_portal/server/load.php?junk=1", params));

        Map<String, String> handshake = new LinkedHashMap<String, String>();
        handshake.put("type", "stb");
        handshake.put("action", "handshake");
        handshake.put("token", "T");
        assertEquals("JsHttpRequest appended", "http://portal.example/c/?type=stb&action=handshake&token=T&JsHttpRequest=1-xml",
            PortalUrls.buildStalkerRequestUrl("http://portal.example/c/", handshake));
    }

    public void testEncodeURIComponentMatchesJavaScript() {
        assertEquals("spaces and reserved", "a%20b%26c%3Dd%2Fe%3F%C3%A9!'()*~_.-", PortalUrls.encodeURIComponent("a b&c=d/e?é!'()*~_.-"));
        Map<String, String> q = new LinkedHashMap<String, String>();
        q.put("username", "u s");
        q.put("password", "p&w");
        q.put("action", "get_live_streams");
        assertEquals("query", "http://h/player_api.php?username=u%20s&password=p%26w&action=get_live_streams", PortalUrls.withQuery("http://h/player_api.php", q));
    }
}
