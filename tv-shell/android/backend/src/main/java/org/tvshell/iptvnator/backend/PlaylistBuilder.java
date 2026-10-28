package org.tvshell.iptvnator.backend;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.Map;
import java.util.Random;
import java.util.TimeZone;

/**
 * Port of the web backend's {@code createPlaylistObject()} (the /parse
 * response): wraps a parsed playlist in the Playlist record the PWA stores.
 */
public final class PlaylistBuilder {

    private static final Random RANDOM = new Random();

    private PlaylistBuilder() {
    }

    /** Node's {@code Math.random().toString(36).slice(2)}: 10–11 base-36 chars. */
    public static String guid() {
        StringBuilder sb = new StringBuilder();
        String alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
        int length = 10 + RANDOM.nextInt(2);
        for (int i = 0; i < length; i++) sb.append(alphabet.charAt(RANDOM.nextInt(alphabet.length())));
        return sb.toString();
    }

    static String isoNow() {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date());
    }

    public static String lastUrlSegment(String value) {
        String segment = value.substring(value.lastIndexOf('/') + 1).trim();
        return segment.length() > 0 ? segment : "Playlist without title";
    }

    /** createPlaylistObject()'s step for each item: a guid, and the drm its KODIPROP lines carry. */
    static void decorate(Map<String, Object> item) {
        Map<String, Object> drm = KodiProp.extractDrmFromRaw(Json.optString(item, "raw"));
        item.put("id", guid());
        if (drm != null) item.put("drm", drm);
    }

    /**
     * Parses {@code content} and writes its Playlist record to {@code out} as it goes: each item
     * is decorated, written and dropped, so the heap holds the text and the JSON, never the items
     * as maps (about 2.3 KB per channel: a 60 000-channel list exhausted a 256 MB heap).
     *
     * <p>The record is the web backend's, key order aside: {@code count} follows the items it
     * counts (the PWA reads the record with JSON.parse, which keeps no order).
     *
     * @return the number of items written
     * @throws M3uParser.InvalidPlaylistException when the text has no {@code #EXTM3U} header
     */
    static int write(String content, String title, String url, String userAgent, Utf8Sink out) {
        String timestamp = isoNow();
        RecordWriter record = new RecordWriter(guid(), title, out);
        M3uParser.parse(content, record);
        out.append("]},\"count\":").append(Integer.toString(record.count));
        out.append(",\"importDate\":");
        Json.write(timestamp, out);
        out.append(",\"lastUsage\":");
        Json.write(timestamp, out);
        out.append(",\"favorites\":[],\"autoRefresh\":false,\"url\":");
        Json.write(url, out);
        if (userAgent != null && !userAgent.isEmpty()) {
            out.append(",\"userAgent\":");
            Json.write(userAgent, out);
        }
        out.append('}');
        return record.count;
    }

    /** Opens the record at the header, then appends each item to {@code playlist.items}. */
    private static final class RecordWriter implements M3uParser.ItemSink {
        private final String id;
        private final String title;
        private final Utf8Sink out;
        int count;

        RecordWriter(String id, String title, Utf8Sink out) {
            this.id = id;
            this.title = title;
            this.out = out;
        }

        @Override
        public void header(Map<String, Object> header) {
            out.append("{\"id\":");
            Json.write(id, out);
            out.append(",\"_id\":");
            Json.write(id, out);
            out.append(",\"filename\":");
            Json.write(title, out);
            out.append(",\"title\":");
            Json.write(title, out);
            out.append(",\"playlist\":{\"header\":");
            Json.write(header, out);
            out.append(",\"items\":[");
        }

        @Override
        public void item(Map<String, Object> item) {
            decorate(item);
            if (count++ > 0) out.append(',');
            Json.write(item, out);
        }
    }
}
