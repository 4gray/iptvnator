package org.tvshell.iptvnator.backend;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
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

    @SuppressWarnings("unchecked")
    public static Map<String, Object> build(Map<String, Object> parsed, String title, String url, String userAgent) {
        String timestamp = isoNow();
        String id = guid();
        List<Object> items = (List<Object>) parsed.get("items");

        Map<String, Object> playlistCopy = Json.object();
        playlistCopy.put("header", parsed.get("header"));
        // The parsed items become the record's items in place: a second map per channel would
        // double the per-item heap of a 100k-channel playlist while both lists are alive.
        for (Object itemObj : items) {
            Map<String, Object> item = (Map<String, Object>) itemObj;
            Map<String, Object> drm = KodiProp.extractDrmFromRaw(Json.optString(item, "raw"));
            item.put("id", guid());
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
}
