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

    public void testWriterEscapesControlCharacters() {
        assertEquals("escapes", "\"\\u0001\\t\\u2028\"", Json.write("\u0001\t\u2028"));
        assertEquals("double", "1.5", Json.write(Double.valueOf(1.5)));
        assertEquals("whole double", "3", Json.write(Double.valueOf(3.0)));
        assertEquals("long", "-7", Json.write(Long.valueOf(-7)));
    }
}
