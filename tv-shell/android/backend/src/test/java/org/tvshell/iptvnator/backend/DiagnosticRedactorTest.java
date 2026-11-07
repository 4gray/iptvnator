package org.tvshell.iptvnator.backend;

import static org.tvshell.iptvnator.backend.TestMain.assertEquals;
import static org.tvshell.iptvnator.backend.TestMain.assertTrue;

public class DiagnosticRedactorTest {
    public void testConsoleCorsErrorsHideStreamAndSourceUrls() {
        String error = "Access to video at 'https://synthetic.example/live/synthetic-account/synthetic-secret/42.ts' "
            + "from origin 'http://127.0.0.1:43330' has been blocked by CORS policy (https://synthetic.example/player_api.php?password=synthetic-query:42)";
        String safe = DiagnosticRedactor.redact(error);
        assertTrue("CORS diagnosis retained", safe.contains("blocked by CORS policy"));
        assertTrue("path credentials removed", !safe.contains("synthetic-account") && !safe.contains("synthetic-secret"));
        assertTrue("query credentials removed", !safe.contains("synthetic-query"));
        assertTrue("provider host removed", !safe.contains("synthetic.example"));
    }

    public void testOtherCredentialFormatsAreHidden() {
        String[] messages = {
            "{\"url\":\"https:\\/\\/synthetic.example\\/live\\/synthetic-account\\/synthetic-secret\\/42.ts\"}",
            "{\"username\":\"synthetic-account\",\"password\":\"synthetic-secret\"}",
            "Authorization: Bearer synthetic-token", "Cookie: session=synthetic-cookie; mac=synthetic-device",
            "password=synthetic-secret&action=handshake", "token='synthetic token with spaces'",
            "rtsp://synthetic-account:synthetic-secret@synthetic.example/stream"
        };
        for (String message : messages) {
            assertTrue("sensitive details removed", !DiagnosticRedactor.redact(message).contains("synthetic"));
        }
    }

    public void testApostropheInsideStreamUrlDoesNotExposeSignedPath() {
        String error = "Access to video at 'https://synthetic.example/play'part(synthetic-secret)/stream.m3u8' "
            + "from origin 'http://127.0.0.1:43330' has been blocked by CORS policy";
        String safe = DiagnosticRedactor.redact(error);
        assertTrue("signed path removed", !safe.contains("synthetic-secret") && !safe.contains("stream.m3u8"));
        assertTrue("CORS diagnosis retained", safe.contains("blocked by CORS policy"));
    }

    public void testExceptionCausesAreRedacted() {
        RuntimeException error = new RuntimeException("synthetic failure",
            new IllegalArgumentException("https://synthetic.example/live/synthetic-account/synthetic-secret/42.ts"));
        String safe = DiagnosticRedactor.stackTrace(error);
        assertTrue("exception type retained", safe.contains("IllegalArgumentException"));
        assertTrue("stack retained", safe.contains("DiagnosticRedactorTest.java"));
        assertTrue("cause credentials removed", !safe.contains("synthetic-account") && !safe.contains("synthetic-secret"));
    }

    public void testSyntaxDiagnosticsRemainUsefulAndBounded() {
        assertEquals("empty", "", DiagnosticRedactor.redact(null));
        String error = "Uncaught SyntaxError: Unexpected token '?' at bundle.js:42";
        assertEquals("syntax error retained", error, DiagnosticRedactor.redact(error));
        assertTrue("redaction expansion bounded", DiagnosticRedactor.redact("http://x ".repeat(400)).length() <= 4000);
        assertTrue("diagnostics bounded", DiagnosticRedactor.redact("x".repeat(10000)).length() <= 4000);
    }
}
