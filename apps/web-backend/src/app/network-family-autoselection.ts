import net from 'node:net';

/**
 * Node enables "Happy Eyeballs" connection racing (`autoSelectFamily`) by
 * default and gives every address attempt only 250 ms before moving on to
 * the next one. Behind VPN or Docker networks a perfectly working IPv4
 * handshake routinely needs more than that, so a dual-stack provider
 * hostname with an unreachable IPv6 route exhausts all attempts
 * (`ENETUNREACH` on IPv6, `ETIMEDOUT` on IPv4) and surfaces as a bare
 * 502 (#1400). Raising the per-attempt budget keeps the IPv6→IPv4 fallback
 * intact — unlike `--no-network-family-autoselection`, which would break
 * IPv6-only deployments — while tolerating slow links.
 */
export const DEFAULT_AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS = 2500;

export const AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_FLAG =
    '--network-family-autoselection-attempt-timeout';

export interface ApplyAutoSelectFamilyAttemptTimeoutOptions {
    readonly execArgv?: readonly string[];
    readonly nodeOptions?: string;
    readonly setAttemptTimeout?: (timeoutMs: number) => void;
}

/**
 * Node accepts underscores interchangeably with dashes in flag names
 * (`process.allowedNodeEnvironmentFlags` semantics), so
 * `--network_family_autoselection_attempt_timeout=500` is just as explicit
 * as the canonical spelling and must be honored too.
 */
function normalizeFlagSpelling(value: string): string {
    return value.replace(/_/g, '-');
}

/**
 * An operator who tunes the timeout through Node's own CLI flag (directly or
 * via `NODE_OPTIONS`) must keep the final word: the flag is applied before
 * user code runs, so overwriting it here would silently undo their setting.
 */
export function hasExplicitAttemptTimeoutFlag(
    execArgv: readonly string[],
    nodeOptions: string
): boolean {
    return (
        execArgv.some((arg) => {
            const normalized = normalizeFlagSpelling(arg);
            return (
                normalized === AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_FLAG ||
                normalized.startsWith(
                    `${AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_FLAG}=`
                )
            );
        }) ||
        normalizeFlagSpelling(nodeOptions).includes(
            AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_FLAG
        )
    );
}

/**
 * Raises the process-wide happy-eyeballs attempt timeout unless the operator
 * already set one explicitly. Returns the applied value, or `null` when the
 * explicit flag won (or the running Node build lacks the setter).
 */
export function applyDefaultAutoSelectFamilyAttemptTimeout(
    options: ApplyAutoSelectFamilyAttemptTimeoutOptions = {}
): number | null {
    const execArgv = options.execArgv ?? process.execArgv;
    const nodeOptions =
        options.nodeOptions ?? process.env['NODE_OPTIONS'] ?? '';
    if (hasExplicitAttemptTimeoutFlag(execArgv, nodeOptions)) {
        return null;
    }

    const setAttemptTimeout =
        options.setAttemptTimeout ??
        net.setDefaultAutoSelectFamilyAttemptTimeout;
    if (typeof setAttemptTimeout !== 'function') {
        return null;
    }

    setAttemptTimeout(DEFAULT_AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS);
    return DEFAULT_AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS;
}
