package org.tvshell.iptvnator.backend;

import static org.tvshell.iptvnator.backend.TestMain.assertEquals;
import static org.tvshell.iptvnator.backend.TestMain.assertTrue;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.InetAddress;
import java.net.ConnectException;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.security.cert.CertificateException;
import java.util.Map;
import javax.net.ssl.SSLException;
import javax.net.ssl.SSLHandshakeException;
import javax.net.ssl.SSLPeerUnverifiedException;

/** Contract checks use synthetic loopback providers only, without weakening TLS verification. */
public class ProtocolDiscoveryTest {
    private static final String WRONG_VERSION = "OPENSSL_internal:WRONG_VERSION_NUMBER";

    private static final class SyntheticServer implements AutoCloseable {
        final ServerSocket listener = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"));
        final Thread thread;
        volatile IOException failure;

        SyntheticServer(final String response, final boolean tlsClient) throws IOException {
            thread = new Thread(() -> {
                try (Socket socket = listener.accept()) {
                    socket.setSoTimeout(3000);
                    if (tlsClient) {
                        // Consume ClientHello before returning plaintext, avoiding a TCP reset.
                        byte[] header = socket.getInputStream().readNBytes(5);
                        if (header.length != 5 || header[0] != 22) throw new IOException("Expected synthetic TLS handshake");
                        int length = ((header[3] & 255) << 8) | (header[4] & 255);
                        if (socket.getInputStream().readNBytes(length).length != length) throw new IOException("Incomplete ClientHello");
                    } else {
                        BufferedReader request = new BufferedReader(new InputStreamReader(socket.getInputStream(), "US-ASCII"));
                        String line;
                        while ((line = request.readLine()) != null && !line.isEmpty()) { /* consume headers */ }
                    }
                    socket.getOutputStream().write(response.getBytes("US-ASCII"));
                    socket.getOutputStream().flush();
                } catch (IOException error) {
                    failure = error;
                }
            }, "synthetic-protocol-provider");
            thread.start();
        }

        String url(String scheme) { return scheme + "://127.0.0.1:" + listener.getLocalPort(); }

        @Override
        public void close() throws Exception {
            listener.close();
            thread.join(4000);
            assertTrue("synthetic provider finished", !thread.isAlive());
            if (failure != null) throw failure;
        }
    }

    private static int unusedPort() throws IOException {
        try (ServerSocket socket = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) {
            return socket.getLocalPort();
        }
    }

    private static String redirect(String destination) {
        return "HTTP/1.1 302 Found\r\nLocation: " + destination + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> connectionTest(String url) {
        WebBackend backend = new WebBackend(new HttpFetcher(), "/api");
        String id = WebBackendTest.register(backend, url);
        WebBackend.Response result = backend.handle("GET", "/xtream", WebBackendTest.query(
            "targetId", id, "connectionTest", "true", "username", "synthetic-account", "password", "synthetic-secret"), null);
        assertEquals("probe status", 200, Integer.valueOf(result.status));
        return (Map<String, Object>) WebBackendTest.body(result).get("connectionFailure");
    }

    public void testInitialConnectionRefusalAllowsExplicitHttpProbe() throws Exception {
        Map<String, Object> failure = connectionTest("http://127.0.0.1:" + unusedPort());
        assertEquals("initial refusal", Boolean.TRUE, failure.get("canTryHttp"));
    }

    public void testRedirectedConnectionRefusalCannotAuthorizeHttp() throws Exception {
        try (SyntheticServer source = new SyntheticServer(redirect("http://127.0.0.1:" + unusedPort()), false)) {
            assertEquals("a response before refusal prevents downgrade", Boolean.FALSE,
                connectionTest(source.url("http")).get("canTryHttp"));
        }
    }

    public void testRealPlaintextListenerIsRecognizedAsTlsWrongVersion() throws Exception {
        try (SyntheticServer server = new SyntheticServer("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", true)) {
            Map<String, Object> failure = connectionTest(server.url("https"));
            assertEquals("TLS mismatch", "tls", failure.get("kind"));
            assertEquals("initial plaintext listener permits explicit HTTP probe", Boolean.TRUE, failure.get("canTryHttp"));
        }
    }

    public void testRedirectedTlsMismatchCannotAuthorizeHttp() throws Exception {
        try (SyntheticServer destination = new SyntheticServer("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", true);
             SyntheticServer source = new SyntheticServer(redirect(destination.url("https")), false)) {
            assertEquals("redirect evidence also blocks a later TLS mismatch", Boolean.FALSE,
                connectionTest(source.url("http")).get("canTryHttp"));
        }
    }

    public void testRecognizesOnlySpecificTlsWrongVersionMessages() {
        String[] messages = { WRONG_VERSION, "ssl3_get_record:wrong version number", "Unsupported or unrecognized SSL message",
            "Unrecognized SSL message, plaintext connection?" };
        for (String message : messages) {
            for (SSLException error : new SSLException[] { new SSLException(message), new SSLHandshakeException(message) }) {
                assertEquals("positive wrong-version evidence retained", "ERR_SSL_WRONG_VERSION_NUMBER", HttpFetcher.codeOf(error));
                assertEquals("initial wrong version permits explicit probe", Boolean.TRUE,
                    WebBackend.describeConnectionFailure(HttpFetcher.mapNetworkError(error)).get("canTryHttp"));
            }
        }
    }

    public void testOnlyPositiveConnectionRefusalAllowsHttp() {
        for (String message : new String[] { "Connection refused", "isConnected failed: ECONNREFUSED (Connection refused)" }) {
            assertEquals("explicit refusal permits probe", Boolean.TRUE,
                WebBackend.describeConnectionFailure(HttpFetcher.mapNetworkError(new ConnectException(message))).get("canTryHttp"));
        }
        for (String message : new String[] { "Network is unreachable", "isConnected failed: ENETUNREACH", "Connection timed out", "", "notECONNREFUSED", "ENETUNREACH (Connection refused)" }) {
            assertEquals("other connection failures cannot permit probe", Boolean.FALSE,
                WebBackend.describeConnectionFailure(HttpFetcher.mapNetworkError(new ConnectException(message))).get("canTryHttp"));
        }
        assertEquals("generic I/O text is insufficient", Boolean.FALSE,
            WebBackend.describeConnectionFailure(HttpFetcher.mapNetworkError(new IOException("Connection refused"))).get("canTryHttp"));
    }

    public void testMixedAndUnboundedConnectionFailuresCannotAuthorizeHttp() {
        ConnectException mixed = new ConnectException("Connection refused");
        mixed.initCause(new ConnectException("ENETUNREACH"));
        ConnectException suppressed = new ConnectException("Connection refused");
        suppressed.addSuppressed(new SocketTimeoutException("synthetic timeout"));
        ConnectException cycle = new ConnectException("Connection refused"), other = new ConnectException("Connection refused");
        cycle.initCause(other); other.initCause(cycle);
        ConnectException deep = new ConnectException("Connection refused");
        for (int i = 0; i < 65; i++) {
            ConnectException wrapper = new ConnectException("Connection refused");
            wrapper.initCause(deep); deep = wrapper;
        }
        for (ConnectException error : new ConnectException[] { mixed, suppressed, cycle, deep }) {
            assertEquals("ambiguous connection evidence fails closed", Boolean.FALSE,
                WebBackend.describeConnectionFailure(HttpFetcher.mapNetworkError(error)).get("canTryHttp"));
        }
    }

    public void testCertificatesAndOtherTlsFailuresCannotAuthorizeHttp() {
        SSLHandshakeException certificateCause = new SSLHandshakeException(WRONG_VERSION);
        certificateCause.initCause(new CertificateException("synthetic certificate rejected"));
        SSLException mixed = new SSLException(WRONG_VERSION);
        mixed.initCause(new SocketTimeoutException("synthetic timeout"));
        SSLException cycle = new SSLException(WRONG_VERSION), other = new SSLException(WRONG_VERSION);
        cycle.initCause(other); other.initCause(cycle);
        SSLException suppressed = new SSLException(WRONG_VERSION);
        suppressed.addSuppressed(new CertificateException("synthetic unverified certificate"));
        SSLException deep = new SSLException(WRONG_VERSION);
        for (int i = 0; i < 65; i++) {
            SSLException wrapper = new SSLException(WRONG_VERSION);
            wrapper.initCause(deep);
            deep = wrapper;
        }
        IOException[] failures = { new SSLPeerUnverifiedException(WRONG_VERSION), certificateCause, mixed, cycle, suppressed, deep,
            new SSLHandshakeException("PKIX path building failed"), new SSLException("handshake_failure"),
            new SSLHandshakeException("certificate verify failed: " + WRONG_VERSION), new IOException(WRONG_VERSION) };
        for (IOException failure : failures) {
            assertEquals("no downgrade without exclusive protocol evidence", Boolean.FALSE,
                WebBackend.describeConnectionFailure(HttpFetcher.mapNetworkError(failure)).get("canTryHttp"));
        }
    }
}
