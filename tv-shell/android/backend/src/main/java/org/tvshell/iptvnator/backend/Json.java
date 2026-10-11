package org.tvshell.iptvnator.backend;

import java.math.BigDecimal;
import java.util.ArrayList;
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

    @SuppressWarnings("unchecked")
    public static void write(Object value, StringBuilder sb) {
        if (value == null) {
            sb.append("null");
        } else if (value instanceof String) {
            writeString((String) value, sb);
        } else if (value instanceof Boolean) {
            sb.append(((Boolean) value).booleanValue() ? "true" : "false");
        } else if (value instanceof JsonNumber) {
            sb.append(((JsonNumber) value).text());
        } else if (value instanceof Number) {
            double d = ((Number) value).doubleValue();
            if (value instanceof Integer || value instanceof Long || value instanceof Short || value instanceof Byte) {
                sb.append(((Number) value).longValue());
            } else if (Double.isNaN(d) || Double.isInfinite(d)) {
                sb.append("null");
            } else if (d == Math.rint(d) && Math.abs(d) < 1e15) {
                sb.append((long) d);
            } else {
                sb.append(Double.toString(d));
            }
        } else if (value instanceof Map) {
            sb.append('{');
            boolean first = true;
            for (Map.Entry<String, Object> entry : ((Map<String, Object>) value).entrySet()) {
                if (!first) sb.append(',');
                first = false;
                writeString(entry.getKey(), sb);
                sb.append(':');
                write(entry.getValue(), sb);
            }
            sb.append('}');
        } else if (value instanceof Iterable) {
            sb.append('[');
            boolean first = true;
            for (Object item : (Iterable<Object>) value) {
                if (!first) sb.append(',');
                first = false;
                write(item, sb);
            }
            sb.append(']');
        } else {
            writeString(String.valueOf(value), sb);
        }
    }

    private static void writeString(String s, StringBuilder sb) {
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':
                    sb.append("\\\"");
                    break;
                case '\\':
                    sb.append("\\\\");
                    break;
                case '\n':
                    sb.append("\\n");
                    break;
                case '\r':
                    sb.append("\\r");
                    break;
                case '\t':
                    sb.append("\\t");
                    break;
                case '\b':
                    sb.append("\\b");
                    break;
                case '\f':
                    sb.append("\\f");
                    break;
                default:
                    if (c < 0x20 || c == 0x2028 || c == 0x2029) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        sb.append('"');
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

    /** True when the text is a syntactically valid JSON document. */
    public static boolean isValid(String text) {
        try {
            parse(text);
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    private static final class Reader {
        private final String s;
        private int pos;

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
                    return readObject();
                case '[':
                    return readArray();
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
                            if (pos + 4 > s.length()) throw new JsonException("Bad unicode escape");
                            sb.append((char) Integer.parseInt(s.substring(pos, pos + 4), 16));
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
            if (peek() == '-') pos++;
            while (!atEnd() && Character.isDigit(s.charAt(pos))) pos++;
            if (!atEnd() && s.charAt(pos) == '.') {
                pos++;
                while (!atEnd() && Character.isDigit(s.charAt(pos))) pos++;
            }
            if (!atEnd() && (s.charAt(pos) == 'e' || s.charAt(pos) == 'E')) {
                pos++;
                if (!atEnd() && (s.charAt(pos) == '+' || s.charAt(pos) == '-')) pos++;
                while (!atEnd() && Character.isDigit(s.charAt(pos))) pos++;
            }
            String text = s.substring(start, pos);
            if (text.equals("-") || text.endsWith(".") || text.endsWith("e") || text.endsWith("E") || text.endsWith("+")) {
                throw new JsonException("Invalid number '" + text + "' at " + start);
            }
            return new JsonNumber(text);
        }
    }

    // ------------------------------------------------------------- helpers
    public static String optString(Map<String, Object> map, String key) {
        Object value = map == null ? null : map.get(key);
        return value instanceof String ? (String) value : null;
    }
}
