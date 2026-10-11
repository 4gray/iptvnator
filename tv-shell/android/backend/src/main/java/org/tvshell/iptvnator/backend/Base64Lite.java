package org.tvshell.iptvnator.backend;

import java.io.ByteArrayOutputStream;

/**
 * Forgiving base64 decoder (the WHATWG algorithm behind {@code atob}): ASCII
 * whitespace is ignored, trailing padding is optional, anything else that is
 * not in the alphabet fails. Kept dependency-free so it runs on API 25.
 */
public final class Base64Lite {

    private static final String ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    private Base64Lite() {
    }

    /** @return the decoded bytes, or null when the input is not valid base64. */
    public static byte[] decode(String input) {
        StringBuilder cleaned = new StringBuilder(input.length());
        for (int i = 0; i < input.length(); i++) {
            char c = input.charAt(i);
            if (c == ' ' || c == '\t' || c == '\n' || c == '\f' || c == '\r') continue;
            cleaned.append(c);
        }
        String s = cleaned.toString();
        if (s.length() % 4 == 0) {
            if (s.endsWith("==")) s = s.substring(0, s.length() - 2);
            else if (s.endsWith("=")) s = s.substring(0, s.length() - 1);
        }
        if (s.length() % 4 == 1) return null;
        ByteArrayOutputStream out = new ByteArrayOutputStream(s.length() * 3 / 4);
        int buffer = 0;
        int bits = 0;
        for (int i = 0; i < s.length(); i++) {
            int value = ALPHABET.indexOf(s.charAt(i));
            if (value < 0) return null;
            buffer = (buffer << 6) | value;
            bits += 6;
            if (bits >= 8) {
                bits -= 8;
                out.write((buffer >> bits) & 0xFF);
            }
        }
        return out.toByteArray();
    }
}
