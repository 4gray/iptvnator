package org.tvshell.iptvnator.backend;

import static org.tvshell.iptvnator.backend.TestMain.assertEquals;
import static org.tvshell.iptvnator.backend.TestMain.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.charset.Charset;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * /parse writes the Playlist record while the M3U is parsed. It must answer exactly the record
 * the materialised pipeline built (parse every item into maps, decorate them, serialise), and
 * a large playlist must fit a heap the materialised pipeline could not.
 */
public class PlaylistRecordTest {

    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final Pattern GUID = Pattern.compile("[0-9a-z]{10,11}");
    private static final Pattern ISO = Pattern.compile("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z");
    static final int LARGE_CHANNELS = 60000;
    /** The materialised pipeline needed about 230 MB for 60 000 channels; streamed, about 50. */
    static final int LARGE_HEAP_MB = 96;

    /** PlaylistBuilder.build() and the /parse route as they were before streaming: the oracle. */
    @SuppressWarnings("unchecked")
    static Map<String, Object> materialisedRecord(String text, String title, String url, String userAgent) {
        Map<String, Object> parsed = M3uParser.parse(text);
        String timestamp = PlaylistBuilder.isoNow();
        String id = PlaylistBuilder.guid();
        List<Object> items = (List<Object>) parsed.get("items");
        Map<String, Object> playlistCopy = Json.object();
        playlistCopy.put("header", parsed.get("header"));
        for (Object itemObj : items) {
            Map<String, Object> item = (Map<String, Object>) itemObj;
            Map<String, Object> drm = KodiProp.extractDrmFromRaw(Json.optString(item, "raw"));
            item.put("id", PlaylistBuilder.guid());
            if (drm != null) item.put("drm", drm);
        }
        playlistCopy.put("items", items);
        Map<String, Object> playlist = Json.object();
        playlist.put("id", id);
        playlist.put("_id", id);
        playlist.put("filename", title);
        playlist.put("title", title);
        playlist.put("count", Integer.valueOf(items.size()));
        playlist.put("playlist", playlistCopy);
        playlist.put("importDate", timestamp);
        playlist.put("lastUsage", timestamp);
        playlist.put("favorites", Json.array());
        playlist.put("autoRefresh", Boolean.FALSE);
        playlist.put("url", url);
        if (userAgent != null && !userAgent.isEmpty()) playlist.put("userAgent", userAgent);
        return playlist;
    }

    /** Checks, then removes, the random ids and the timestamps, which differ on every call. */
    @SuppressWarnings("unchecked")
    static Map<String, Object> withoutRandomFields(String what, Map<String, Object> record) {
        assertTrue(what + " id", GUID.matcher((String) record.get("id")).matches());
        assertEquals(what + " _id", record.remove("id"), record.remove("_id"));
        assertTrue(what + " importDate", ISO.matcher((String) record.get("importDate")).matches());
        assertEquals(what + " lastUsage", record.remove("importDate"), record.remove("lastUsage"));
        List<Object> items = (List<Object>) ((Map<String, Object>) record.get("playlist")).get("items");
        for (Object item : items) {
            Object id = ((Map<String, Object>) item).remove("id");
            assertTrue(what + " item id " + id, id instanceof String && GUID.matcher((String) id).matches());
        }
        return record;
    }

    @SuppressWarnings("unchecked")
    public void testStreamedRecordEqualsTheMaterialisedOneOnEveryFixture() throws Exception {
        String[] names = M3uParserTest.resource("index.txt").trim().split("\n");
        int compared = 0;
        int drmItems = 0;
        for (String name : names) {
            name = name.trim();
            if (name.isEmpty()) continue;
            Map<String, Object> expectation = (Map<String, Object>) Json.parse(M3uParserTest.resource(name + ".expected.json"));
            if (!Boolean.TRUE.equals(expectation.get("ok"))) continue;
            String text = M3uParserTest.resource(name + ".m3u");
            String url = "http://prov.example/lists/" + name + ".m3u";
            for (String userAgent : new String[] {null, "MyUA"}) {
                WebBackendTest.FakeFetcher fetcher = new WebBackendTest.FakeFetcher();
                fetcher.answers.put(url, text);
                WebBackend backend = new WebBackend(fetcher, "/api");
                String id = WebBackendTest.register(backend, url);
                WebBackend.Response r = backend.handle("GET", "/parse", userAgent == null
                    ? WebBackendTest.query("targetId", id) : WebBackendTest.query("targetId", id, "userAgent", userAgent), null);
                String what = name + (userAgent == null ? "" : " +ua");
                assertEquals(what + " status", 200, Integer.valueOf(r.status));
                assertEquals(what + " type", "application/json; charset=utf-8", r.contentType);
                byte[] streamed = LocalMain.readAll(r.openBody());
                assertEquals(what + " length", Long.valueOf(streamed.length), Long.valueOf(r.bodyLength()));
                Map<String, Object> actual = (Map<String, Object>) Json.parse(new String(streamed, UTF8));
                Map<String, Object> expected = (Map<String, Object>) Json.parse(Json.write(
                    materialisedRecord(text, PlaylistBuilder.lastUrlSegment(url), url, userAgent)));
                for (Object item : (List<Object>) ((Map<String, Object>) actual.get("playlist")).get("items")) {
                    if (((Map<String, Object>) item).containsKey("drm")) drmItems++;
                }
                String d = M3uParserTest.diff(withoutRandomFields(what + " expected", expected), withoutRandomFields(what, actual), what);
                if (d != null) throw new TestMain.AssertionFailed(d);
                compared++;
            }
        }
        assertTrue("fixtures compared: " + compared, compared >= 80);
        assertTrue("drm decoration exercised: " + drmItems, drmItems >= 4);
    }

    public void testInvalidPlaylistAnswersTheErrorAndNothingElse() {
        WebBackendTest.FakeFetcher fetcher = new WebBackendTest.FakeFetcher();
        fetcher.answers.put("http://prov.example/a.m3u", "﻿\r\n  \n<html>#EXTM3U</html>\n#EXTINF:-1,A\nhttp://x/1\n");
        WebBackend backend = new WebBackend(fetcher, "/api");
        WebBackend.Response r = backend.handle("GET", "/parse", WebBackendTest.query("targetId", WebBackendTest.register(backend, "http://prov.example/a.m3u")), null);
        assertEquals("status", 500, Integer.valueOf(r.status));
        assertEquals("body", "{\"message\":\"Error, something went wrong\",\"status\":500}", r.bodyText());
        assertEquals("length", Long.valueOf(r.bodyBytes().length), Long.valueOf(r.bodyLength()));
    }

    /**
     * 60 000 channels (11 MB of M3U, 35 MB of JSON) answered by a JVM capped at
     * {@value #LARGE_HEAP_MB} MB: the materialised record ran out of memory at 256 MB.
     */
    public void testLargePlaylistParsesWithinABoundedHeap() throws Exception {
        String java = System.getProperty("java.home") + File.separator + "bin" + File.separator + "java";
        ProcessBuilder builder = new ProcessBuilder(java, "-Xmx" + LARGE_HEAP_MB + "m", "-cp", System.getProperty("java.class.path"),
            LargePlaylist.class.getName(), String.valueOf(LARGE_CHANNELS));
        builder.redirectErrorStream(true);
        Process child = builder.start();
        String output = new String(LocalMain.readAll(child.getInputStream()), UTF8).trim();
        int exit = child.waitFor();
        assertEquals("child exit, output: " + output, 0, Integer.valueOf(exit));
        assertTrue("every channel answered: " + output, output.contains("count=" + LARGE_CHANNELS + " "));
    }

    /** Child JVM of {@link #testLargePlaylistParsesWithinABoundedHeap}: /parse on a generated playlist. */
    public static final class LargePlaylist {
        private LargePlaylist() {
        }

        /** Same density as a typical provider line (about 200 bytes per channel). */
        static String generate(int channels) {
            StringBuilder sb = new StringBuilder(channels * 200 + 16);
            sb.append("#EXTM3U\n");
            for (int i = 0; i < channels; i++) {
                int group = i / 100 + 1;
                sb.append("#EXTINF:-1 tvg-id=\"big").append(i).append("\" tvg-name=\"Chaîne ").append(i + 1)
                    .append("\" tvg-logo=\"http://127.0.0.1:43331/art/logos/ch-").append(100 + group).append('-').append(i % 100 + 1)
                    .append(".png\" group-title=\"Groupe ").append(group).append("\",Chaîne ").append(i + 1).append('\n')
                    .append("http://127.0.0.1:43331/live/demo/demo/").append(50000 + i).append(".m3u8\n");
            }
            return sb.toString();
        }

        public static void main(String[] args) throws Exception {
            int channels = Integer.parseInt(args[0]);
            try {
                WebBackendTest.FakeFetcher fetcher = new WebBackendTest.FakeFetcher();
                fetcher.answers.put("http://prov.example/big.m3u", generate(channels));
                WebBackend backend = new WebBackend(fetcher, "/api");
                String id = WebBackendTest.register(backend, "http://prov.example/big.m3u");
                WebBackend.Response r = backend.handle("GET", "/parse", WebBackendTest.query("targetId", id), null);
                fetcher.answers.clear();
                if (r.status != 200) {
                    System.out.println("status=" + r.status);
                    System.exit(2);
                }
                // Read as NanoHTTPD does, keeping only the tail where "count" is.
                InputStream in = r.openBody();
                ByteArrayOutputStream tail = new ByteArrayOutputStream();
                long tailFrom = r.bodyLength() - 512;
                long position = 0;
                byte[] buffer = new byte[16 * 1024];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    int skip = (int) Math.max(0, Math.min(read, tailFrom - position));
                    tail.write(buffer, skip, read - skip);
                    position += read;
                }
                Matcher count = Pattern.compile("\"count\":(\\d+),").matcher(new String(tail.toByteArray(), UTF8));
                System.out.println("count=" + (count.find() ? count.group(1) : "?") + " bytes=" + position + " length=" + r.bodyLength());
                System.exit(position == r.bodyLength() ? 0 : 4);
            } catch (OutOfMemoryError e) {
                System.out.println("OutOfMemoryError");
                System.exit(3);
            }
        }
    }
}
