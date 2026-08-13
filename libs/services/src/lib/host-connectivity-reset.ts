import { CONNECTIVITY_GUARD_RESET } from '@iptvnator/shared/interfaces';
import type { DataService } from './data.service';

/**
 * Asks the main process to forget the connection failures it recorded for the
 * host `url` points at, so the next request contacts it for real instead of
 * being fast-failed by the connectivity guard.
 *
 * Send this whenever the user asked for a real attempt (portal retry, "test
 * connection") or handed over an address that may now point somewhere else
 * (import, edited connection, lazy repair).
 *
 * Always best effort: the guard only ever delays a request, so a failure here
 * must never block the action that asked for it. Both runtimes honour it — the
 * Electron main process over IPC, the PWA as an HTTP call to the web backend
 * that owns its guard — so neither keeps fast-failing an endpoint the user just
 * asked to retry. A new caller has to reach this helper on both paths; there is
 * no longer a runtime where it quietly does nothing.
 */
export async function resetHostConnectivityGuard(
    dataService: Pick<DataService, 'sendIpcEvent'>,
    url: string | null | undefined
): Promise<void> {
    if (!url) {
        return;
    }

    try {
        await Promise.resolve(
            dataService.sendIpcEvent(CONNECTIVITY_GUARD_RESET, { url })
        );
    } catch {
        // Deliberately silent: the caller's own request reports the real state.
    }
}
