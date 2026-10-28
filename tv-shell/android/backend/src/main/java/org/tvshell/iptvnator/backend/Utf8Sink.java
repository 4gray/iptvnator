package org.tvshell.iptvnator.backend;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.SequenceInputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Appendable that encodes into UTF-8 bytes without allocating per call (OutputStreamWriter
 * allocates for every single character) and without ever copying what it already holds: the
 * bytes live in a list of chunks, 4 KB first and doubling up to just under 1 MB. A /parse answer
 * of tens of MB then costs its own size; a doubling array costs up to twice that, plus a final
 * copy. The body is served from the chunks ({@link #openStream()}, {@link #length()}).
 *
 * An unpaired surrogate becomes '?', as String.getBytes(UTF-8) does.
 */
final class Utf8Sink implements Appendable {

    static final int FIRST_CHUNK = 4 * 1024;
    /** Just under 1 MB: one G1 region on a desktop JVM; ART keeps such an array in its large-object space. */
    static final int MAX_CHUNK = (1 << 20) - 4096;

    private final int maxChunk;
    /** Every chunk here is full; the one being filled is {@link #buf}. */
    private final List<byte[]> full = new ArrayList<byte[]>();
    private long fullBytes;
    private byte[] buf;
    private int count;
    private char pendingHigh;

    Utf8Sink() {
        this(FIRST_CHUNK, MAX_CHUNK);
    }

    Utf8Sink(int firstChunk, int maxChunk) {
        this.maxChunk = Math.max(1, maxChunk);
        this.buf = new byte[Math.max(1, Math.min(firstChunk, this.maxChunk))];
    }

    private Utf8Sink(byte[] bytes) {
        this.maxChunk = MAX_CHUNK;
        this.buf = bytes;
        this.count = bytes.length;
    }

    /** A body made of {@code bytes} as they are (not copied). */
    static Utf8Sink of(byte[] bytes) {
        return new Utf8Sink(bytes == null ? new byte[0] : bytes);
    }

    @Override
    public Utf8Sink append(CharSequence csq) {
        CharSequence text = csq == null ? "null" : csq;
        return append(text, 0, text.length());
    }

    @Override
    public Utf8Sink append(CharSequence csq, int start, int end) {
        CharSequence text = csq == null ? "null" : csq;
        for (int i = start; i < end; i++) append(text.charAt(i));
        return this;
    }

    @Override
    public Utf8Sink append(char c) {
        if (pendingHigh != 0) {
            char high = pendingHigh;
            pendingHigh = 0;
            if (Character.isLowSurrogate(c)) {
                int cp = Character.toCodePoint(high, c);
                put(0xF0 | (cp >> 18));
                put(0x80 | ((cp >> 12) & 0x3F));
                put(0x80 | ((cp >> 6) & 0x3F));
                put(0x80 | (cp & 0x3F));
                return this;
            }
            put('?');
        }
        if (c < 0x80) {
            put(c);
        } else if (c < 0x800) {
            put(0xC0 | (c >> 6));
            put(0x80 | (c & 0x3F));
        } else if (Character.isHighSurrogate(c)) {
            pendingHigh = c;
        } else if (Character.isLowSurrogate(c)) {
            put('?');
        } else {
            put(0xE0 | (c >> 12));
            put(0x80 | ((c >> 6) & 0x3F));
            put(0x80 | (c & 0x3F));
        }
        return this;
    }

    /** Number of bytes written (a trailing unpaired high surrogate counts as its '?'). */
    long length() {
        finish();
        return fullBytes + count;
    }

    /** The bytes, read from the chunks in place; each call opens a new stream. */
    InputStream openStream() {
        finish();
        List<InputStream> parts = new ArrayList<InputStream>(full.size() + 1);
        for (byte[] chunk : full) parts.add(new ByteArrayInputStream(chunk));
        parts.add(new ByteArrayInputStream(buf, 0, count));
        return new SequenceInputStream(Collections.enumeration(parts));
    }

    /** The bytes as one array: a copy, for small bodies and tests. */
    byte[] toByteArray() {
        long length = length();
        if (length > Integer.MAX_VALUE) throw new IllegalStateException("body too large for one array");
        byte[] out = new byte[(int) length];
        int pos = 0;
        for (byte[] chunk : full) {
            System.arraycopy(chunk, 0, out, pos, chunk.length);
            pos += chunk.length;
        }
        System.arraycopy(buf, 0, out, pos, count);
        return out;
    }

    private void finish() {
        if (pendingHigh != 0) {
            pendingHigh = 0;
            put('?');
        }
    }

    private void put(int b) {
        if (count == buf.length) {
            if (count > 0) {
                full.add(buf);
                fullBytes += count;
            }
            buf = new byte[Math.min(maxChunk, Math.max(FIRST_CHUNK, buf.length * 2))];
            count = 0;
        }
        buf[count++] = (byte) b;
    }
}
