import type { StalkerAuthFailureBody } from '@iptvnator/shared/interfaces';

/**
 * Why a Stalker portal refused the session.
 *
 * - `login-required` — `get_profile` answered `status: 2`: the portal wants
 *   `do_auth` with a login/password, and none are stored for the playlist.
 * - `login-rejected` — `do_auth` answered `{js: false}` (the operator billing
 *   script refused the credentials), or the profile still demanded a login
 *   after a successful `do_auth`.
 * - `blocked` — `get_profile` answered `status: 1`: the account is blocked or
 *   the device identity conflicts. `msg`/`block_msg` explain why.
 * - `auth-failed` — a request came back as one of the plain-text bodies
 *   (`Authorization failed.`, `Access denied.`, `Unauthorized request.`) and
 *   re-authentication did not recover it.
 */
export type StalkerPortalErrorKind =
    | 'login-required'
    | 'login-rejected'
    | 'blocked'
    | 'auth-failed';

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
