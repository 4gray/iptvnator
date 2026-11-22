package org.tvshell.iptvnator.ui;

import android.util.Base64;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import android.webkit.WebView;
import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.MediaType;
import okhttp3.Response;
import org.json.JSONObject;

final class HostedAccessBridge {
    private static final int CHUNK_BYTES = 64 * 1024;
    private static final long MAX_RESPONSE_BYTES = 64L * 1024 * 1024;
    private final MainActivity activity;
    private final HostedAccessSession session;
    private final ExecutorService network = Executors.newFixedThreadPool(4);
    private final ConcurrentHashMap<String, Task> pending = new ConcurrentHashMap<>();

    HostedAccessBridge(MainActivity activity, WebView webView, String uiOrigin, HostedAccessSession session) {
        this.activity = activity;
        this.session = session;
        WebViewCompat.addWebMessageListener(webView, "HostedAccessApi", Collections.singleton(uiOrigin),
            (view, message, source, mainFrame, reply) -> {
                if (!mainFrame || !HostedOrigin.sameOrigin(uiOrigin, source.toString())
                    || message.getType() != WebMessageCompat.TYPE_STRING) return;
                receive(message.getData(), reply);
            });
    }

    private void receive(String data, JavaScriptReplyProxy reply) {
        if (network.isShutdown() || data == null || data.length() > 128 * 1024) return;
        try {
            JSONObject input = new JSONObject(data);
            String id = input.getString("id");
            if (!id.matches("[0-9]{1,16}")) return;
            if (input.has("uploadOffset")) {
                Task task = pending.get(id);
                if (task != null && task.upload != null)
                    task.upload.accept(input.getInt("uploadOffset"), input.getString("chunk"));
                return;
            }
            if (input.optBoolean("cancel")) {
                Task task = pending.remove(id);
                if (task != null) task.cancel();
                return;
            }
            if (input.optBoolean("read")) {
                Task task = pending.get(id);
                if (task != null) task.requestChunk();
                return;
            }
            if (pending.size() >= 32) {
                reply.postMessage(new JSONObject().put("id", id).put("error", true).toString());
                return;
            }
            Task task = new Task();
            if (pending.putIfAbsent(id, task) == null) network.execute(() -> execute(id, input, task, reply));
        } catch (Exception ignored) {
            // Messages contain provider requests. Keep them out of diagnostics.
        }
    }

    private void execute(String id, JSONObject input, Task task, JavaScriptReplyProxy reply) {
        try {
            JSONObject headers = input.optJSONObject("headers");
            String type = headers == null ? "application/json" : headers.optString("content-type", "application/json");
            task.upload = new HostedAccessUpload(input.getLong("bodySize"), MediaType.get(type),
                offset -> send(id, task, reply, new JSONObject(Collections.singletonMap("uploadOffset", offset)), false));
            try (Response response = open(input, task)) {
                JSONObject result = HostedAccessSession.responseHeaders(response);
                int status = response.code();
                if (status == 403) {
                    String deviceStatus = response.header("X-IPTVnator-Device-Status", "");
                    if ("revoked".equals(deviceStatus) || "registration_required".equals(deviceStatus))
                        activity.runOnUiThread(() -> activity.reportAccessDeviceStatus(session, deviceStatus));
                }
                if (response.body() == null || status == 204 || status == 205 || status == 304
                        || "HEAD".equals(input.getString("method"))) {
                    send(id, task, reply, result, true);
                    return;
                }
                send(id, task, reply, result.put("stream", true), false);
                InputStream body = response.body().byteStream();
                byte[] buffer = new byte[CHUNK_BYTES];
                long total = 0;
                while (task.awaitChunk()) {
                    int size = body.read(buffer);
                    if (size < 0) {
                        send(id, task, reply, new JSONObject().put("done", true), true);
                        return;
                    }
                    total += size;
                    if (total > MAX_RESPONSE_BYTES) throw new IOException("Hosted response is too large");
                    send(id, task, reply, new JSONObject()
                        .put("chunk", Base64.encodeToString(buffer, 0, size, Base64.NO_WRAP)), false);
                }
            }
        } catch (HostedAccessOAuth.Denied denied) {
            send(id, task, reply, error("reauth"), true);
        } catch (Exception failure) {
            send(id, task, reply, error("error"), true);
        }
    }

    private void send(String id, Task task, JavaScriptReplyProxy reply, JSONObject result, boolean done) {
        activity.runOnUiThread(() -> {
            if (network.isShutdown() || (done ? !pending.remove(id, task) : pending.get(id) != task)) return;
            try {
                reply.postMessage(result.put("id", id).toString());
                if (result.optBoolean("reauth")) activity.offerAccessSignIn(session.origin, session.instance);
            } catch (Exception failure) {
                pending.remove(id, task);
                task.cancel();
            }
        });
    }

    private Response open(JSONObject input, Task task) throws Exception {
        String token = session.accessToken(null);
        Response response = request(input, task, token);
        // Refresh only on the edge's challenge. The request has not reached the origin.
        if (edgeChallenge(response)) {
            response.close();
            response = request(input, task, session.accessToken(token));
        }
        if (edgeChallenge(response) || loginRedirect(response)) {
            response.close();
            throw new HostedAccessOAuth.Denied();
        }
        if (response.isRedirect()) {
            response.close();
            throw new IOException("Unexpected redirect");
        }
        return response;
    }

    private static boolean edgeChallenge(Response response) {
        return response.code() == 401 && response.header("WWW-Authenticate", "").contains("resource_metadata=");
    }

    private boolean loginRedirect(Response response) {
        return HostedAccessRedirect.isLogin(session.origin, response.code(), response.header("Location"));
    }

    private Response request(JSONObject input, Task task, String token) throws Exception {
        Call call = session.call(input, token, task.upload);
        task.attach(call);
        return call.execute();
    }

    private static JSONObject error(String key) {
        try { return new JSONObject().put(key, true); }
        catch (org.json.JSONException impossible) { throw new IllegalStateException(impossible); }
    }

    void close() {
        for (Task task : pending.values()) task.cancel();
        pending.clear();
        network.shutdownNow();
    }

    private static final class Task {
        private final Semaphore demand = new Semaphore(0);
        private Call call;
        private volatile HostedAccessUpload upload;
        private volatile boolean cancelled;
        void requestChunk() {
            if (demand.availablePermits() == 0) demand.release();
        }
        boolean awaitChunk() throws InterruptedException, IOException {
            if (!demand.tryAcquire(45, TimeUnit.SECONDS)) throw new IOException("Hosted response read timed out");
            return !cancelled;
        }
        synchronized void attach(Call value) {
            call = value;
            if (cancelled) call.cancel();
        }
        synchronized void cancel() {
            cancelled = true;
            if (call != null) call.cancel();
            if (upload != null) upload.cancel();
            requestChunk();
        }
    }
}
