package org.tvshell.iptvnator.server;

import android.system.ErrnoException;
import android.system.OsConstants;

import org.tvshell.iptvnator.backend.HttpFetcher;
import org.tvshell.iptvnator.backend.ProviderException;

import java.io.IOException;
import java.io.InputStream;
import java.net.ConnectException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.ProxySelector;
import java.net.Socket;
import java.net.URI;
import java.net.URL;
import java.util.Arrays;
import java.util.Collections;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.ConnectionSpec;
import okhttp3.Headers;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

final class AndroidHttpFetcher extends HttpFetcher {
    // Match Android's HttpsURLConnection and let the platform choose its enabled TLS settings.
    private static final ConnectionSpec PLATFORM_TLS = new ConnectionSpec.Builder(ConnectionSpec.MODERN_TLS)
        .allEnabledCipherSuites().allEnabledTlsVersions().build();
    private final OkHttpClient playlistClient;

    AndroidHttpFetcher() {
        this(new OkHttpClient.Builder());
    }

    AndroidHttpFetcher(OkHttpClient.Builder client) {
        playlistClient = client.connectionSpecs(Arrays.asList(PLATFORM_TLS, ConnectionSpec.CLEARTEXT))
            .followRedirects(false).followSslRedirects(false).build();
    }

    @Override protected ProviderResponse openResponse(URL url, Map<String, String> headers, int timeoutMs,
                                                      Cancellation cancellation) throws IOException, ProviderException {
        if (cancellation == null) return super.openResponse(url, headers, timeoutMs, null);
        Headers.Builder outgoing = new Headers.Builder();
        for (Map.Entry<String, String> header : headers.entrySet()) {
            String name = header.getKey();
            String value = header.getValue();
            if (name.equalsIgnoreCase("User-Agent")) {
                // Android's URLConnection accepts UTF-8 values while rejecting control characters.
                for (int i = 0; i < value.length(); i++) {
                    char character = value.charAt(i);
                    if ((character < ' ' && character != '\t') || character == '\u007f')
                        throw new ProviderException("Invalid User-Agent", "ERR_INVALID_CHAR");
                }
                outgoing.removeAll(name).addUnsafeNonAscii(name, value);
            } else {
                outgoing.set(name, value);
            }
        }
        Request request = new Request.Builder().url(url).headers(outgoing.build()).build();
        Call call = playlistClient.newBuilder()
            .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .build().newCall(request);
        cancellation.attach(call::cancel);
        Response response = call.execute();
        ResponseBody body = response.body();
        return new ProviderResponse() {
            @Override public int status() { return response.code(); }
            @Override public String message() { return response.message(); }
            @Override public String header(String name) { return response.header(name); }
            @Override public long contentLength() { return body == null ? -1 : body.contentLength(); }
            @Override public InputStream body() throws IOException {
                if (body == null) throw new IOException("Provider response body is missing");
                return body.byteStream();
            }
            @Override public void close() { response.close(); }
        };
    }

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
