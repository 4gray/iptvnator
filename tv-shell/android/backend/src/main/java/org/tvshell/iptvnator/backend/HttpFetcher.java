package org.tvshell.iptvnator.backend;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.MalformedURLException;
import java.net.NoRouteToHostException;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.nio.charset.Charset;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.zip.GZIPInputStream;
import java.util.zip.InflaterInputStream;

import javax.net.ssl.SSLException;
import javax.net.ssl.SSLHandshakeException;
import javax.net.ssl.SSLPeerUnverifiedException;

/**
 * The outbound side of the backend: GET a provider URL as text, following up
 * to five redirects (cross-protocol included, like the web backend's manual
 * redirect loop) and, like its ValidatedHttpClient, dropping Authorization,
 * Cookie, Proxy-Authorization, SN and Host when a redirect leaves the origin;
 * decoding gzip/deflate, with a per-request timeout.
 *
 * Failures are reported as {@link ProviderException}: an HTTP status with its
 * reason phrase, or a Node-style error code (ENOTFOUND, ECONNREFUSED,
 * ETIMEDOUT, ...) so the PWA's error toasts read the same as with Docker.
 */
public class HttpFetcher {

    /** User-Agent some Xtream panels require (XTREAM_CLIENT_USER_AGENT in IPTVnator). */
    public static final String DEFAULT_USER_AGENT = "VLC/3.0.18 LibVLC/3.0.18";
    private static final int MAX_REDIRECTS = 5;
    /**
     * A provider answer costs several times its size (bytes, a String, the record built from
     * it, the serialised response), so the cap follows the heap: an eighth of it, 64 MB at most
     * (32 MB on the 256 MB largeHeap of a 1 GB stick). Exhausting the heap would not stay on the
     * request thread: any other thread's allocation could fail and take the whole app down.
     */
    static final long MAX_BODY_BYTES = Math.min(64L * 1024 * 1024, Runtime.getRuntime().maxMemory() / 8);
    private static final Charset UTF8 = Charset.forName("UTF-8");

    /** The body exceeds the cap (declared up front, or found while reading). */
    static final class TooLargeException extends IOException {
        private static final long serialVersionUID = 1L;

        TooLargeException() {
            super("Response too large");
        }
    }

    public static final class Result {
        public final int status;
        public final String body;
        public final String contentType;

        Result(int status, String body, String contentType) {
            this.status = status;
            this.body = body;
            this.contentType = contentType;
        }
    }

    /**
     * Same rule as the web backend's ValidatedHttpClient (SENSITIVE_HEADERS): identity
     * headers never follow a redirect to another origin (scheme, host or effective port).
     * Returns the same map when the origin is unchanged, a filtered copy otherwise.
     */
    static Map<String, String> headersForRedirect(Map<String, String> headers, URL from, URL to) {
        if (headers == null || sameOrigin(from, to)) return headers;
        Map<String, String> kept = new LinkedHashMap<String, String>();
        for (Map.Entry<String, String> header : headers.entrySet()) {
            String name = header.getKey().toLowerCase(Locale.ROOT);
            if (name.equals("authorization") || name.equals("cookie") || name.equals("proxy-authorization")
                || name.equals("sn") || name.equals("host")) continue;
            kept.put(header.getKey(), header.getValue());
        }
        return kept;
    }

    static boolean sameOrigin(URL a, URL b) {
        int portA = a.getPort() == -1 ? a.getDefaultPort() : a.getPort();
        int portB = b.getPort() == -1 ? b.getDefaultPort() : b.getPort();
        return a.getProtocol().equalsIgnoreCase(b.getProtocol()) && a.getHost().equalsIgnoreCase(b.getHost()) && portA == portB;
    }

    public Result get(String url, Map<String, String> headers, int timeoutMs) throws ProviderException {
        Set<String> visited = new HashSet<String>();
        String current = url;
        for (int redirects = 0; ; redirects++) {
            if (!visited.add(current)) throw new ProviderException("Redirect cycle detected", "ERR_REDIRECT_CYCLE");
            HttpURLConnection connection;
            try {
                URL target = new URL(current);
                String protocol = target.getProtocol().toLowerCase();
                if (!protocol.equals("http") && !protocol.equals("https")) {
                    throw new ProviderException("Only http and https provider URLs are supported", "ERR_INVALID_PROTOCOL");
                }
                connection = (HttpURLConnection) target.openConnection();
            } catch (MalformedURLException e) {
                throw new ProviderException("Invalid URL", "ERR_INVALID_URL");
            } catch (IOException e) {
                throw mapNetworkError(e);
            }
            try {
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(timeoutMs);
                connection.setReadTimeout(timeoutMs);
                try {
                    connection.setRequestMethod("GET");
                } catch (java.net.ProtocolException e) {
                    throw new ProviderException("GET not supported", "EPROTO");
                }
                connection.setRequestProperty("Accept-Encoding", "gzip, deflate");
                connection.setRequestProperty("Accept", "*/*");
                boolean userAgentSet = false;
                if (headers != null) {
                    for (Map.Entry<String, String> header : headers.entrySet()) {
                        connection.setRequestProperty(header.getKey(), header.getValue());
                        if (header.getKey().equalsIgnoreCase("User-Agent")) userAgentSet = true;
                    }
                }
                if (!userAgentSet) connection.setRequestProperty("User-Agent", DEFAULT_USER_AGENT);

                int status;
                try {
                    status = connection.getResponseCode();
                } catch (IOException e) {
                    throw mapNetworkError(e);
                }
                if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                    String location = connection.getHeaderField("Location");
                    if (location == null || location.isEmpty()) {
                        throw new ProviderException("Redirect response did not include a location", "ERR_REDIRECT_LOCATION");
                    }
                    if (redirects >= MAX_REDIRECTS) throw new ProviderException("Too many redirects", "ERR_TOO_MANY_REDIRECTS");
                    try {
                        URL from = new URL(current);
                        URL next = new URL(from, location);
                        headers = headersForRedirect(headers, from, next);
                        current = next.toString();
                    } catch (MalformedURLException e) {
                        throw new ProviderException("Redirect location is not a valid URL", "ERR_REDIRECT_LOCATION");
                    }
                    continue;
                }
                if (status < 200 || status >= 300) {
                    String reason;
                    try {
                        reason = connection.getResponseMessage();
                    } catch (IOException e) {
                        reason = null;
                    }
                    throw new ProviderException(status, reason == null || reason.isEmpty() ? "HTTP " + status : reason);
                }
                String contentType = connection.getContentType();
                // Declared size first: an oversized answer is refused before a byte of it is read.
                long declared = connection.getContentLengthLong();
                if (declared > MAX_BODY_BYTES) throw tooLarge();
                InputStream in;
                try {
                    in = connection.getInputStream();
                } catch (IOException e) {
                    throw mapNetworkError(e);
                }
                String encoding = connection.getContentEncoding();
                boolean compressed = encoding != null && (encoding.toLowerCase().contains("gzip") || encoding.toLowerCase().contains("deflate"));
                try {
                    if (compressed && encoding.toLowerCase().contains("gzip")) in = new GZIPInputStream(in);
                    else if (compressed) in = new InflaterInputStream(in);
                    // Content-Length is the compressed size: it only sizes the buffer when the body is plain.
                    byte[] body = readAll(in, compressed ? -1 : declared, MAX_BODY_BYTES);
                    return new Result(status, new String(body, charsetOf(contentType)), contentType);
                } catch (TooLargeException e) {
                    throw tooLarge();
                } catch (IOException e) {
                    ProviderException wrapped = new ProviderException(status, "Provider response body failed");
                    wrapped.code = codeOf(e);
                    throw wrapped;
                } finally {
                    try {
                        in.close();
                    } catch (IOException ignored) {
                        // ignore
                    }
                }
            } finally {
                connection.disconnect();
            }
        }
    }

    private static Charset charsetOf(String contentType) {
        if (contentType != null) {
            int idx = contentType.toLowerCase().indexOf("charset=");
            if (idx >= 0) {
                String name = contentType.substring(idx + 8).trim();
                int end = name.indexOf(';');
                if (end >= 0) name = name.substring(0, end).trim();
                name = name.replace("\"", "");
                try {
                    return Charset.forName(name);
                } catch (RuntimeException ignored) {
                    // fall through to UTF-8
                }
            }
        }
        return UTF8;
    }

    static ProviderException tooLarge() {
        return new ProviderException("Provider response is too large for this device", "ERR_RESPONSE_TOO_LARGE");
    }

    /**
     * Reads at most {@code limit} bytes. A known plain size ({@code declared} &gt;= 0) sizes the
     * buffer once instead of doubling it (which peaks at three times the body).
     */
    static byte[] readAll(InputStream in, long declared, long limit) throws IOException {
        if (declared > limit) throw new TooLargeException();
        ByteArrayOutputStream out = new ByteArrayOutputStream(declared > 0 ? (int) declared : 64 * 1024);
        byte[] buffer = new byte[16 * 1024];
        long total = 0;
        int read;
        while ((read = in.read(buffer)) != -1) {
            total += read;
            if (total > limit) throw new TooLargeException();
            out.write(buffer, 0, read);
        }
        return out.toByteArray();
    }

    static String codeOf(IOException e) {
        if (e instanceof UnknownHostException) return "ENOTFOUND";
        if (e instanceof ConnectException) return "ECONNREFUSED";
        if (e instanceof NoRouteToHostException) return "EHOSTUNREACH";
        if (e instanceof SocketTimeoutException) return "ETIMEDOUT";
        if (e instanceof SSLPeerUnverifiedException) return "ERR_TLS_CERT_ALTNAME_INVALID";
        if (e instanceof SSLHandshakeException) return "UNABLE_TO_VERIFY_LEAF_SIGNATURE";
        if (e instanceof SSLException) return "EPROTO";
        String message = e.getMessage() == null ? "" : e.getMessage().toLowerCase();
        if (message.contains("reset")) return "ECONNRESET";
        if (message.contains("refused")) return "ECONNREFUSED";
        if (message.contains("unreachable")) return "ENETUNREACH";
        return "EIO";
    }

    static ProviderException mapNetworkError(IOException e) {
        return new ProviderException(e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage(), codeOf(e));
    }

    /** Convenience for callers that pass no headers. */
    public static Map<String, String> headers(String... keyValues) {
        Map<String, String> map = new LinkedHashMap<String, String>();
        for (int i = 0; i + 1 < keyValues.length; i += 2) map.put(keyValues[i], keyValues[i + 1]);
        return map;
    }
}
