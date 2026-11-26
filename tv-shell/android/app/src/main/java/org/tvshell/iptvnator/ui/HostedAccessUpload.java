package org.tvshell.iptvnator.ui;

import android.util.Base64;
import java.io.IOException;
import java.io.InterruptedIOException;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.IntConsumer;
import okhttp3.MediaType;
import okhttp3.RequestBody;
import okio.BufferedSink;

/** Pulls one WebView blob slice per write. OkHttp can replay it after an Access challenge. */
final class HostedAccessUpload extends RequestBody {
    static final int CHUNK_BYTES = 64 * 1024;
    static final int MAX_BYTES = 64 * 1024 * 1024;
    private final int size;
    private final MediaType type;
    private final IntConsumer pull;
    private final ArrayBlockingQueue<String> chunks = new ArrayBlockingQueue<>(1);
    private volatile int expectedOffset = -1;
    private volatile boolean cancelled;

    HostedAccessUpload(long size, MediaType type, IntConsumer pull) throws IOException {
        if (size < 0 || size > MAX_BYTES) throw new IOException("Invalid hosted upload size");
        this.size = (int) size;
        this.type = type;
        this.pull = pull;
    }

    @Override public MediaType contentType() { return type; }
    @Override public long contentLength() { return size; }

    void accept(int offset, String chunk) {
        if (offset != expectedOffset || offset < 0) return;
        expectedOffset = -1;
        chunks.offer(chunk);
    }

    void cancel() {
        cancelled = true;
        chunks.offer("");
    }

    @Override public void writeTo(BufferedSink sink) throws IOException {
        for (int offset = 0; offset < size; offset += CHUNK_BYTES) {
            if (cancelled) throw new IOException("Upload cancelled");
            expectedOffset = offset;
            pull.accept(offset);
            String chunk;
            try {
                chunk = chunks.poll(45, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new InterruptedIOException("Upload interrupted");
            } finally {
                expectedOffset = -1;
            }
            if (cancelled || chunk == null) throw new IOException("Upload unavailable");
            int count = Math.min(CHUNK_BYTES, size - offset);
            if (chunk.length() != 4 * ((count + 2) / 3)) throw new IOException("Invalid upload chunk");
            byte[] bytes;
            try {
                bytes = Base64.decode(chunk, Base64.DEFAULT);
            } catch (IllegalArgumentException invalid) {
                throw new IOException("Invalid upload chunk", invalid);
            }
            if (bytes.length != count) throw new IOException("Invalid upload chunk");
            sink.write(bytes);
        }
    }
}
