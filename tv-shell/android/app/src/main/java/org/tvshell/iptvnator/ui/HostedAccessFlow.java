package org.tvshell.iptvnator.ui;

import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsService;
import androidx.browser.auth.AuthTabIntent;
import org.json.JSONObject;
import org.tvshell.iptvnator.R;
import java.util.function.BooleanSupplier;

final class HostedAccessFlow implements HostedPairingFlow.AccessSignIn {
    private final MainActivity activity;
    private ActivityResultLauncher<Intent> launcher;
    private final PairedCredentialStore store;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final PairingAttempts attempts = new PairingAttempts();
    private HostedAccessOAuth active;
    private AlertDialog prompt;
    private boolean creatingInvite;

    HostedAccessFlow(MainActivity activity) {
        this.activity = activity;
        store = new PairedCredentialStore(activity);
        HostedPairingFlow.registerAccessSignIn(this);
        HostedAccessOAuth pending = HostedAccessOAuth.restorePending(store);
        if (pending != null) awaitCallback(pending);
    }

    private void awaitCallback(HostedAccessOAuth oauth) {
        active = oauth;
        handler.postDelayed(this::cancel, oauth.remainingMillis());
        ActivityResultLauncher<Intent> registered = activity.getActivityResultRegistry().register(oauth.launcherKey(),
            new ActivityResultContracts.StartActivityForResult(), result -> {
                if (active != oauth) return;
                if (result.getResultCode() == AuthTabIntent.RESULT_OK) {
                    if (result.getData() != null) callback(result.getData().getData());
                } else {
                    try { oauth.awaitFallbackLink(store); }
                    catch (Exception failure) { retry(oauth, R.string.access_cancelled); return; }
                    handler.postDelayed(() -> {
                        if (active == oauth) retry(oauth, R.string.access_cancelled);
                    }, oauth.remainingMillis());
                }
            });
        // Registration can immediately deliver a result saved by Android.
        if (active == oauth) launcher = registered;
        else registered.unregister();
    }

    void offer(String origin, String instance) {
        offer(origin, instance, "");
    }

    void offer(String origin, String instance, String invite) {
        if (prompt != null || active != null || activity.isFinishing() || activity.isDestroyed()) return;
        prompt = new AlertDialog.Builder(activity).setTitle(R.string.access_sign_in)
            .setMessage(activity.getString(R.string.connection_confirm_address, origin))
            .setPositiveButton(R.string.access_sign_in, (dialog, button) -> begin(origin, instance, invite))
            .setNegativeButton(R.string.external_prompt_cancel, null)
            .setOnDismissListener(this::promptDismissed).show();
    }

    private void begin(String origin, String instance, String invite) {
        long attempt = attempts.begin();
        new Thread(() -> {
            try {
                HostedAccessOAuth oauth = new HostedAccessOAuth(origin, instance, invite);
                activity.runOnUiThread(() -> {
                    if (!valid(attempt)) return;
                    try { oauth.savePending(store); }
                    catch (Exception storageFailure) {
                        failed(origin, instance, invite, R.string.access_library_save_failed);
                        return;
                    }
                    try {
                        awaitCallback(oauth);
                        // Keep any previously installed web player out of the sign-in tab.
                        AuthTabIntent tab = new AuthTabIntent.Builder()
                            .setEphemeralBrowsingEnabled(true).build();
                        String browser = authTabBrowser(oauth.authorization);
                        if (browser != null) tab.intent.setPackage(browser);
                        tab.launch(launcher, oauth.authorization, HostedAccessOAuth.SCHEME);
                    }
                    catch (RuntimeException failure) { retry(oauth, R.string.connection_no_browser); }
                });
            } catch (Exception failure) {
                int message = failureMessage(failure);
                activity.runOnUiThread(() -> {
                    if (valid(attempt)) failed(origin, instance, invite, message);
                });
            }
        }, "hosted-access-discovery").start();
    }

    private String authTabBrowser(Uri authorization) {
        android.content.pm.PackageManager packages = activity.getPackageManager();
        ResolveInfo preferred = packages.resolveActivity(
            new Intent(Intent.ACTION_VIEW, authorization), android.content.pm.PackageManager.MATCH_DEFAULT_ONLY);
        if (preferred != null && preferred.activityInfo != null &&
            CustomTabsClient.isAuthTabSupported(activity, preferred.activityInfo.packageName)) {
            return preferred.activityInfo.packageName;
        }
        for (ResolveInfo browser : packages.queryIntentServices(
                new Intent(CustomTabsService.ACTION_CUSTOM_TABS_CONNECTION), 0)) {
            if (browser.serviceInfo != null &&
                CustomTabsClient.isAuthTabSupported(activity, browser.serviceInfo.packageName)) {
                return browser.serviceInfo.packageName;
            }
        }
        return null;
    }

    void callback(Uri uri) {
        HostedAccessOAuth oauth = active;
        if (oauth == null || !oauth.matches(uri)) return;
        boolean current = oauth.discardPending(store);
        stopWaiting();
        if (!current || oauth.remainingMillis() == 0) return;
        long attempt = attempts.begin();
        new Thread(() -> {
            try {
                JSONObject credential = oauth.finish(uri, store);
                connectRegistered(oauth, store, credential, attempt);
            } catch (Exception failure) {
                int message = failureMessage(failure);
                activity.runOnUiThread(() -> {
                    if (valid(attempt)) failed(oauth.origin, oauth.instance, oauth.invite, message);
                });
            }
        }, "hosted-access-exchange").start();
    }

    private void connectRegistered(HostedAccessOAuth oauth, PairedCredentialStore store,
                                   JSONObject credential, long attempt) {
        try {
            oauth.verifyLibrary(credential);
        } catch (Exception failure) {
            activity.runOnUiThread(() -> {
                if (!valid(attempt)) return;
                if (failure instanceof HostedAccessOAuth.Denied || failure instanceof HostedAccessOAuth.RevokedDevice
                    || failure instanceof HostedAccessOAuth.NeedsInvite || failure instanceof HostedAccessOAuth.WrongLibrary) {
                    failed(oauth.origin, oauth.instance, oauth.invite, failureMessage(failure));
                    return;
                }
                String message = failure instanceof HostedAccessOAuth.LibraryFailed
                    ? activity.getString(R.string.access_library_http_failed, ((HostedAccessOAuth.LibraryFailed) failure).status)
                    : activity.getString(R.string.access_library_unavailable);
                prompt = new AlertDialog.Builder(activity).setTitle(R.string.access_library_title)
                    .setMessage(message)
                    .setPositiveButton(R.string.retry, (dialog, button) -> {
                        long retry = attempts.begin();
                        new Thread(() -> connectRegistered(oauth, store, credential, retry),
                            "hosted-access-library").start();
                    })
                    .setNegativeButton(R.string.external_prompt_cancel, null)
                    .setOnDismissListener(this::promptDismissed).show();
            });
            return;
        }
        activity.runOnUiThread(() -> {
            if (!valid(attempt)) return;
            try {
                store.saveRecord(HostedAccessSession.storageKey(oauth.origin), credential);
                activity.useAccessLibrary(oauth.origin);
            } catch (Exception failure) {
                showDeviceError(R.string.access_library_save_failed);
            }
        });
    }

    private static int failureMessage(Exception failure) {
        if (failure instanceof HostedAccessOAuth.RevokedDevice) return R.string.access_device_revoked;
        if (failure instanceof HostedAccessOAuth.NeedsInvite) return R.string.access_device_needs_invite;
        if (failure instanceof HostedAccessOAuth.Denied) return R.string.access_denied;
        if (failure instanceof HostedAccessOAuth.Unavailable) return R.string.access_tunnel_unavailable;
        if (failure instanceof HostedAccessOAuth.WrongLibrary) return R.string.access_wrong_library;
        return R.string.connection_failed;
    }

    private void retry(HostedAccessOAuth oauth, int message) {
        boolean current = oauth.discardPending(store);
        stopWaiting();
        if (current) failed(oauth.origin, oauth.instance, oauth.invite, message);
    }

    void deviceRegistrationRequired() {
        if (prompt != null || active != null || activity.isFinishing() || activity.isDestroyed()) return;
        showDeviceError(R.string.access_device_needs_invite);
    }

    void inviteDevice(HostedAccessSession session, BooleanSupplier stillConnected) {
        if (creatingInvite || prompt != null || active != null) return;
        creatingInvite = true;
        new Thread(() -> {
            try {
                String url = session.createDeviceInvite();
                activity.runOnUiThread(() -> {
                    creatingInvite = false;
                    if (!stillConnected.getAsBoolean()) return;
                    LinearLayout content = new LinearLayout(activity);
                    content.setOrientation(LinearLayout.VERTICAL);
                    int padding = (int) (24 * activity.getResources().getDisplayMetrics().density);
                    content.setPadding(padding, padding / 2, padding, 0);
                    TextView instructions = new TextView(activity);
                    instructions.setText(R.string.access_invite_help);
                    content.addView(instructions);
                    if (!HostedPairingFlow.addQr(activity, content, url)) {
                        activity.toast(activity.getString(R.string.access_invite_failed));
                        return;
                    }
                    prompt = new AlertDialog.Builder(activity).setTitle(R.string.access_invite_title)
                        .setView(content).setPositiveButton(android.R.string.ok, null)
                        .setOnDismissListener(this::promptDismissed).show();
                });
            } catch (Exception failure) {
                activity.runOnUiThread(() -> {
                    creatingInvite = false;
                    if (!stillConnected.getAsBoolean()) return;
                    if (failure instanceof HostedAccessOAuth.Denied) offer(session.origin, session.instance);
                    else activity.toast(activity.getString(failure instanceof PairingTransport.StatusException
                        ? R.string.access_invite_forbidden : R.string.access_invite_failed));
                });
            }
        }, "hosted-access-invite").start();
    }

    private void showDeviceError(int message) {
        prompt = new AlertDialog.Builder(activity).setTitle(R.string.access_sign_in)
            .setMessage(message).setPositiveButton(android.R.string.ok, null)
            .setOnDismissListener(this::promptDismissed).show();
    }

    private void failed(String origin, String instance, String invite, int message) {
        if (activity.isFinishing() || activity.isDestroyed()) return;
        if (message == R.string.access_device_revoked || message == R.string.access_device_needs_invite) {
            showDeviceError(message);
            return;
        }
        prompt = new AlertDialog.Builder(activity).setTitle(R.string.access_sign_in)
            .setMessage(message)
            .setPositiveButton(R.string.access_sign_in, (dialog, button) -> begin(origin, instance, invite))
            .setNegativeButton(R.string.external_prompt_cancel, null)
            .setOnDismissListener(this::promptDismissed).show();
    }

    private boolean valid(long attempt) {
        return attempts.active(attempt) && !activity.isFinishing() && !activity.isDestroyed();
    }

    private void promptDismissed(android.content.DialogInterface dialog) {
        if (prompt == dialog) prompt = null;
    }

    @Override public void cancel() {
        if (active != null) active.discardPending(store);
        detach();
    }

    private void stopWaiting() {
        handler.removeCallbacksAndMessages(null);
        if (launcher != null) launcher.unregister();
        launcher = null;
        active = null;
    }

    @Override public void detach() {
        attempts.cancel();
        stopWaiting();
        if (prompt != null) prompt.dismiss();
        prompt = null;
    }
}
