package org.tvshell.iptvnator.ui;

import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.webkit.WebViewCompat;
import fi.iki.elonen.NanoHTTPD;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Scanner;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import junit.framework.TestCase;
import org.json.JSONObject;

public class HostedAccessReloadTest extends TestCase {
    public void testReloadCancelsPreviousUploadAndStartsANewRequest() throws Exception {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        CountDownLatch kept = new CountDownLatch(1);
        CountDownLatch answer = new CountDownLatch(1);
        CountDownLatch abandoned = new CountDownLatch(1);
        NanoHTTPD server = new NanoHTTPD("127.0.0.1", 0) {
            @Override public Response serve(IHTTPSession request) {
                String path = request.getUri();
                if (path.equals("/api/v1/sources/old")) {
                    try {
                        InputStream body = request.getInputStream();
                        byte[] buffer = new byte[8192];
                        int count = 0, size;
                        while ((size = body.read(buffer)) >= 0) count += size;
                        if (count > 0 && count < 131072) abandoned.countDown();
                    } catch (java.net.SocketException disconnected) {
                        abandoned.countDown();
                    } catch (IOException ignored) {}
                }
                if (path.equals("/api/v1/sources/kept")) {
                    kept.countDown();
                    try { answer.await(30, TimeUnit.SECONDS); }
                    catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                }
                return newFixedLengthResponse(path);
            }
        };
        server.start(60_000, true);
        String origin = "http://127.0.0.1:" + server.getListeningPort();
        String key = HostedAccessSession.storageKey(origin);
        PairedCredentialStore store = new PairedCredentialStore(context);
        JSONObject credential = new JSONObject().put("instanceId", "example").put("accessToken", "synthetic")
            .put("expiresAt", Long.MAX_VALUE);
        HostedAccessSession session = new HostedAccessSession(store, origin, credential, store.saveRecord(key, credential));
        MainActivity activity = (MainActivity) instrumentation.startActivitySync(
            new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        AtomicReference<WebView> client = new AtomicReference<>();
        AtomicReference<HostedAccessBridge> bridge = new AtomicReference<>();
        BlockingQueue<String> events = new LinkedBlockingQueue<>();
        String bootstrap;
        try (Scanner scanner = new Scanner(context.getAssets().open("tvshell/hosted-access-api.js"), "UTF-8")) {
            bootstrap = scanner.useDelimiter("\\A").next();
        }
        try {
            instrumentation.runOnMainSync(() -> {
                WebView view = new WebView(activity);
                client.set(view);
                view.getSettings().setJavaScriptEnabled(true);
                bridge.set(new HostedAccessBridge(activity, view, session.uiOrigin, session));
                WebViewCompat.addDocumentStartJavaScript(view, bootstrap, Collections.singleton(session.uiOrigin));
                WebViewCompat.addWebMessageListener(view, "TestResult", Collections.singleton(session.uiOrigin),
                    (v, msg, source, main, reply) -> events.add(msg.getData()));
                view.setWebViewClient(new WebViewClient() {
                    @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest request) {
                        String script = "<script>"
                            + "function read(name){fetch('/api/v1/sources/'+name).then(r=>r.text())"
                            + ".then(v=>TestResult.postMessage(v));}"
                            + "if(location.hash==='#next'){read('fresh');}else{"
                            + "const handle=HostedAccessApi.onmessage; HostedAccessApi.onmessage=e=>{"
                            + "if(JSON.parse(e.data).uploadOffset===65536){TestResult.postMessage('upload paused');return;}"
                            + "handle(e);};"
                            + "fetch('/api/v1/sources/old',{method:'PUT',body:'x'.repeat(131072)});"
                            + "read('kept');}</script>";
                        return new WebResourceResponse("text/html", "UTF-8",
                            new ByteArrayInputStream(script.getBytes(StandardCharsets.UTF_8)));
                    }
                });
                view.loadUrl(session.uiOrigin + "/");
            });
            assertEquals("upload paused", events.poll(20, TimeUnit.SECONDS));
            assertTrue("Sibling request did not reach the server", kept.await(10, TimeUnit.SECONDS));
            instrumentation.runOnMainSync(() -> client.get().evaluateJavascript(
                "history.pushState({}, '', '#next')", result -> answer.countDown()));
            assertEquals("/api/v1/sources/kept", events.poll(10, TimeUnit.SECONDS));
            instrumentation.runOnMainSync(() -> client.get().reload());
            assertEquals("First request in reloaded document", "/api/v1/sources/fresh", events.poll(12, TimeUnit.SECONDS));
            assertTrue("Previous upload connection was not closed", abandoned.await(10, TimeUnit.SECONDS));
        } finally {
            answer.countDown();
            instrumentation.runOnMainSync(() -> {
                if (bridge.get() != null) bridge.get().close();
                if (client.get() != null) client.get().destroy();
                activity.finish();
            });
            server.stop();
            store.remove(key);
        }
    }
}
