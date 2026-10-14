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
        assertEquals("double", "1.5", Json.write(Double.valueOf(1.5)));
        assertEquals("whole double", "3", Json.write(Double.valueOf(3.0)));
        assertEquals("long", "-7", Json.write(Long.valueOf(-7)));
    }
}
