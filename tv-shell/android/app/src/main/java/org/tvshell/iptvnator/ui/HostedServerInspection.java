package org.tvshell.iptvnator.ui;

import android.app.AlertDialog;
import android.os.Handler;
import android.os.Looper;
import androidx.webkit.JavaScriptReplyProxy;
import java.io.IOException;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.Response;
import org.json.JSONObject;
import org.tvshell.iptvnator.R;

/** Public metadata for one main document. A hosted page needs consent to contact another origin. */
final class HostedServerInspection {
    private final MainActivity activity;
    private final String hostedCaller;
    private final PairedCredentialStore credentials;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Pending current;

    HostedServerInspection(MainActivity activity, String hostedCaller) {
        this.activity = activity;
        this.hostedCaller = hostedCaller;
        credentials = new PairedCredentialStore(activity);
    }

    void receive(String message, JavaScriptReplyProxy reply) {
        if (message == null || message.length() > 4096) return;
        try {
            JSONObject input = new JSONObject(message);
            String id = input.getString("id");
            if (!id.matches("[0-9]{1,16}")) return;
            String address = input.getString("apiUrl");
            Call call = HostedServerDiscovery.instanceRequest(address);
            // Never replace the destination under a user's finger while confirmation is visible.
            if (call == null || (current != null && current.dialog != null)) {
                send(reply, id, "unknown");
                return;
            }
            cancel();
            Pending request = new Pending(call, id, reply);
            current = request;
            if (hostedCaller != null && !HostedOrigin.sameOrigin(hostedCaller, address)) {
                request.dialog = new AlertDialog.Builder(activity).setTitle(R.string.inspection_title)
                    .setMessage(activity.getString(R.string.inspection_confirm, call.request().url().toString()))
                    .setPositiveButton(R.string.pairing_continue, (dialog, button) -> request.start())
                    .setNegativeButton(android.R.string.cancel, (dialog, button) -> request.finish("unknown"))
                    .setOnCancelListener(dialog -> request.finish("unknown")).show();
                handler.postDelayed(request.expire, 60000);
            } else request.start();
        } catch (org.json.JSONException ignored) { }
    }

    private final class Pending implements Callback {
        final Call call;
        final String id;
        final JavaScriptReplyProxy reply;
        final Runnable expire = () -> finish("unknown");
        AlertDialog dialog;

        Pending(Call call, String id, JavaScriptReplyProxy reply) {
            this.call = call;
            this.id = id;
            this.reply = reply;
        }

        void start() {
            if (current != this) return;
            handler.removeCallbacks(expire);
            dialog = null;
            call.enqueue(this);
        }

        @Override public void onFailure(Call failed, IOException error) {
            activity.runOnUiThread(() -> finish("unknown"));
        }

        @Override public void onResponse(Call invoked, Response response) {
            try (Response closed = response) {
                // A hosted caller sees the same public pairing capability for any other library.
                String kind = HostedServerDiscovery.classify(closed, (origin, instance) ->
                    (hostedCaller == null || hostedCaller.equals(origin)) && credentials.read(origin, instance) != null);
                activity.runOnUiThread(() -> finish(kind));
            } catch (Exception invalid) { activity.runOnUiThread(() -> finish("unknown")); }
        }

        void finish(String kind) {
            if (current != this) return;
            current = null;
            handler.removeCallbacks(expire);
            if (dialog != null) dialog.dismiss();
            call.cancel();
            send(reply, id, kind);
        }
    }

    private static void send(JavaScriptReplyProxy reply, String id, String kind) {
        try { reply.postMessage(new JSONObject().put("id", id).put("kind", kind).toString()); }
        catch (Exception closedDocument) { }
    }

    void cancel() {
        if (current != null) current.finish("unknown");
    }
}
