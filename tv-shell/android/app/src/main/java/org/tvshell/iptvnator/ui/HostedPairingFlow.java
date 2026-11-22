package org.tvshell.iptvnator.ui;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Typeface;
import android.os.Handler;
import android.os.Looper;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.RelativeSizeSpan;
import android.text.style.StyleSpan;
import android.text.style.TypefaceSpan;
import android.widget.Toast;
import android.widget.LinearLayout;
import android.widget.ImageView;
import android.widget.TextView;
import android.graphics.Bitmap;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.common.BitMatrix;
import java.lang.ref.WeakReference;
import org.json.JSONObject;
import org.tvshell.iptvnator.Prefs;
import org.tvshell.iptvnator.R;

/** One foreground handoff. Leaving/cancelling never changes the selected library. */
final class HostedPairingFlow {
    interface AccessSignIn {
        void cancel();
        default void detach() { cancel(); }
    }

    // MainActivity owns sign-in, but TV Settings and external invitation links can supersede it.
    private static WeakReference<AccessSignIn> pendingAccess = new WeakReference<>(null);

    static void registerAccessSignIn(AccessSignIn signIn) {
        AccessSignIn previous = pendingAccess.get();
        if (previous != null) previous.detach();
        pendingAccess = new WeakReference<>(signIn);
    }

    static void cancelAccessSignIn(Activity activity) {
        new PairedCredentialStore(activity).remove(HostedAccessOAuth.PENDING_KEY);
        AccessSignIn signIn = pendingAccess.get();
        if (signIn != null) signIn.detach();
    }

    private final Activity activity;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final PairingAttempts attempts = new PairingAttempts();
    private AlertDialog dialog;
    private LinearLayout startContent;
    private long deadline;

    HostedPairingFlow(Activity activity) { this.activity = activity; }

    void open(Intent intent) {
        if (!Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() == null) return;
        final PairingLink link;
        try { link = PairingLink.parse(intent.getData().toString()); }
        catch (IllegalArgumentException e) {
            Toast.makeText(activity, R.string.pairing_invalid, Toast.LENGTH_LONG).show();
            return;
        }
        confirmInvite(link);
    }

    void confirmInvite(PairingLink link) {
        cancelAccessSignIn(activity);
        cancel();
        final long attempt = attempts.begin();
        // No network operation occurs until this explicit, origin-displaying confirmation.
        dialog = new AlertDialog.Builder(activity).setTitle(R.string.pairing_title)
            .setMessage(activity.getString(R.string.pairing_confirm, link.origin)
                + (link.origin.startsWith("http:") ? activity.getString(R.string.pairing_http) : ""))
            .setPositiveButton(R.string.pairing_continue, null)
            .setNegativeButton(R.string.external_prompt_cancel, (d, which) -> cancel())
            .setOnCancelListener(d -> cancel()).show();
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> claim(link, attempt));
    }

    void start(String address, String trustedApprovalOrigin) {
        start(address, trustedApprovalOrigin, null, false);
    }

    void start(String address, String trustedApprovalOrigin, Runnable onConfirm, boolean reconnectPaired) {
        final String origin;
        try { origin = HostedOrigin.normalize(address); }
        catch (IllegalArgumentException e) {
            Toast.makeText(activity, R.string.connection_invalid, Toast.LENGTH_LONG).show(); return;
        }
        cancelAccessSignIn(activity);
        cancel();
        final long attempt = attempts.begin();
        startContent = new LinearLayout(activity);
        startContent.setOrientation(LinearLayout.VERTICAL);
        int padding = (int) (24 * activity.getResources().getDisplayMetrics().density);
        startContent.setPadding(padding, padding / 2, padding, 0);
        TextView message = new TextView(activity);
        startContent.addView(message);
        AlertDialog.Builder builder = new AlertDialog.Builder(activity)
            .setTitle(R.string.pairing_title).setView(startContent)
            .setNegativeButton(R.string.external_prompt_cancel, (d, w) -> cancel())
            .setOnCancelListener(d -> cancel());
        if (onConfirm == null) {
            dialog = builder.show();
            startClaim(origin, trustedApprovalOrigin, attempt, message, reconnectPaired);
            return;
        }
        String approval = trustedApprovalOrigin.isEmpty() ? "" : "\n\n"
            + activity.getString(R.string.pairing_approval_host, trustedApprovalOrigin);
        message.setText(activity.getString(R.string.connection_confirm_address, origin)
            + approval + (origin.startsWith("http:") ? activity.getString(R.string.pairing_http) : ""));
        dialog = builder.setPositiveButton(R.string.pairing_continue, null).show();
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            if (!active(attempt)) return;
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setVisibility(android.view.View.GONE);
            onConfirm.run();
            startClaim(origin, trustedApprovalOrigin, attempt, message, reconnectPaired);
        });
    }

    private void startClaim(String origin, String trustedApprovalOrigin, long attempt, TextView message, boolean reconnectPaired) {
        message.setText(R.string.connection_checking);
        deadline = android.os.SystemClock.elapsedRealtime() + 5 * 60 * 1000;
        new Thread(() -> {
            try {
                PairingClient client = new PairingClient(origin);
                String instance = client.instance();
                if (!active(attempt)) return;
                if (reconnectPaired && new PairedCredentialStore(activity).read(origin, instance) != null) {
                    activity.runOnUiThread(() -> {
                        if (active(attempt)) selectLibrary(origin);
                    });
                    return;
                }
                JSONObject claim = client.start();
                String url = claim.optString("approvalUrl", "");
                String remoteOrigin = PairingLink.approvalOrigin(url, claim.optString("claimId"), origin);
                boolean recognizedApproval = remoteOrigin != null;
                if (remoteOrigin != null && remoteOrigin.startsWith("http://")
                    && PairingLink.approvalClaim(url, origin) == null) remoteOrigin = null;
                // A configured HTTPS origin may differ from a LAN API origin. Probe it
                // without credentials and require the same server instance before displaying it.
                if (remoteOrigin != null && !remoteOrigin.equals(origin)) {
                    try { if (!instance.equals(new PairingClient(remoteOrigin).instance())) remoteOrigin = null; }
                    catch (Exception e) {
                        // Access is allowed only for the HTTPS origin the owner explicitly entered.
                        try {
                            if (!remoteOrigin.equals(trustedApprovalOrigin) || !PairingTransport.isAccessProtected(remoteOrigin, trustedApprovalOrigin)) remoteOrigin = null;
                        } catch (Exception ignored) { remoteOrigin = null; }
                    }
                }
                String lanUrl = origin + "/approve-device/" + claim.optString("claimId");
                final String safeUrl = remoteOrigin != null ? url
                    : recognizedApproval && PairingLink.approvalClaim(lanUrl, origin) != null ? lanUrl : null;
                activity.runOnUiThread(() -> {
                    if (!active(attempt)) return;
                    showStartClaim(origin, claim, safeUrl);
                    poll(origin, client, instance, claim, attempt, true);
                });
            } catch (Exception e) { activity.runOnUiThread(() -> fail(attempt, true)); }
        }, "hosted-device-start").start();
    }

    private void showStartClaim(String origin, JSONObject claim, String url) {
        startContent.removeAllViews();
        TextView text = new TextView(activity);
        String code = claim.optString("confirmationCode");
        String instructions = activity.getString(url == null ? R.string.pairing_tv_fallback : R.string.pairing_tv_scan, code, origin);
        String approvalHost = url == null ? "" : "\n\n" + activity.getString(R.string.pairing_approval_host,
            PairingLink.approvalOrigin(url, claim.optString("claimId"), origin));
        text.setText(emphasizeCode(instructions + approvalHost, code));
        startContent.addView(text);
        if (url != null && !addQr(activity, startContent, url))
            text.setText(emphasizeCode(activity.getString(R.string.pairing_tv_fallback, code, origin), code));
    }

    static boolean addQr(Activity activity, LinearLayout content, String url) {
        try {
            BitMatrix matrix = new QRCodeWriter().encode(url, BarcodeFormat.QR_CODE, 512, 512);
            Bitmap bitmap = Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888);
            for (int y = 0; y < 512; y++) for (int x = 0; x < 512; x++)
                bitmap.setPixel(x, y, matrix.get(x, y) ? 0xff000000 : 0xffffffff);
            ImageView qr = new ImageView(activity);
            qr.setImageBitmap(bitmap);
            int size = (int) (220 * activity.getResources().getDisplayMetrics().density);
            content.addView(qr, new LinearLayout.LayoutParams(size, size));
            return true;
        } catch (Exception ignored) { return false; }
    }

    private boolean active(long attempt) { return attempts.active(attempt) && !activity.isFinishing() && !activity.isDestroyed(); }

    private void claim(PairingLink link, long attempt) {
        if (!active(attempt)) return;
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setVisibility(android.view.View.GONE);
        dialog.setMessage(activity.getString(R.string.connection_checking));
        deadline = android.os.SystemClock.elapsedRealtime() + 5 * 60 * 1000;
        new Thread(() -> {
            try {
                PairingClient client = new PairingClient(link.origin);
                String instance = client.instance();
                if (!active(attempt)) return;
                JSONObject claim = client.claim(link.inviteId);
                activity.runOnUiThread(() -> {
                    if (!active(attempt)) return;
                    String code = claim.optString("confirmationCode");
                    dialog.setMessage(emphasizeCode(activity.getString(R.string.pairing_code, code, link.origin), code));
                    poll(link.origin, client, instance, claim, attempt, false);
                });
            } catch (Exception e) { activity.runOnUiThread(() -> fail(attempt, false)); }
        }, "hosted-device-claim").start();
    }

    private void poll(String origin, PairingClient client, String instance, JSONObject claim, long attempt, boolean tv) {
        if (!active(attempt)) return;
        if (android.os.SystemClock.elapsedRealtime() >= deadline) { fail(attempt, tv); return; }
        new Thread(() -> {
            try {
                JSONObject response = client.complete(claim);
                String status = response.optString("status");
                if ("pending".equals(status)) {
                    activity.runOnUiThread(() -> {
                        if (active(attempt)) handler.postDelayed(() -> poll(origin, client, instance, claim, attempt, tv), 2000);
                    });
                    return;
                }
                if (!"approved".equals(status) || !instance.equals(response.optString("instanceId"))
                    || !PairingLink.opaqueId(response.optString("token"))) throw new IllegalArgumentException();
                activity.runOnUiThread(() -> approve(origin, instance, response.optString("token"), attempt, tv));
            } catch (Exception e) { activity.runOnUiThread(() -> fail(attempt, tv)); }
        }, "hosted-device-complete").start();
    }

    static CharSequence emphasizeCode(String message, String code) {
        if (!code.matches("[0-9]{6}")) return message;
        int start = message.indexOf(code);
        if (start < 0) return message;
        int end = start + code.length();
        SpannableString content = new SpannableString(message);
        content.setSpan(new StyleSpan(Typeface.BOLD), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        content.setSpan(new TypefaceSpan("monospace"), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        content.setSpan(new RelativeSizeSpan(1.5f), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return content;
    }

    private void approve(String origin, String instance, String token, long attempt, boolean tv) {
        if (!active(attempt)) return;
        try { new PairedCredentialStore(activity).saveOrdinaryPairing(origin, instance, token); }
        catch (Exception e) { fail(attempt, tv); return; }
        Toast.makeText(activity, R.string.pairing_success, Toast.LENGTH_LONG).show();
        selectLibrary(origin);
    }

    private void selectLibrary(String origin) {
        new Prefs(activity).setHostedOrigin(origin);
        cancel();
        if (activity instanceof MainActivity) {
            ((MainActivity) activity).reloadPairedLibrary();
        } else {
            SettingsActivity.connectionPaired = true;
            activity.startActivity(new Intent(activity, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP));
            activity.finish();
        }
    }

    private void fail(long attempt, boolean tv) {
        if (!active(attempt)) return;
        cancel();
        dialog = new AlertDialog.Builder(activity).setTitle(R.string.pairing_title)
            .setMessage(tv ? R.string.pairing_tv_failed : R.string.pairing_failed).setPositiveButton(android.R.string.ok, null).show();
    }

    void cancel() {
        attempts.cancel();
        handler.removeCallbacksAndMessages(null);
        startContent = null;
        if (dialog != null) {
            dialog.dismiss();
            dialog = null;
        }
    }
}
