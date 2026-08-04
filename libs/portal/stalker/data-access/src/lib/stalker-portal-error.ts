import type { StalkerAuthFailureBody } from '@iptvnator/shared/interfaces';

/**
 * Why a Stalker portal refused the session.
 *
 * - `login-required` — `get_profile` answered `status: 2`: the portal wants
 *   `do_auth` with a login/password, and none are stored for the playlist.
 * - `login-rejected` — `do_auth` answered `{js: false}` (the operator billing
 *   script refused the credentials), or the profile still demanded a login
 *   after a successful `do_auth`.
 * - `device-conflict` — a `status: 1` refusal whose `msg` names the device
 *   binding: the portal already pinned a different `device_id`/`device_id2` to
 *   this MAC. Split out of `blocked` because it is the one refusal with a
 *   concrete remedy, and because the portal's own words for it ("Your STB is
 *   damaged") describe hardware failure rather than what actually happened.
 * - `blocked` — any other `get_profile` `status: 1`: the account is disabled,
 *   the MAC is unknown or malformed. `msg`/`block_msg` explain why.
 * - `auth-failed` — a request came back as one of the plain-text bodies
 *   (`Authorization failed.`, `Access denied.`, `Unauthorized request.`) and
 *   re-authentication did not recover it.
 */
export type StalkerPortalErrorKind =
    | 'login-required'
    | 'login-rejected'
    | 'device-conflict'
    | 'blocked'
    | 'auth-failed';

/**
 * Device-conflict phrasings seen in the wild, matched against the portal's
 * `msg`/`block_msg` — a STRUCTURED field the middleware wrote, so a phrase set
 * is safe here in a way it would not be against a raw HTML body.
 *
 * Kept to the binding itself: "device" alone appears in unrelated refusals
 * ("device limit reached", "no device selected"), and mislabelling one of
 * those would hand the user a remedy that cannot work.
 */
const DEVICE_CONFLICT_PATTERNS: readonly RegExp[] = [
    /device\s*conflict/i,
    /device[\s_-]?id[^.!?]{0,40}?(mismatch|conflict|does\s*not\s*match|not\s*match)/i,
];

/**
 * True when a `status: 1` refusal is the portal reporting that this MAC is
 * already bound to a different device ID.
 */
export function isStalkerDeviceConflictMessage(
    portalText: string | undefined
): boolean {
    if (!portalText) {
        return false;
    }

    return DEVICE_CONFLICT_PATTERNS.some((pattern) =>
        pattern.test(portalText)
    );
}

/**
 * `block_msg` routinely carries markup ("Your STB is damaged.<br/> Call the
 * provider."); strip it before the text reaches a snackbar or error view.
 */
export function stripStalkerPortalMarkup(text: string): string {
    return text
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Combines the portal's own `msg`/`block_msg` explanation into one plain-text
 * line, or returns undefined when the portal sent none.
 */
export function combineStalkerPortalMessages(
    msg: string | undefined,
    blockMsg: string | undefined
): string | undefined {
    const parts = [msg, blockMsg]
        .map((part) => stripStalkerPortalMarkup(part ?? ''))
        .filter((part) => part.length > 0);
    // A duplicated msg/block_msg pair should not be echoed twice.
    const unique = parts.filter(
        (part, index) => parts.indexOf(part) === index
    );
    return unique.length > 0 ? unique.join(' — ') : undefined;
}

/**
 * A portal-explained authentication failure. `portalText` carries the server's
 * own words (already markup-stripped) when it sent any — the UI shows them
 * verbatim instead of a generic "unable to load" message.
 */
export class StalkerPortalError extends Error {
    constructor(
        readonly kind: StalkerPortalErrorKind,
        readonly portalText?: string,
        readonly failureBody?: StalkerAuthFailureBody
    ) {
        super(
            `Stalker portal refused the session (${kind})` +
                (portalText ? `: ${portalText}` : '')
        );
        this.name = 'StalkerPortalError';
    }
}

/**
 * Recognizes a StalkerPortalError across chunk boundaries: `instanceof` is
 * checked first, but a structurally equivalent object (same name + kind) is
 * accepted too so lazy-loaded consumers never mis-classify one.
 */
export function asStalkerPortalError(
    error: unknown
): StalkerPortalError | null {
    if (error instanceof StalkerPortalError) {
        return error;
    }

    if (
        typeof error === 'object' &&
        error !== null &&
        (error as { name?: unknown }).name === 'StalkerPortalError' &&
        typeof (error as { kind?: unknown }).kind === 'string'
    ) {
        return error as StalkerPortalError;
    }

    return null;
}
