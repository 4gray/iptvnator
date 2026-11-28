package org.tvshell.iptvnator.backend;

import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

/** Tracks optional loopback download IDs supplied by the bundled PWA. */
final class PlaylistDownloads {
    private static final int MAX_RECENT_CANCELLATIONS = 128;
    private final Map<String, HttpFetcher.Cancellation> active = new HashMap<>();
    private final Set<String> cancelled = new LinkedHashSet<>();

    static boolean validId(String id) {
        return id != null && id.matches("[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}");
    }

    synchronized HttpFetcher.Cancellation start(String id) {
        if (active.containsKey(id) || cancelled.contains(id)) return null;
        HttpFetcher.Cancellation request = new HttpFetcher.Cancellation();
        active.put(id, request);
        return request;
    }

    synchronized void finish(String id, HttpFetcher.Cancellation request) {
        active.remove(id, request);
    }

    void cancel(String id) {
        HttpFetcher.Cancellation request;
        synchronized (this) {
            // The cancellation POST can reach the local server before the GET.
            cancelled.add(id);
            if (cancelled.size() > MAX_RECENT_CANCELLATIONS)
                cancelled.remove(cancelled.iterator().next());
            request = active.get(id);
        }
        if (request != null) request.cancel();
    }
}
