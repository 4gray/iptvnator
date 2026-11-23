package org.tvshell.iptvnator.ui;

import java.util.concurrent.atomic.AtomicLong;

/** Identifies the only attempt whose asynchronous callbacks may change the UI or credentials. */
final class PairingAttempts {
    private final AtomicLong generation = new AtomicLong();
    long begin() { return generation.incrementAndGet(); }
    void cancel() { generation.incrementAndGet(); }
    boolean active(long attempt) { return generation.get() == attempt; }
}
