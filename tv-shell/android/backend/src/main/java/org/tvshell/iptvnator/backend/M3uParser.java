package org.tvshell.iptvnator.backend;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Java port of the iptv-playlist-parser fork IPTVnator bundles
 * (github:4gray/iptv-playlist-parser, tag v0.15.2-iptvnator.2). The output is
 * the same JSON structure, field for field, so the PWA receives from the
 * shell exactly what the self-hosted web backend would send.
 *
 * The behaviour is pinned by fixtures generated from the JavaScript parser
 * itself (see tools/gen-parser-fixtures.mjs and M3uParserTest).
 */
public final class M3uParser {

    public static final class InvalidPlaylistException extends RuntimeException {
        private static final long serialVersionUID = 1L;

        InvalidPlaylistException(String message) {
            super(message);
        }
    }

    private static final Pattern ATTR_SCAN_RE = Pattern.compile("([A-Za-z0-9-]+)=\"([^\"]*)\"");
    // JS `.` excludes \n \r U+2028 U+2029 — spelled out so Java matches the same set.
    private static final String DOT = "[^\\n\\r\\u2028\\u2029]";
    private static final Pattern NAME_CLEAN_RE = Pattern.compile("=\"(" + DOT + "*?)\"");
    private static final Pattern OPT_REFERRER_RE = Pattern.compile(":http-referrer=(" + DOT + "*)", Pattern.CASE_INSENSITIVE);
    private static final Pattern OPT_USER_AGENT_RE = Pattern.compile(":http-user-agent=(" + DOT + "*)", Pattern.CASE_INSENSITIVE);
    private static final Pattern EXTGRP_VALUE_RE = Pattern.compile(":(" + DOT + "*)");
    private static final Pattern PARAM_USER_AGENT_RE = Pattern.compile("user-agent=(\\w[^&]*)", Pattern.CASE_INSENSITIVE);
    private static final Pattern PARAM_REFERER_RE = Pattern.compile("referer=(\\w[^&]*)", Pattern.CASE_INSENSITIVE);
    private static final Pattern EXTM3U_RE = Pattern.compile("^#EXTM3U", Pattern.CASE_INSENSITIVE);

    /** Wanted attribute names (lowercase) in the fixed order fields are assigned. */
    private static final String[] WANTED = {
        "tvg-id", "tvg-name", "tvg-logo", "tvg-url", "tvg-rec", "tvg-shift",
        "group-title", "referrer", "user-agent", "catchup", "catchup-days",
        "catchup-source", "timeshift", "lang", "radio"
    };
    private static final int W_LEN = WANTED.length;

    private M3uParser() {
    }

    /** Scan a line once; returns a flat list [name0, value0, name1, value1, ...] or null. */
    private static List<String> scanAttributes(String line) {
        Matcher m = ATTR_SCAN_RE.matcher(line);
        List<String> out = null;
        while (m.find()) {
            if (out == null) out = new ArrayList<String>();
            out.add(m.group(1));
            out.add(m.group(2));
        }
        return out;
    }

    private static void distribute(List<String> attrs, String[] fields) {
        if (attrs == null) return;
        int taken = 0;
        for (int a = 0; a < attrs.size(); a += 2) {
            String lower = attrs.get(a).toLowerCase(java.util.Locale.ROOT);
            for (int w = 0; w < W_LEN; w++) {
                int bit = 1 << w;
                if ((taken & bit) == 0 && lower.endsWith(WANTED[w])) {
                    taken |= bit;
                    fields[w] = attrs.get(a + 1);
                }
            }
            if (taken == (1 << W_LEN) - 1) return;
        }
    }

    private static String getName(String trimmed) {
        String cleaned = NAME_CLEAN_RE.matcher(trimmed).replaceAll("");
        int comma = cleaned.indexOf(',');
        return comma == -1 ? "" : cleaned.substring(comma + 1);
    }

    private static String getOption(String trimmed, Pattern regex) {
        Matcher m = regex.matcher(trimmed);
        if (m.find() && m.group(1) != null && !m.group(1).isEmpty()) {
            return m.group(1).replace("\"", "");
        }
        return "";
    }

    private static String getParameter(String trimmed, Pattern regex) {
        int pipe = trimmed.lastIndexOf('|');
        String params = pipe == -1 ? trimmed : trimmed.substring(pipe + 1);
        Matcher m = regex.matcher(params);
        if (m.find() && m.group(1) != null && !m.group(1).isEmpty()) {
            return m.group(1);
        }
        return "";
    }

    private static Map<String, Object> parseHeader(String firstLine) {
        Map<String, Object> attrs = Json.object();
        List<String> scanned = scanAttributes(firstLine);
        if (scanned != null) {
            for (String name : new String[] {"x-tvg-url", "url-tvg"}) {
                for (int a = 0; a < scanned.size(); a += 2) {
                    if (scanned.get(a).toLowerCase(java.util.Locale.ROOT).endsWith(name)) {
                        if (!scanned.get(a + 1).isEmpty()) attrs.put(name, scanned.get(a + 1));
                        break;
                    }
                }
            }
        }
        Map<String, Object> header = Json.object();
        header.put("attrs", attrs);
        header.put("raw", firstLine);
        return header;
    }

    private static boolean isJsWhitespace(char c) {
        switch (c) {
            case '\t':
            case '\n':
            case '\u000B':
            case '\f':
            case '\r':
            case ' ':
            case ' ':
            case ' ':
            case ' ':
            case ' ':
            case ' ':
            case ' ':
            case '　':
            case '﻿':
                return true;
            default:
                return c >= ' ' && c <= ' ';
        }
    }

    /** JavaScript String.prototype.trim(): the ECMAScript whitespace set, BOM included. */
    static String jsTrim(String s) {
        int start = 0;
        int end = s.length();
        while (start < end && isJsWhitespace(s.charAt(start))) start++;
        while (end > start && isJsWhitespace(s.charAt(end - 1))) end--;
        return s.substring(start, end);
    }

    private static String join(List<String> lines) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < lines.size(); i++) {
            if (i > 0) sb.append("\r\n");
            sb.append(lines.get(i));
        }
        return sb.toString();
    }

    /**
     * Parse an M3U/M3U8 IPTV playlist.
     *
     * @return {@code {header: {attrs, raw}, items: [...]}} as JSON-ready maps
     * @throws InvalidPlaylistException when no {@code #EXTM3U} header is found
     */
    public static Map<String, Object> parse(String content) {
        if (content == null) throw new InvalidPlaylistException("parse() expects an M3U playlist as a string");
        if (content.length() > 0 && content.charAt(0) == '﻿') content = content.substring(1);

        String[] lines = content.split("\r?\n", -1);

        int headerIndex = 0;
        while (headerIndex < lines.length && jsTrim(lines[headerIndex]).isEmpty()) headerIndex++;
        String headerLine = headerIndex < lines.length ? lines[headerIndex] : "";
        if (!EXTM3U_RE.matcher(jsTrim(headerLine)).find()) {
            throw new InvalidPlaylistException("Playlist is not valid");
        }

        Map<String, Object> playlist = Json.object();
        playlist.put("header", parseHeader(jsTrim(headerLine)));
        List<Object> items = Json.array();
        playlist.put("items", items);

        String[] fields = new String[W_LEN];
        Map<String, Object> current = null;
        List<String> currentRaw = null;
        List<String> pendingKodiprops = null;

        for (int idx = headerIndex + 1; idx < lines.length; idx++) {
            String raw = lines[idx];
            String line = jsTrim(raw);
            if (line.length() != 0 && line.charAt(0) == '#') {
                if (line.startsWith("#EXTINF:")) {
                    java.util.Arrays.fill(fields, "");
                    distribute(scanAttributes(line), fields);
                    current = Json.object();
                    current.put("name", getName(line));
                    Map<String, Object> tvg = Json.object();
                    tvg.put("id", fields[0]);
                    tvg.put("name", fields[1]);
                    tvg.put("logo", fields[2]);
                    tvg.put("url", fields[3]);
                    tvg.put("rec", fields[4]);
                    tvg.put("shift", fields[5]);
                    current.put("tvg", tvg);
                    Map<String, Object> group = Json.object();
                    group.put("title", fields[6]);
                    current.put("group", group);
                    Map<String, Object> http = Json.object();
                    http.put("referrer", fields[7]);
                    http.put("user-agent", fields[8]);
                    current.put("http", http);
                    // url: undefined → key omitted until a URL line arrives
                    current.put("raw", raw);
                    current.put("line", Integer.valueOf(idx + 1));
                    Map<String, Object> catchup = Json.object();
                    catchup.put("type", fields[9]);
                    catchup.put("days", fields[10]);
                    catchup.put("source", fields[11]);
                    current.put("catchup", catchup);
                    current.put("timeshift", fields[12]);
                    current.put("lang", fields[13]);
                    current.put("radio", fields[14]);
                    if (pendingKodiprops != null) {
                        pendingKodiprops.add(raw);
                        currentRaw = pendingKodiprops;
                        current.put("raw", join(currentRaw));
                        pendingKodiprops = null;
                    } else {
                        currentRaw = null;
                    }
                    continue;
                }
                if (current == null) {
                    if (line.length() > 10 && line.substring(0, 10).toUpperCase(java.util.Locale.ROOT).equals("#KODIPROP:")) {
                        if (pendingKodiprops == null) pendingKodiprops = new ArrayList<String>();
                        pendingKodiprops.add(raw);
                    }
                    continue;
                }
                @SuppressWarnings("unchecked")
                Map<String, Object> http = (Map<String, Object>) current.get("http");
                @SuppressWarnings("unchecked")
                Map<String, Object> group = (Map<String, Object>) current.get("group");
                if (line.startsWith("#EXTVLCOPT:")) {
                    String referrer = getOption(line, OPT_REFERRER_RE);
                    http.put("referrer", referrer.isEmpty() ? http.get("referrer") : referrer);
                    String userAgent = getOption(line, OPT_USER_AGENT_RE);
                    http.put("user-agent", userAgent.isEmpty() ? http.get("user-agent") : userAgent);
                } else if (line.startsWith("#EXTGRP:")) {
                    Matcher m = EXTGRP_VALUE_RE.matcher(line);
                    String value = m.find() && m.group(1) != null && !m.group(1).isEmpty() ? m.group(1).replace("\"", "") : "";
                    group.put("title", value.isEmpty() ? group.get("title") : value);
                }
                if (currentRaw == null) {
                    currentRaw = new ArrayList<String>();
                    currentRaw.add((String) current.get("raw"));
                }
                currentRaw.add(raw);
            } else {
                if (current == null) continue;
                int pipeIdx = line.indexOf('|');
                String url = pipeIdx == -1 ? line : line.substring(0, pipeIdx);
                if (url.length() != 0) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> http = (Map<String, Object>) current.get("http");
                    current.put("url", url);
                    String userAgent = getParameter(line, PARAM_USER_AGENT_RE);
                    http.put("user-agent", userAgent.isEmpty() ? http.get("user-agent") : userAgent);
                    String referrer = getParameter(line, PARAM_REFERER_RE);
                    http.put("referrer", referrer.isEmpty() ? http.get("referrer") : referrer);
                    if (currentRaw == null) {
                        current.put("raw", current.get("raw") + "\r\n" + raw);
                    } else {
                        currentRaw.add(raw);
                        current.put("raw", join(currentRaw));
                        currentRaw = null;
                    }
                    items.add(current);
                    current = null;
                } else {
                    if (currentRaw == null) {
                        currentRaw = new ArrayList<String>();
                        currentRaw.add((String) current.get("raw"));
                    }
                    currentRaw.add(raw);
                }
            }
        }

        if (current != null) {
            if (currentRaw != null) current.put("raw", join(currentRaw));
            items.add(current);
        }

        return playlist;
    }
}
