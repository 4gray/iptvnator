package org.tvshell.iptvnator.server;

import android.system.ErrnoException;
import android.system.OsConstants;

import org.tvshell.iptvnator.backend.HttpFetcher;
import org.tvshell.iptvnator.backend.ProviderException;

import java.io.IOException;
import java.net.ConnectException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.ProxySelector;
import java.net.Socket;
import java.net.URI;
import java.util.Collections;
import java.util.Map;
import java.util.concurrent.TimeUnit;

final class AndroidHttpFetcher extends HttpFetcher {
    @Override
    public Result testConnection(String url, Map<String, String> headers, int timeoutMs) throws ProviderException {
        URI target = URI.create(url).resolve("/");
        if ("https".equalsIgnoreCase(target.getScheme()) && isDirectlyRefused(target, Math.min(timeoutMs, 500))) {
            throw new ProviderException("Connection refused", "ECONNREFUSED");
        }
        return super.testConnection(url, headers, timeoutMs);
    }

    private static boolean isDirectlyRefused(URI target, int timeoutMs) {
        ProxySelector selector = ProxySelector.getDefault();
        if (target.getHost() == null || selector == null
            || !Collections.singletonList(Proxy.NO_PROXY).equals(selector.select(target))) return false;

        // Android's HTTPS transport can lose errno. Check the initial endpoint without sending credentials.
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs);
        int port = target.getPort() == -1 ? 443 : target.getPort();
        try {
            InetAddress[] addresses = InetAddress.getAllByName(target.getHost());
            for (InetAddress address : addresses) {
                long remaining = TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime());
                if (remaining <= 0) return false;
                try (Socket socket = new Socket(Proxy.NO_PROXY)) {
                    socket.connect(new InetSocketAddress(address, port), (int) remaining);
                    return false;
                } catch (ConnectException e) {
                    if (!(e.getCause() instanceof ErrnoException) || e.getSuppressed().length != 0) return false;
                    ErrnoException cause = (ErrnoException) e.getCause();
                    if (cause.errno != OsConstants.ECONNREFUSED || cause.getCause() != null || cause.getSuppressed().length != 0) return false;
                }
            }
            return addresses.length != 0;
        } catch (IOException e) {
            return false;
        }
    }
}
