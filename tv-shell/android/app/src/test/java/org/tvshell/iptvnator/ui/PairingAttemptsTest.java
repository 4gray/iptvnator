package org.tvshell.iptvnator.ui;

/** A callback released after cancel and retry must never become active again. */
public final class PairingAttemptsTest {
    public static void main(String[] args) throws Exception {
        PairingAttempts attempts = new PairingAttempts();
        long old = attempts.begin();
        java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.atomic.AtomicBoolean accepted = new java.util.concurrent.atomic.AtomicBoolean();
        Thread callback = new Thread(() -> {
            try { release.await(); } catch (InterruptedException e) { throw new AssertionError(e); }
            accepted.set(attempts.active(old));
        });
        callback.start();
        attempts.cancel();
        long current = attempts.begin();
        release.countDown();
        callback.join();
        if (accepted.get() || !attempts.active(current)) throw new AssertionError("Stale callback accepted");
        attempts.cancel();
        if (attempts.active(current)) throw new AssertionError("Cancelled callback accepted");
        System.out.println("Pairing attempt checks passed");
    }
}
