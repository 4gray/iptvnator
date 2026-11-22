package org.tvshell.iptvnator.ui;

import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.webkit.WebViewCompat;
import fi.iki.elonen.NanoHTTPD;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.Scanner;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import junit.framework.TestCase;
import okio.Buffer;
import org.json.JSONObject;

public class HostedAccessUploadTest extends TestCase {
    public void testCancellingUploadWakesPendingNativeWriter() throws Exception {
        CountDownLatch requested = new CountDownLatch(1);
        HostedAccessUpload upload = new HostedAccessUpload(HostedAccessUpload.MAX_BYTES, null, offset -> requested.countDown());
        Buffer sink = new Buffer();
        FutureTask<Boolean> writer = new FutureTask<>(() -> {
            try { upload.writeTo(sink); return false; }
            catch (IOException cancelled) { return true; }
        });
        new Thread(writer).start();
        try {
            assertTrue(requested.await(5, TimeUnit.SECONDS));
        } finally {
            upload.cancel();
        }
        assertTrue(writer.get(5, TimeUnit.SECONDS));
        assertEquals(0L, sink.size());
    }

    public void testWebViewUploadsLargePlaylistAndReplaysItAfterAuthChallenge() throws Exception {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        AtomicInteger writes = new AtomicInteger();
        AtomicReference<byte[]> firstDigest = new AtomicReference<>();
        NanoHTTPD server = new NanoHTTPD("127.0.0.1", 0) {
            @Override public Response serve(IHTTPSession request) {
                try {
                    if ("/token".equals(request.getUri())) {
                        request.parseBody(new HashMap<>());
                        return newFixedLengthResponse(Response.Status.OK, "application/json",
                            "{\"access_token\":\"synthetic-renewed\",\"expires_in\":900}");
                    }
                    if (request.getMethod() != Method.PUT || !"/api/v1/sources/synthetic".equals(request.getUri()))
                        throw new IllegalStateException();
                    int size = Integer.parseInt(request.getHeaders().get("content-length"));
                    if (size <= 16 * 1024 * 1024) throw new IllegalStateException();
                    MessageDigest digest = MessageDigest.getInstance("SHA-256");
                    byte[] buffer = new byte[8192];
                    InputStream in = request.getInputStream();
                    for (int remaining = size; remaining > 0;) {
                        int n = in.read(buffer, 0, Math.min(remaining, buffer.length));
                        if (n < 1) throw new IllegalStateException();
                        digest.update(buffer, 0, n);
                        remaining -= n;
                    }
                    byte[] bytes = digest.digest();
                    if (writes.incrementAndGet() == 1) {
                        firstDigest.set(bytes);
                        Response challenge = newFixedLengthResponse(Response.Status.UNAUTHORIZED, "text/plain", "");
                        challenge.addHeader("WWW-Authenticate", "Bearer resource_metadata=\"synthetic\"");
                        return challenge;
                    }
                    if (!Arrays.equals(firstDigest.get(), bytes)
                        || !"Bearer synthetic-renewed".equals(request.getHeaders().get("authorization")))
                        throw new IllegalStateException();
                    return newFixedLengthResponse(Response.Status.CREATED, "text/plain",
                        android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP));
                } catch (Exception invalid) {
                    return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "Invalid fixture request");
                }
            }
        };
        server.start();
        String origin = "http://127.0.0.1:" + server.getListeningPort();
        String key = HostedAccessSession.storageKey(origin);
        PairedCredentialStore store = new PairedCredentialStore(context);
        MainActivity activity = (MainActivity) instrumentation.startActivitySync(
            new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        AtomicReference<HostedAccessBridge> bridge = new AtomicReference<>();
        AtomicReference<WebView> client = new AtomicReference<>();
        try {
            JSONObject credential = new JSONObject().put("instanceId", "synthetic").put("accessToken", "synthetic-old")
                .put("refreshToken", "synthetic-refresh").put("expiresAt", Long.MAX_VALUE)
                .put("resource", origin).put("clientId", "synthetic-client").put("tokenEndpoint", origin + "/token");
            HostedAccessSession session = new HostedAccessSession(store, origin, credential, store.saveRecord(key, credential));
            String bootstrap;
            try (Scanner scanner = new Scanner(context.getAssets().open("tvshell/hosted-access-api.js"), "UTF-8")) {
                bootstrap = scanner.useDelimiter("\\A").next();
            }
            CompletableFuture<String> result = new CompletableFuture<>();
            instrumentation.runOnMainSync(() -> {
                WebView view = new WebView(activity);
                client.set(view);
                view.getSettings().setJavaScriptEnabled(true);
                bridge.set(new HostedAccessBridge(activity, view, session.uiOrigin, session));
                WebViewCompat.addWebMessageListener(view, "TestResult", Collections.singleton(session.uiOrigin),
                    (v, message, source, main, reply) -> result.complete(message.getData()));
                view.setWebViewClient(new WebViewClient() {
                    @Override public void onPageFinished(WebView v, String url) {
                        v.evaluateJavascript(bootstrap + "\n(async()=>{try {"
                            + "const body = JSON.stringify({id:'synthetic',title:'Example',kind:'m3u-text',rawM3u:'#EXTM3U\\n'+'# test\\n'.repeat(2500000)});"
                            + "const response = await fetch('/api/v1/sources/synthetic',{method:'PUT',body,"
                            + "headers:{'content-type':'application/json','if-none-match':'*'}});"
                            + "const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body));"
                            + "const expected=btoa(String.fromCharCode(...new Uint8Array(hash)));"
                            + "TestResult.postMessage(response.status!==201?'HTTP '+response.status:"
                            + "(await response.text())===expected?'ok':'unexpected digest');"
                            + "}catch(e){TestResult.postMessage(e.name);}})();", null);
                    }
                });
                view.loadDataWithBaseURL(session.uiOrigin + "/", "<p>Synthetic upload</p>", "text/html", "UTF-8", null);
            });
            String observed = result.get(120, TimeUnit.SECONDS);
            assertEquals("Completed HTTP uploads: " + writes.get(), "ok", observed);
            assertEquals(2, writes.get());
        } finally {
            instrumentation.runOnMainSync(() -> {
                if (bridge.get() != null) bridge.get().close();
                if (client.get() != null) client.get().destroy();
                activity.finish();
            });
            store.remove(key);
            server.stop();
        }
    }
}
