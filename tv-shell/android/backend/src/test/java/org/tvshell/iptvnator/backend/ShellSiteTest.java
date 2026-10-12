package org.tvshell.iptvnator.backend;

import static org.tvshell.iptvnator.backend.TestMain.assertEquals;
import static org.tvshell.iptvnator.backend.TestMain.assertTrue;

import java.io.IOException;
import java.nio.charset.Charset;
import java.util.HashMap;
import java.util.Map;

public class ShellSiteTest {

    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final String INDEX = "<!doctype html>\n<html>\n<head>\n<meta charset=\"utf-8\"/>\n<base href=\"./\"/>\n\n"
        + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/>\n"
        + "<script src=\"assets/app-config.js\" defer=\"\"></script>\n<script src=\"main-X.js\" type=\"module\"></script>\n</head><body></body></html>";

    static ShellSite site() {
        final Map<String, byte[]> files = new HashMap<String, byte[]>();
        files.put("www/index.html", INDEX.getBytes(UTF8));
        files.put("www/chunk-ABCDEFGH.js", "console.log(1)".getBytes(UTF8));
        files.put("www/assets/i18n/fr.json", "{}".getBytes(UTF8));
        files.put("www/media/font-ABC.woff2", new byte[] {1, 2, 3});
        files.put("tvshell/tv.js", "/* tv */".getBytes(UTF8));
        files.put("tvshell/THIRD-PARTY-NOTICES.txt", "notices".getBytes(UTF8));
        return new ShellSite(new ShellSite.AssetSource() {
            @Override
            public byte[] read(String relativePath) {
                return files.get(relativePath);
            }
        }, "/api", 1280);
    }

    public void testIndexIsTransformedAndUsedAsSpaFallback() throws IOException {
        ShellSite.Resource index = site().serve("/");
        String html = new String(index.body, UTF8);
        assertEquals("status", 200, Integer.valueOf(index.status));
        assertTrue("base href", html.contains("<base href=\"/\">"));
        assertTrue("viewport", html.contains("<meta name=\"viewport\" content=\"width=1280\">"));
        int tv = html.indexOf("tvshell/tv.js");
        int cfg = html.indexOf("assets/app-config.js");
        int main = html.indexOf("main-X.js");
        assertTrue("tv.js before config and bundle", tv > 0 && tv < cfg && cfg < main);
        assertEquals("no-store", "no-store", index.cacheControl);
        ShellSite.Resource route = site().serve("/workspace/playlists/abc/all?x=1");
        assertEquals("spa fallback", html, new String(route.body, UTF8));
        assertEquals("html mime", "text/html; charset=utf-8", route.contentType);
    }

    public void testViewportPinsTheScaleWhenTheScreenWidthIsKnown() throws IOException {
        assertEquals("unknown screen", "width=1280", ShellSite.viewport(1280, 0));
        assertEquals("1080p TV, normal", "width=1280, initial-scale=0.75, minimum-scale=0.75, maximum-scale=0.75", ShellSite.viewport(1280, 960));
        assertEquals("1080p TV, large", "width=960, initial-scale=1, minimum-scale=1, maximum-scale=1", ShellSite.viewport(960, 960));
        assertEquals("1080p TV, dense", "width=1600, initial-scale=0.6, minimum-scale=0.6, maximum-scale=0.6", ShellSite.viewport(1600, 960));
        assertEquals("720p TV at tvdpi", "width=1280, initial-scale=0.6664, minimum-scale=0.6664, maximum-scale=0.6664", ShellSite.viewport(1280, 853));
        ShellSite s = site();
        s.setScreenWidth(960);
        String html = new String(s.serve("/").body, UTF8);
        assertTrue("scaled viewport served", html.contains("<meta name=\"viewport\" content=\"width=1280, initial-scale=0.75, minimum-scale=0.75, maximum-scale=0.75\">"));
    }

    public void testThirdPartyNoticesAreServed() throws IOException {
        ShellSite.Resource notices = site().serve("/tvshell/THIRD-PARTY-NOTICES.txt");
        assertEquals("status", 200, Integer.valueOf(notices.status));
        assertEquals("text mime", "text/plain; charset=utf-8", notices.contentType);
        assertEquals("body", "notices", new String(notices.body, UTF8));
    }

    public void testStaticFilesAndSpecialPaths() throws IOException {
        ShellSite s = site();
        ShellSite.Resource chunk = s.serve("/chunk-ABCDEFGH.js");
        assertEquals("js mime", "application/javascript; charset=utf-8", chunk.contentType);
        assertEquals("hashed immutable", "public, max-age=31536000, immutable", chunk.cacheControl);
        ShellSite.Resource i18n = s.serve("/assets/i18n/fr.json");
        assertEquals("json", "application/json; charset=utf-8", i18n.contentType);
        assertEquals("unhashed no-store", "no-store", i18n.cacheControl);
        ShellSite.Resource font = s.serve("/media/font-ABC.woff2");
        assertEquals("font mime", "font/woff2", font.contentType);
        assertEquals("media immutable", "public, max-age=31536000, immutable", font.cacheControl);
        ShellSite.Resource config = s.serve("/assets/app-config.js");
        assertEquals("config", "window.__IPTVNATOR_CONFIG__ = {\"BACKEND_URL\":\"/api\"};\n", new String(config.body, UTF8));
        ShellSite.Resource tv = s.serve("/tvshell/tv.js");
        assertEquals("tv layer", "/* tv */", new String(tv.body, UTF8));
        assertEquals("sw blocked", 404, Integer.valueOf(s.serve("/ngsw-worker.js").status));
        assertEquals("traversal blocked", 403, Integer.valueOf(s.serve("/../secret").status));
        s.setLayoutWidth(960);
        assertTrue("layout width setting", new String(s.serve("/").body, UTF8).contains("width=960"));
    }
}
