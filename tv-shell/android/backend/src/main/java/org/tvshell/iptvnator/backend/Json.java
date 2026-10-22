package org.tvshell.iptvnator.backend;

import java.io.IOException;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Minimal JSON reader/writer (RFC 8259) with no dependencies, so the backend
 * runs identically on Android and in plain-JVM tests.
 *
 * Values map to: {@link Map} (LinkedHashMap, insertion order kept),
 * {@link List}, {@link String}, {@link Boolean}, {@link Number} and
 * {@code null}. Numbers parsed from text are kept as {@link JsonNumber} so the
 * original lexical form is written back unchanged (provider payloads are
 * passed through losslessly).
 */
public final class Json {

    /** A number kept in its original textual form. */
    public static final class JsonNumber extends Number {
        private static final long serialVersionUID = 1L;
        private final String text;

        public JsonNumber(String text) {
            this.text = text;
        }

        public String text() {
            return text;
        }

        @Override
        public int intValue() {
            return (int) longValue();
        }

        @Override
        public long longValue() {
            try {
                return Long.parseLong(text);
            } catch (NumberFormatException e) {
                return new BigDecimal(text).longValue();
            }
        }

        @Override
        public float floatValue() {
            return (float) doubleValue();
        }

        @Override
        public double doubleValue() {
            return Double.parseDouble(text);
        }

        @Override
        public String toString() {
            return text;
        }

        @Override
        public boolean equals(Object other) {
            return other instanceof JsonNumber && ((JsonNumber) other).text.equals(text);
        }

        @Override
        public int hashCode() {
            return text.hashCode();
        }
    }

    /**
     * JSON text already known to be valid ({@link #validate(String)}): written verbatim, never
     * rebuilt as maps and lists. A provider catalogue of 20 MB costs its own size this way, not
     * six to ten times that in map entries and strings.
     */
    public static final class Raw {
        private final String text;

        public Raw(String text) {
            this.text = text;
        }

        public String text() {
            return text;
        }

        @Override
        public String toString() {
            return text;
        }
    }

    public static final class JsonException extends RuntimeException {
        private static final long serialVersionUID = 1L;

        JsonException(String message) {
            super(message);
        }
    }

    private Json() {
    }

    // ------------------------------------------------------------ builders
    public static Map<String, Object> object() {
        return new LinkedHashMap<String, Object>();
    }

    public static List<Object> array() {
        return new ArrayList<Object>();
    }

    // -------------------------------------------------------------- writer
    public static String write(Object value) {
        StringBuilder sb = new StringBuilder(256);
        write(value, sb);
        return sb.toString();
    }

    /**
     * The JSON text as UTF-8 bytes, encoded while it is written: one growing byte array instead
     * of a char buffer, a String and the bytes alive at the same time (a /parse answer for a
     * large playlist is tens of MB).
     */
    public static byte[] writeUtf8(Object value) {
        Utf8Sink sink = new Utf8Sink(4096);
        try {
            write(value, sink);
        } catch (IOException e) {
            throw new IllegalStateException(e); // the sink never throws
        }
        return sink.toByteArray();
    }

    /**
     * Appendable that encodes into a growing UTF-8 byte array without allocating per call
     * (OutputStreamWriter allocates for every single character). An unpaired surrogate becomes
     * '?', as String.getBytes(UTF-8) does.
     */
    static final class Utf8Sink implements Appendable {
        private byte[] buf;
        private int count;
        private char pendingHigh;

        Utf8Sink(int initial) {
            buf = new byte[Math.max(16, initial)];
        }

        @Override
        public Appendable append(CharSequence csq) {
            CharSequence text = csq == null ? "null" : csq;
            return append(text, 0, text.length());
        }

        @Override
        public Appendable append(CharSequence csq, int start, int end) {
            CharSequence text = csq == null ? "null" : csq;
            for (int i = start; i < end; i++) append(text.charAt(i));
            return this;
        }

        @Override
        public Appendable append(char c) {
            if (pendingHigh != 0) {
                char high = pendingHigh;
                pendingHigh = 0;
                if (Character.isLowSurrogate(c)) {
                    int cp = Character.toCodePoint(high, c);
                    ensure(4);
                    buf[count++] = (byte) (0xF0 | (cp >> 18));
                    buf[count++] = (byte) (0x80 | ((cp >> 12) & 0x3F));
                    buf[count++] = (byte) (0x80 | ((cp >> 6) & 0x3F));
                    buf[count++] = (byte) (0x80 | (cp & 0x3F));
                    return this;
                }
                put('?');
            }
            if (c < 0x80) {
                put(c);
            } else if (c < 0x800) {
                ensure(2);
                buf[count++] = (byte) (0xC0 | (c >> 6));
                buf[count++] = (byte) (0x80 | (c & 0x3F));
            } else if (Character.isHighSurrogate(c)) {
                pendingHigh = c;
            } else if (Character.isLowSurrogate(c)) {
                put('?');
            } else {
                ensure(3);
                buf[count++] = (byte) (0xE0 | (c >> 12));
                buf[count++] = (byte) (0x80 | ((c >> 6) & 0x3F));
                buf[count++] = (byte) (0x80 | (c & 0x3F));
            }
            return this;
        }

        byte[] toByteArray() {
            if (pendingHigh != 0) {
                pendingHigh = 0;
                put('?');
            }
            return Arrays.copyOf(buf, count);
        }

        private void put(char ascii) {
            ensure(1);
            buf[count++] = (byte) ascii;
        }

        private void ensure(int extra) {
            if (count + extra > buf.length) buf = Arrays.copyOf(buf, Math.max(buf.length * 2, count + extra));
        }
    }

    public static void write(Object value, StringBuilder sb) {
        try {
            write(value, (Appendable) sb);
        } catch (IOException e) {
            throw new IllegalStateException(e); // a StringBuilder never throws
        }
    }

    /**
     * Streams the JSON text to {@code out}: a response goes straight to its UTF-8 bytes instead
     * of living as a char buffer, then a String, then bytes at the same time.
     */
    @SuppressWarnings("unchecked")
    public static void write(Object value, Appendable out) throws IOException {
        if (value == null) {
            out.append("null");
        } else if (value instanceof String) {
            writeString((String) value, out);
        } else if (value instanceof Raw) {
            out.append(((Raw) value).text);
        } else if (value instanceof Boolean) {
            out.append(((Boolean) value).booleanValue() ? "true" : "false");
        } else if (value instanceof JsonNumber) {
            out.append(((JsonNumber) value).text());
        } else if (value instanceof Number) {
            double d = ((Number) value).doubleValue();
            if (value instanceof Integer || value instanceof Long || value instanceof Short || value instanceof Byte) {
                out.append(Long.toString(((Number) value).longValue()));
            } else if (Double.isNaN(d) || Double.isInfinite(d)) {
                out.append("null");
            } else if (d == Math.rint(d) && Math.abs(d) < 1e15) {
                out.append(Long.toString((long) d));
            } else {
                out.append(Double.toString(d));
            }
        } else if (value instanceof Map) {
            out.append('{');
            boolean first = true;
            for (Map.Entry<String, Object> entry : ((Map<String, Object>) value).entrySet()) {
                if (!first) out.append(',');
                first = false;
                writeString(entry.getKey(), out);
                out.append(':');
                write(entry.getValue(), out);
            }
            out.append('}');
        } else if (value instanceof Iterable) {
            out.append('[');
            boolean first = true;
            for (Object item : (Iterable<Object>) value) {
                if (!first) out.append(',');
                first = false;
                write(item, out);
            }
            out.append(']');
        } else {
            writeString(String.valueOf(value), out);
        }
    }

    private static void writeString(String s, Appendable out) throws IOException {
        out.append('"');
        int flushed = 0; // plain runs are appended in one piece
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            String escaped;
            switch (c) {
                case '"':
                    escaped = "\\\"";
                    break;
                case '\\':
                    escaped = "\\\\";
                    break;
                case '\n':
                    escaped = "\\n";
                    break;
                case '\r':
                    escaped = "\\r";
                    break;
                case '\t':
                    escaped = "\\t";
                    break;
                case '\b':
                    escaped = "\\b";
                    break;
                case '\f':
                    escaped = "\\f";
                    break;
                default:
                    if (c < 0x20 || c == 0x2028 || c == 0x2029) escaped = String.format("\\u%04x", (int) c);
                    else continue;
            }
            if (i > flushed) out.append(s, flushed, i);
            out.append(escaped);
            flushed = i + 1;
        }
        if (s.length() > flushed) out.append(s, flushed, s.length());
        out.append('"');
    }

    // -------------------------------------------------------------- reader
    public static Object parse(String text) {
        Reader reader = new Reader(text);
        reader.skipWhitespace();
        Object value = reader.readValue();
        reader.skipWhitespace();
        if (!reader.atEnd()) throw new JsonException("Unexpected trailing characters at " + reader.pos);
        return value;
    }

    /** True when the text is a syntactically valid JSON document (built with {@link #parse}). */
    public static boolean isValid(String text) {
        try {
            parse(text);
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    /**
     * Same nesting bound as {@link #parse}, but nothing is built: strings, numbers and containers
     * are skipped in place. Stricter than {@link #parse}: it accepts only what a browser's
     * JSON.parse accepts (no raw control characters in strings, exactly four hex digits after
     * {@code \\u}), because text it accepts is passed through verbatim as {@link Raw}.
     */
    public static boolean validate(String text) {
        if (text == null) return false;
        try {
            Reader reader = new Reader(text);
            reader.skipWhitespace();
            reader.skipValue();
            reader.skipWhitespace();
            return reader.atEnd();
        } catch (RuntimeException e) {
            return false;
        }
    }

    /**
     * Nesting the reader accepts. Provider payloads are a few levels deep; the
     * limit turns a hostile {@code [[[[...} body into a {@link JsonException},
     * which callers already handle (a provider body that does not parse is
     * passed through as a string, as axios does; a request body answers 400),
     * instead of a {@link StackOverflowError} that would take the whole app
     * down with it.
     */
    static final int MAX_DEPTH = 256;

    private static final class Reader {
        private final String s;
        private int pos;
        private int depth;

        Reader(String s) {
            this.s = s;
            // tolerate a UTF-8 BOM
            this.pos = s.length() > 0 && s.charAt(0) == '﻿' ? 1 : 0;
        }

        boolean atEnd() {
            return pos >= s.length();
        }

        void skipWhitespace() {
            while (pos < s.length()) {
                char c = s.charAt(pos);
                if (c == ' ' || c == '\t' || c == '\n' || c == '\r') pos++;
                else break;
            }
        }

        Object readValue() {
            if (atEnd()) throw new JsonException("Unexpected end of JSON");
            char c = s.charAt(pos);
            switch (c) {
                case '{':
                    enter();
                    try {
                        return readObject();
                    } finally {
                        depth--;
                    }
                case '[':
                    enter();
                    try {
                        return readArray();
                    } finally {
                        depth--;
                    }
                case '"':
                    return readString();
                case 't':
                    expectWord("true");
                    return Boolean.TRUE;
                case 'f':
                    expectWord("false");
                    return Boolean.FALSE;
                case 'n':
                    expectWord("null");
                    return null;
                default:
                    if (c == '-' || (c >= '0' && c <= '9')) return readNumber();
                    throw new JsonException("Unexpected character '" + c + "' at " + pos);
            }
        }

        private void enter() {
            if (++depth > MAX_DEPTH) throw new JsonException("JSON nested deeper than " + MAX_DEPTH + " levels at " + pos);
        }

        /** {@link #readValue} without building anything. */
        void skipValue() {
            if (atEnd()) throw new JsonException("Unexpected end of JSON");
            char c = s.charAt(pos);
            switch (c) {
                case '{':
                    enter();
                    try {
                        skipObject();
                    } finally {
                        depth--;
                    }
                    return;
                case '[':
                    enter();
                    try {
                        skipArray();
                    } finally {
                        depth--;
                    }
                    return;
                case '"':
                    skipString();
                    return;
                case 't':
                    expectWord("true");
                    return;
                case 'f':
                    expectWord("false");
                    return;
                case 'n':
                    expectWord("null");
                    return;
                default:
                    if (c == '-' || (c >= '0' && c <= '9')) {
                        scanNumber();
                        return;
                    }
                    throw new JsonException("Unexpected character '" + c + "' at " + pos);
            }
        }

        private void skipObject() {
            pos++; // {
            skipWhitespace();
            if (peek() == '}') {
                pos++;
                return;
            }
            while (true) {
                skipWhitespace();
                if (peek() != '"') throw new JsonException("Expected string key at " + pos);
                skipString();
                skipWhitespace();
                if (peek() != ':') throw new JsonException("Expected ':' at " + pos);
                pos++;
                skipWhitespace();
                skipValue();
                skipWhitespace();
                char c = peek();
                if (c == ',') {
                    pos++;
                    continue;
                }
                if (c == '}') {
                    pos++;
                    return;
                }
                throw new JsonException("Expected ',' or '}' at " + pos);
            }
        }

        private void skipArray() {
            pos++; // [
            skipWhitespace();
            if (peek() == ']') {
                pos++;
                return;
            }
            while (true) {
                skipWhitespace();
                skipValue();
                skipWhitespace();
                char c = peek();
                if (c == ',') {
                    pos++;
                    continue;
                }
                if (c == ']') {
                    pos++;
                    return;
                }
                throw new JsonException("Expected ',' or ']' at " + pos);
            }
        }

        /** {@link #readString} without the StringBuilder: the same escapes are accepted. */
        private void skipString() {
            pos++; // opening quote
            while (true) {
                if (atEnd()) throw new JsonException("Unterminated string");
                char c = s.charAt(pos++);
                if (c == '"') return;
                if (c < 0x20) throw new JsonException("Unescaped control character at " + (pos - 1));
                if (c == '\\') {
                    if (atEnd()) throw new JsonException("Unterminated escape");
                    char e = s.charAt(pos++);
                    switch (e) {
                        case '"':
                        case '\\':
                        case '/':
                        case 'b':
                        case 'f':
                        case 'n':
                        case 'r':
                        case 't':
                            break;
                        case 'u':
                            if (pos + 4 > s.length()) throw new JsonException("Bad unicode escape");
                            for (int i = pos; i < pos + 4; i++) {
                                char h = s.charAt(i);
                                boolean hex = (h >= '0' && h <= '9') || (h >= 'a' && h <= 'f') || (h >= 'A' && h <= 'F');
                                if (!hex) throw new JsonException("Bad unicode escape at " + i);
                            }
                            pos += 4;
                            break;
                        default:
                            throw new JsonException("Bad escape '\\" + e + "' at " + pos);
                    }
                }
            }
        }

        /** The four hex digits at {@code pos}, as {@link #readString} decodes them. */
        private char unicodeEscape() {
            if (pos + 4 > s.length()) throw new JsonException("Bad unicode escape");
            return (char) Integer.parseInt(s.substring(pos, pos + 4), 16);
        }

        private void expectWord(String word) {
            if (!s.startsWith(word, pos)) throw new JsonException("Invalid literal at " + pos);
            pos += word.length();
        }

        private Map<String, Object> readObject() {
            Map<String, Object> map = new LinkedHashMap<String, Object>();
            pos++; // {
            skipWhitespace();
            if (peek() == '}') {
                pos++;
                return map;
            }
            while (true) {
                skipWhitespace();
                if (peek() != '"') throw new JsonException("Expected string key at " + pos);
                String key = readString();
                skipWhitespace();
                if (peek() != ':') throw new JsonException("Expected ':' at " + pos);
                pos++;
                skipWhitespace();
                map.put(key, readValue());
                skipWhitespace();
                char c = peek();
                if (c == ',') {
                    pos++;
                    continue;
                }
                if (c == '}') {
                    pos++;
                    return map;
                }
                throw new JsonException("Expected ',' or '}' at " + pos);
            }
        }

        private List<Object> readArray() {
            List<Object> list = new ArrayList<Object>();
            pos++; // [
            skipWhitespace();
            if (peek() == ']') {
                pos++;
                return list;
            }
            while (true) {
                skipWhitespace();
                list.add(readValue());
                skipWhitespace();
                char c = peek();
                if (c == ',') {
                    pos++;
                    continue;
                }
                if (c == ']') {
                    pos++;
                    return list;
                }
                throw new JsonException("Expected ',' or ']' at " + pos);
            }
        }

        private char peek() {
            if (atEnd()) throw new JsonException("Unexpected end of JSON");
            return s.charAt(pos);
        }

        private String readString() {
            pos++; // opening quote
            StringBuilder sb = new StringBuilder();
            while (true) {
                if (atEnd()) throw new JsonException("Unterminated string");
                char c = s.charAt(pos++);
                if (c == '"') return sb.toString();
                if (c == '\\') {
                    if (atEnd()) throw new JsonException("Unterminated escape");
                    char e = s.charAt(pos++);
                    switch (e) {
                        case '"':
                            sb.append('"');
                            break;
                        case '\\':
                            sb.append('\\');
                            break;
                        case '/':
                            sb.append('/');
                            break;
                        case 'b':
                            sb.append('\b');
                            break;
                        case 'f':
                            sb.append('\f');
                            break;
                        case 'n':
                            sb.append('\n');
                            break;
                        case 'r':
                            sb.append('\r');
                            break;
                        case 't':
                            sb.append('\t');
                            break;
                        case 'u':
                            sb.append(unicodeEscape());
                            pos += 4;
                            break;
                        default:
                            throw new JsonException("Bad escape '\\" + e + "' at " + pos);
                    }
                } else {
                    sb.append(c);
                }
            }
        }

        private JsonNumber readNumber() {
            int start = pos;
            scanNumber();
            return new JsonNumber(s.substring(start, pos));
        }

        /** RFC 8259 number grammar: {@code -?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?}. */
        private void scanNumber() {
            int start = pos;
            if (peek() == '-') pos++;
            if (atEnd() || !isAsciiDigit(s.charAt(pos))) throw invalidNumber(start);
            if (s.charAt(pos) == '0') {
                pos++; // a leading zero stands alone: "01" stops here and fails on the '1'
            } else {
                skipDigits();
            }
            if (!atEnd() && s.charAt(pos) == '.') {
                pos++;
                if (skipDigits() == 0) throw invalidNumber(start);
            }
            if (!atEnd() && (s.charAt(pos) == 'e' || s.charAt(pos) == 'E')) {
                pos++;
                if (!atEnd() && (s.charAt(pos) == '+' || s.charAt(pos) == '-')) pos++;
                if (skipDigits() == 0) throw invalidNumber(start);
            }
        }

        private int skipDigits() {
            int from = pos;
            while (!atEnd() && isAsciiDigit(s.charAt(pos))) pos++;
            return pos - from;
        }

        private JsonException invalidNumber(int start) {
            int end = Math.min(s.length(), Math.max(pos + 1, start + 1));
            return new JsonException("Invalid number '" + s.substring(start, end) + "' at " + start);
        }

        private static boolean isAsciiDigit(char c) {
            return c >= '0' && c <= '9';
        }
    }

    // ------------------------------------------------------------- helpers
    public static String optString(Map<String, Object> map, String key) {
        Object value = map == null ? null : map.get(key);
        return value instanceof String ? (String) value : null;
    }
}
