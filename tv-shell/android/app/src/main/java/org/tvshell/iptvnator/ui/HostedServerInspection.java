package org.tvshell.iptvnator.ui;

import androidx.webkit.JavaScriptReplyProxy;
import java.io.IOException;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.Response;
import org.json.JSONObject;

/** Replies only to the embedded document that requested the metadata. */
final class HostedServerInspection {
    private final MainActivity activity;
    private final PairedCredentialStore credentials;
    private Call current;

    HostedServerInspection(MainActivity activity) {
        this.activity = activity;
        credentials = new PairedCredentialStore(activity);
    }

    void receive(String message, JavaScriptReplyProxy reply) {
        if (message == null || message.length() > 4096) return;
        try {
            JSONObject input = new JSONObject(message);
            String id = input.getString("id");
            if (!id.matches("[0-9]{1,16}")) return;
            cancel();
            Call call = HostedServerDiscovery.instanceRequest(input.getString("apiUrl"));
            if (call == null) {
                send(reply, id, "unknown");
                return;
            }
            current = call;
            call.enqueue(new Callback() {
                @Override public void onFailure(Call failed, IOException error) { complete("unknown"); }
                @Override public void onResponse(Call invoked, Response response) {
                    try (Response closed = response) { complete(HostedServerDiscovery.classify(closed, (origin, instance) -> credentials.read(origin, instance) != null)); }
                    catch (Exception invalid) { complete("unknown"); }
                }
                private void complete(String kind) {
                    activity.runOnUiThread(() -> {
                        if (current != call) return;
                        current = null;
                        send(reply, id, kind);
                    });
                }
            });
        } catch (org.json.JSONException ignored) { }
    }

    private static void send(JavaScriptReplyProxy reply, String id, String kind) {
        try { reply.postMessage(new JSONObject().put("id", id).put("kind", kind).toString()); }
        catch (Exception closedDocument) { }
    }

    void cancel() {
        if (current != null) current.cancel();
        current = null;
    }
}
