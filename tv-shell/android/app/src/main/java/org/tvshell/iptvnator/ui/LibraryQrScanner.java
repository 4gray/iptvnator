package org.tvshell.iptvnator.ui;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.widget.Toast;

import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;

import org.json.JSONObject;
import org.tvshell.iptvnator.Prefs;
import org.tvshell.iptvnator.R;

/** Handles both registration invitations and approval codes from the phone camera. */
final class LibraryQrScanner {
    private final Activity activity;
    private final Prefs prefs;
    private final HostedPairingFlow pairing;
    private final PairingAttempts scanAttempts = new PairingAttempts();
    private AlertDialog scanDialog;
    private boolean scanning;

    LibraryQrScanner(Activity activity, Prefs prefs, HostedPairingFlow pairing) {
        this.activity = activity;
        this.prefs = prefs;
        this.pairing = pairing;
    }

    static boolean available(Activity activity) {
        return !Prefs.isTvDevice(activity)
            && activity.getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY);
    }

    void open() {
        if (scanning || !available(activity)) return;
        cancel();
        pairing.cancel();
        scanning = true;
        try {
            new IntentIntegrator(activity).setCaptureActivity(LibraryQrActivity.class)
                .setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
                .setPrompt(activity.getString(R.string.scan_qr_prompt)).setBeepEnabled(false)
                .setOrientationLocked(false).initiateScan();
        } catch (ActivityNotFoundException | SecurityException e) {
            scanning = false;
            scanMessage(R.string.scan_qr_unavailable);
        }
    }

    boolean onActivityResult(int requestCode, int resultCode, Intent data) {
        IntentResult scan = IntentIntegrator.parseActivityResult(requestCode, resultCode, data);
        if (scan == null) return false;
        scanning = false;
        String contents = scan.getContents();
        if (contents == null) return true;
        PairingLink invite = PairingLink.scannedInvite(contents);
        if (invite != null) {
            pairing.confirmInvite(invite);
            return true;
        }
        if (activity instanceof MainActivity && ((MainActivity) activity).connectScannedLibrary(contents)) return true;
        if (activity instanceof SettingsActivity && MainActivity.openScannedCloudflareLibrary(activity, contents)) return true;
        if (!PairingLink.isApprovalCode(contents)) { scanMessage(R.string.scan_qr_invalid); return true; }
        String origin = prefs.hostedOrigin();
        PairedCredentialStore credentials = new PairedCredentialStore(activity);
        if (origin.isEmpty() || !credentials.contains(origin)) { scanMessage(R.string.scan_tv_unpaired); return true; }
        String claim = PairingLink.approvalClaim(contents, origin);
        if (claim == null) { scanMessage(R.string.scan_tv_invalid); return true; }
        final long attempt = scanAttempts.begin();
        new Thread(() -> {
            try {
                String instance = new PairingClient(origin).instance();
                String token = credentials.read(origin, instance);
                if (token == null) { activity.runOnUiThread(() -> scanMessage(attempt, origin, R.string.scan_tv_unpaired)); return; }
                if (!scanActive(attempt, origin)) return;
                String body = new JSONObject().put("claimId", claim).toString();
                JSONObject details = new JSONObject(PairingTransport.request(origin, "/api/v1/device-pairing/device-request", body, token));
                String name = details.optString("name", "");
                String code = details.optString("confirmationCode", "");
                if (name.isEmpty() || name.length() > 200 || !code.matches("[0-9]{6}")) throw new IllegalArgumentException();
                activity.runOnUiThread(() -> {
                    if (!scanActive(attempt, origin)) return;
                    scanDialog = new AlertDialog.Builder(activity).setTitle(R.string.scan_tv_approve)
                        .setMessage(HostedPairingFlow.emphasizeCode(activity.getString(R.string.scan_tv_compare, name, code), code))
                        .setPositiveButton(R.string.scan_tv_approve, (d, w) -> approveTv(attempt, origin, instance, claim))
                        .setNegativeButton(R.string.external_prompt_cancel, null).show();
                });
            } catch (Exception e) { activity.runOnUiThread(() -> scanMessage(attempt, origin, scanError(e))); }
        }, "tv-approval-details").start();
        return true;
    }

    private void approveTv(long attempt, String origin, String instance, String claim) {
        new Thread(() -> {
            try {
                if (!scanActive(attempt, origin) || !instance.equals(new PairingClient(origin).instance())) return;
                String token = new PairedCredentialStore(activity).read(origin, instance);
                if (token == null || !scanActive(attempt, origin)) return;
                String body = new JSONObject().put("claimId", claim).toString();
                PairingTransport.request(origin, "/api/v1/device-pairing/device-approve", body, token);
                activity.runOnUiThread(() -> scanMessage(attempt, origin, R.string.scan_tv_success));
            } catch (Exception e) { activity.runOnUiThread(() -> scanMessage(attempt, origin, scanError(e))); }
        }, "tv-approval").start();
    }

    private void scanMessage(int message) {
        if (!activity.isFinishing() && !activity.isDestroyed()) Toast.makeText(activity, message, Toast.LENGTH_LONG).show();
    }

    private boolean scanActive(long attempt, String origin) {
        return scanAttempts.active(attempt) && origin.equals(prefs.hostedOrigin()) && !activity.isFinishing() && !activity.isDestroyed();
    }

    private void scanMessage(long attempt, String origin, int message) {
        if (scanActive(attempt, origin)) scanMessage(message);
    }

    private int scanError(Exception e) {
        if (e instanceof PairingTransport.StatusException) {
            int status = ((PairingTransport.StatusException) e).status;
            if (status == 403) return R.string.scan_tv_forbidden;
            if (status == 404) return R.string.scan_tv_stale;
        }
        return R.string.scan_tv_failed;
    }

    void cancel() {
        scanAttempts.cancel();
        if (scanDialog != null) { scanDialog.dismiss(); scanDialog = null; }
    }

}
