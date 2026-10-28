package org.tvshell.iptvnator.backend;

import static org.tvshell.iptvnator.backend.TestMain.assertEquals;
import static org.tvshell.iptvnator.backend.TestMain.assertTrue;

import java.util.List;
import java.util.Map;

public class JsonTest {

    @SuppressWarnings("unchecked")
    public void testRoundTripKeepsNumbersAndUnicode() {
        String text = "{\"a\":1,\"b\":-2.50,\"c\":1e3,\"s\":\"h\\u00e9llo \\\"q\\\" \\n\",\"n\":null,\"t\":true,\"l\":[1,{\"x\":[]}]}";
        Map<String, Object> parsed = (Map<String, Object>) Json.parse(text);
        assertEquals("int", "1", parsed.get("a").toString());
        assertEquals("decimal keeps lexical form", "-2.50", parsed.get("b").toString());
        assertEquals("exponent", "1e3", parsed.get("c").toString());
        assertEquals("string", "h\u00e9llo \"q\" \n", parsed.get("s"));
        assertTrue("null", parsed.containsKey("n") && parsed.get("n") == null);
        assertEquals("bool", Boolean.TRUE, parsed.get("t"));
        assertTrue("list", ((List<Object>) parsed.get("l")).size() == 2);
        String written = Json.write(parsed);
        assertEquals("rewritten", "{\"a\":1,\"b\":-2.50,\"c\":1e3,\"s\":\"h\u00e9llo \\\"q\\\" \\n\",\"n\":null,\"t\":true,\"l\":[1,{\"x\":[]}]}", written);
    }

    public void testInvalidJsonIsRejected() {
        String[] bad = {"{", "[1,]", "{\"a\":}", "tru", "\"unterminated", "01x", "{\"a\":1}x", ""};
        for (String text : bad) assertTrue("rejects " + text, !Json.isValid(text));
        assertTrue("accepts bare string", Json.isValid("\"x\""));
        assertTrue("accepts bom", Json.isValid("\uFEFF{}"));
    }

    public void testNumberGrammarIsStrict() {
        String[] good = {"0", "-0", "7", "-12", "1.5", "0.25", "1e3", "1E+2", "-2.5e-3", "12345678901234567890"};
        for (String text : good) {
            Object parsed = Json.parse(text);
            assertTrue("keeps " + text, parsed instanceof Json.JsonNumber && text.equals(parsed.toString()));
        }
        // Each of these is rejected by RFC 8259; the old reader passed some of
        // them through to the PWA, where JSON.parse then failed on the answer.
        // Non-ASCII digits after an ASCII one ("1" + ARABIC-INDIC DIGIT ONE): the old
        // reader took them with Character.isDigit and wrote them back to the PWA.
        String[] bad = {"01", "00", "-01", "1.", ".5", "-.5", "-", "1e", "1e-", "1e+", "1.e5", "+1", "1..2", "0x10",
            "1\u0661", "1.\u0661", "1e\u0661"};
        for (String text : bad) assertTrue("rejects " + text, !Json.isValid(text));
        assertTrue("rejects inside an object", !Json.isValid("{\"a\":01}"));
        assertTrue("rejects inside an array", !Json.isValid("[1e-]"));
        assertTrue("accepts inside structures", Json.isValid("{\"a\":[0,-1.5e2,1E-7]}"));
    }

    public void testNestingIsBounded() {
        assertTrue("accepts " + (Json.MAX_DEPTH - 1) + " levels", Json.isValid(nested(Json.MAX_DEPTH - 1)));
        assertTrue("accepts " + Json.MAX_DEPTH + " levels", Json.isValid(nested(Json.MAX_DEPTH)));
        assertTrue("rejects " + (Json.MAX_DEPTH + 1) + " levels", !Json.isValid(nested(Json.MAX_DEPTH + 1)));
        // Far beyond the limit: a JsonException, never a StackOverflowError.
        String deep = nested(20000);
        try {
            Json.parse(deep);
            assertTrue("deep nesting must be rejected", false);
        } catch (Json.JsonException expected) {
            assertTrue("names the limit", expected.getMessage().contains(String.valueOf(Json.MAX_DEPTH)));
        }
        // Objects count too, and the depth resets between values.
        assertTrue("rejects deep objects", !Json.isValid(nestedObjects(Json.MAX_DEPTH + 1)));
        assertTrue("siblings do not accumulate depth", Json.isValid("[" + nested(Json.MAX_DEPTH - 1) + "," + nested(Json.MAX_DEPTH - 1) + "]"));
    }

    private static String nested(int levels) {
        StringBuilder sb = new StringBuilder(levels * 2);
        for (int i = 0; i < levels; i++) sb.append('[');
        for (int i = 0; i < levels; i++) sb.append(']');
        return sb.toString();
    }

    private static String nestedObjects(int levels) {
        StringBuilder sb = new StringBuilder(levels * 8);
        for (int i = 0; i < levels; i++) sb.append("{\"a\":");
        sb.append("1");
        for (int i = 0; i < levels; i++) sb.append('}');
        return sb.toString();
    }

    public void testWriterEscapesControlCharacters() {
        assertEquals("escapes", "\"\\u0001\\t\\u2028\"", Json.write("\u0001\t\u2028"));
        assertEquals("mixed runs", "\"a\\\"b\\\\c\\nd\"", Json.write("a\"b\\c\nd"));
        assertEquals("plain", "\"plain text\"", Json.write("plain text"));
        assertEquals("empty", "\"\"", Json.write(""));
        assertEquals("double", "1.5", Json.write(Double.valueOf(1.5)));
        assertEquals("whole double", "3", Json.write(Double.valueOf(3.0)));
        assertEquals("long", "-7", Json.write(Long.valueOf(-7)));
    }

    /** writeUtf8() gives the bytes String.getBytes(UTF-8) gives for the same text, surrogates included. */
    public void testWriteUtf8MatchesTheStringEncoder() throws Exception {
        Object[] samples = {
            "plain", "h\u00e9llo", "\u20ac \u4e2d\u6587", "emoji \ud83d\udcfa tv", "lone high \ud83d x", "lone low \udcfa x", "ends high \ud83d",
            Json.parse("{\"a\":[1,2.50,\"\\u2028\\n\"],\"b\":null}"),
        };
        for (Object sample : samples) {
            byte[] expected = Json.write(sample).getBytes("UTF-8");
            assertTrue("utf-8 of " + Json.write(sample), java.util.Arrays.equals(expected, Json.writeUtf8(sample).toByteArray()));
        }
        Utf8Sink sink = new Utf8Sink(1, 3);
        sink.append("ab\ud83d");
        assertEquals("trailing high surrogate", "ab?", new String(sink.toByteArray(), "UTF-8"));
        StringBuilder big = new StringBuilder();
        for (int i = 0; i < 5000; i++) big.append("\u00e9\ud83d\udcfa,");
        assertTrue("growth", java.util.Arrays.equals(Json.write(big.toString()).getBytes("UTF-8"), Json.writeUtf8(big.toString()).toByteArray()));
    }

    /**
     * The chunked sink holds every byte once: multi-byte sequences split across chunks, the
     * stream and the length agree with the String encoder, and nothing is copied while writing.
     */
    public void testUtf8SinkChunksAgreeWithTheStringEncoder() throws Exception {
        StringBuilder text = new StringBuilder();
        for (int i = 0; i < 3000; i++) text.append(i % 7 == 0 ? "\ud83d\udcfa" : i % 5 == 0 ? "\u20ac" : i % 3 == 0 ? "\u00e9" : "a");
        byte[] expected = Json.write(text.toString()).getBytes("UTF-8");
        int[][] shapes = {{1, 1}, {1, 3}, {2, 5}, {4096, 7}, {Utf8Sink.FIRST_CHUNK, Utf8Sink.MAX_CHUNK}};
        for (int[] shape : shapes) {
            Utf8Sink sink = new Utf8Sink(shape[0], shape[1]);
            Json.write(text.toString(), sink);
            String what = "chunks " + shape[0] + ".." + shape[1];
            assertEquals(what + " length", Long.valueOf(expected.length), Long.valueOf(sink.length()));
            assertTrue(what + " bytes", java.util.Arrays.equals(expected, sink.toByteArray()));
            assertTrue(what + " stream", java.util.Arrays.equals(expected, LocalMain.readAll(sink.openStream())));
            assertTrue(what + " stream again", java.util.Arrays.equals(expected, LocalMain.readAll(sink.openStream())));
        }
        byte[] given = "{\"a\":1}".getBytes("UTF-8");
        Utf8Sink wrapped = Utf8Sink.of(given);
        assertEquals("wrapped length", Long.valueOf(given.length), Long.valueOf(wrapped.length()));
        assertTrue("wrapped bytes", java.util.Arrays.equals(given, LocalMain.readAll(wrapped.openStream())));
        assertEquals("empty", Long.valueOf(0), Long.valueOf(Utf8Sink.of(new byte[0]).length()));
        assertEquals("empty stream", -1, Integer.valueOf(Utf8Sink.of(null).openStream().read()));
    }

    /** validate() skips the same grammar parse() builds: both must agree on every sample. */
    public void testValidateAgreesWithParse() {
        String[] samples = {
            "{}", "[]", "\"x\"", "null", "true", "false", "0", "-1.5e3", "{\"a\":[0,-1.5e2,1E-7,\"s\\u00e9\\\"\\\\/\\b\\f\\n\\r\\t\"]}",
            "\uFEFF{}", " [ 1 , 2 ] ", "{\"a\":{\"b\":{\"c\":[[[]]]}}}",
            "", " ", "{", "[1,]", "{\"a\":01}", "[1e-]", "nul", "{\"a\" 1}", "[1 2]", "\"unterminated", "\"bad\\q\"",
            "\"\\u12\"", "{\"a\":1}x", "[1]]", "{\"a\":1,}", "01", "-", "1.", ".5", "+1", "tru", "[\"a\",]",
            nested(Json.MAX_DEPTH), nested(Json.MAX_DEPTH + 1), nestedObjects(Json.MAX_DEPTH + 1),
            "[" + nested(Json.MAX_DEPTH - 1) + "," + nested(Json.MAX_DEPTH - 1) + "]",
        };
        for (String text : samples) {
            assertEquals("validate(" + text.replace("\n", "\\n") + ")", Boolean.valueOf(Json.isValid(text)), Boolean.valueOf(Json.validate(text)));
        }
        assertTrue("null text", !Json.validate(null));
    }

    /** What validate() accepts is sent verbatim: only text a browser's JSON.parse accepts. */
    public void testValidateIsAsStrictAsTheBrowser() {
        String[] lenient = {"[\"a\tb\"]", "{\"plot\":\"line1\nline2\"}", "[\"\\u+041\"]", "[\"\\u-001\"]", "[\"\\u\u0661\u0662\u0663\u0664\"]"};
        for (String text : lenient) {
            String shown = text.replace("\t", "<TAB>").replace("\n", "<LF>");
            assertTrue("parse() still reads " + shown, Json.isValid(text));
            assertTrue("validate() refuses " + shown, !Json.validate(text));
        }
        assertTrue("escaped controls are fine", Json.validate("[\"a\\tb\\u00e9\\uD83D\\uDCFA\"]"));
    }

    @SuppressWarnings("unchecked")
    public void testRawIsWrittenVerbatim() throws java.io.IOException {
        Map<String, Object> out = Json.object();
        out.put("action", "get_live_streams");
        out.put("payload", new Json.Raw("[ {\"num\" : 1.0, \"name\":\"One\"} ]"));
        String text = Json.write(out);
        assertEquals("verbatim", "{\"action\":\"get_live_streams\",\"payload\":[ {\"num\" : 1.0, \"name\":\"One\"} ]}", text);
        assertEquals("still a document", "One", ((Map<String, Object>) ((List<Object>) ((Map<String, Object>) Json.parse(text)).get("payload")).get(0)).get("name"));
        java.io.StringWriter writer = new java.io.StringWriter();
        Json.write(out, writer);
        assertEquals("appendable sink", text, writer.toString());
        java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
        java.io.Writer stream = new java.io.OutputStreamWriter(bytes, java.nio.charset.StandardCharsets.UTF_8);
        Json.write(Json.parse("{\"s\":\"h\\u00e9llo \\u2028\"}"), stream);
        stream.flush();
        assertEquals("utf-8 stream", "{\"s\":\"h\u00e9llo \\u2028\"}", new String(bytes.toByteArray(), java.nio.charset.StandardCharsets.UTF_8));
    }
}
