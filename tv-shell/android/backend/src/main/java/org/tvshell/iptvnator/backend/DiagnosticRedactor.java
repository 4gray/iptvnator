package org.tvshell.iptvnator.backend;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.regex.Pattern;

/**
 * Native counterpart to shared/logging: WebView diagnostics bypass the JavaScript logger.
 * Drop entire URLs (stream paths and fragments can be credentials), and the rest of a line
 * after a sensitive field rather than guessing where an unstructured credential ends.
 */
public final class DiagnosticRedactor {
    private static final int MAX_LENGTH = 4000;
    // Apostrophes may be part of a signed URL path.
    private static final Pattern URL = Pattern.compile("[a-z][a-z0-9+.-]*://[^\\s\"<>]+", Pattern.CASE_INSENSITIVE);
    private static final Pattern CREDENTIAL_LINE = Pattern.compile(
        "\\b[a-z0-9_.-]*(?:api[-_.]?key|auth(?:orization)?|cookie|credentials|device[-_.]?id[12]?|login|"
        + "mac(?:[-_.]?address)?|passwd|password|prehash|pwd|secret|serial[-_.]?number|set[-_.]?cookie|"
        + "signature[12]?|sn|token|username)[\"']?\\s*[:=][^\\r\\n]*", Pattern.CASE_INSENSITIVE);
    private static final Pattern AUTH_LINE = Pattern.compile("\\b(?:Bearer|Basic)\\s+[^\\r\\n]+", Pattern.CASE_INSENSITIVE);

    private DiagnosticRedactor() {}

    public static String redact(String message) {
        if (message == null) return "";
        boolean truncated = message.length() > MAX_LENGTH;
        // Bound work as well as log size; redact after cutting so a partial URL is still hidden.
        String text = (truncated ? message.substring(0, MAX_LENGTH) : message).replace("\\/", "/");
        text = URL.matcher(text).replaceAll("[Redacted URL]");
        text = CREDENTIAL_LINE.matcher(text).replaceAll("[Redacted credential details]");
        text = AUTH_LINE.matcher(text).replaceAll("[Redacted authorization]");
        if (text.length() > MAX_LENGTH - "[Truncated]".length()) {
            text = text.substring(0, MAX_LENGTH - "[Truncated]".length());
            truncated = true;
        }
        return text + (truncated ? "[Truncated]" : "");
    }

    public static String stackTrace(Throwable error) {
        StringWriter text = new StringWriter();
        error.printStackTrace(new PrintWriter(text));
        return redact(text.toString());
    }
}
