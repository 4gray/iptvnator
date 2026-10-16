import {
    applyDefaultAutoSelectFamilyAttemptTimeout,
    AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_FLAG,
} from '@iptvnator/shared/host-health';

/**
 * Raises Node's happy-eyeballs per-attempt connection budget from 250 ms to
 * 2500 ms for this isolate. The same fix the web backend applies at startup
 * (#1400): behind VPN or slow links a working IPv4 handshake to a dual-stack
 * panel routinely needs more than 250 ms, and a host whose IPv6 route is
 * dead then fails every attempt — two of those in a row and the connectivity
 * guard declares the panel unreachable.
 *
 * Node keeps the default per isolate, so the main process and each worker
 * thread that opens connections (playlist refresh, EPG) must call this
 * themselves; a value set in main never reaches a worker.
 */
export function applyElectronNetworkDefaults(
    log: (line: string) => void = () => undefined
): number | null {
    const attemptTimeout = applyDefaultAutoSelectFamilyAttemptTimeout();
    if (attemptTimeout !== null) {
        log(
            `connection attempt timeout set to ${attemptTimeout} ms for IPv6->IPv4 fallback; pass ${AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_FLAG} via NODE_OPTIONS to override`
        );
    }
    return attemptTimeout;
}
