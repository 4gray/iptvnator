/**
 * Stalker/Ministra authorization-failure detection, shared by both
 * transports.
 *
 * The stock middleware answers an unauthenticated or unauthorized request
 * with **HTTP 200 and a bare plain-text body** — never a 401/403 — because it
 * exits before the JSON envelope is built. The three exact bodies
 * (Stalker 4.9.35), optionally followed by a numeric debug counter:
 *
 * - `Authorization failed.` — token missing, stale, or replaced by another
 *   device's session
 * - `Access denied.` — the account is blocked or disabled
 * - `Unauthorized request.` — the `mac` cookie is missing entirely
 *
 * Some reseller panels answer a JSON envelope (`{js: {error: …}}` /
 * `{js: {msg: …}}`) instead, with a wider vocabulary.
 *
 * This lives in `shared/interfaces` rather than in the Stalker renderer lib
 * because the Electron main process is where these bodies actually arrive,
 * and it cannot import renderer libraries — the same reason the identity and
 * URL builders were centralised here. Two copies would drift.
 */

/** The exact plain-text bodies the stock middleware emits. */
export const STALKER_AUTH_FAILURE_BODIES = [
    'Authorization failed.',
    'Access denied.',
    'Unauthorized request.',
] as const;

export type StalkerAuthFailureBody =
    (typeof STALKER_AUTH_FAILURE_BODIES)[number];

/**
 * Body patterns, anchored to the WHOLE trimmed body.
 *
 * Anchoring matters: these bodies are bare phrases, so a substring match
 * would also accept any short page that merely contains one — a reverse
 * proxy or WAF answering `<html><body>Access denied</body></html>` is well
 * under any sane length cap and would otherwise be read as the middleware
 * speaking, triggering portal reclassification against a portal that never
 * answered at all. Only the `Authorization failed.` body carries the stock
 * server's optional trailing counter.
 */
const AUTH_FAILURE_PATTERNS: ReadonlyArray<{
    body: StalkerAuthFailureBody;
    pattern: RegExp;
}> = [
    {
        body: 'Authorization failed.',
        pattern: /^authorization\s+failed[.!]*(?:\s+\d+)?$/i,
    },
    { body: 'Access denied.', pattern: /^access\s+denied[.!]*$/i },
    { body: 'Unauthorized request.', pattern: /^unauthorized\s+request[.!]*$/i },
];

/** Bodies longer than this are never the middleware's bare phrase. */
const MAX_BODY_LENGTH = 64;

/**
 * Classifies a raw portal response body, returning the canonical failure
 * body when the value is one of the three plain-text auth failures.
 */
export function classifyStalkerAuthFailureBody(
    value: unknown
): StalkerAuthFailureBody | null {
    if (typeof value !== 'string') {
        return null;
    }

    const body = value.trim();
    if (body.length === 0 || body.length > MAX_BODY_LENGTH) {
        return null;
    }

    return (
        AUTH_FAILURE_PATTERNS.find(({ pattern }) => pattern.test(body))?.body ??
        null
    );
}

/**
 * Whether a portal response body is one of the middleware's plain-text auth
 * failures.
 */
export function isStalkerAuthFailureBody(value: unknown): boolean {
    return classifyStalkerAuthFailureBody(value) !== null;
}

/**
 * Auth-failure phrases accepted inside the STRUCTURED `js.error`/`js.msg`
 * fields, and in error messages our own auth layer produces. Deliberately
 * wider than the body patterns above — the input is a field a panel filled
 * in deliberately, not an arbitrary document, so `Invalid token`,
 * `Auth failed` and a bare `unauthorized` are all meaningful there.
 */
const JSON_AUTH_FAILURE_PATTERNS = [
    /authorization\s+failed/i,
    /access\s+denied/i,
    /unauthorized\s+request/i,
    /auth\s+failed/i,
    /invalid\s+token/i,
    /\bunauthorized\b/i,
    /authorization/i,
];

const MAX_PHRASE_LENGTH = 200;

function isStalkerJsonAuthFailurePhrase(value: string): boolean {
    const phrase = value.trim();
    if (phrase.length === 0 || phrase.length > MAX_PHRASE_LENGTH) {
        return false;
    }

    return JSON_AUTH_FAILURE_PATTERNS.some((pattern) => pattern.test(phrase));
}

/**
 * Whether an ERROR MESSAGE reports an authorization failure. Uses the wide
 * phrase set because the input is a controlled string produced by our own
 * auth layer — e.g. `Error('Profile error: Invalid token')` — not an
 * arbitrary portal body, where the same breadth would false-positive.
 */
export function isStalkerAuthFailureMessage(message: unknown): boolean {
    return (
        typeof message === 'string' && isStalkerJsonAuthFailurePhrase(message)
    );
}

/**
 * Whether a portal response is an authorization failure in EITHER wire
 * shape: the middleware's plain-text body, or the JSON envelope some panels
 * answer instead. Classification and the lazy-repair trigger must use this,
 * not the string-only primitive: a JSON-failing panel would otherwise be
 * persisted as token-free and never repaired.
 */
export function isStalkerAuthFailureResponse(response: unknown): boolean {
    if (isStalkerAuthFailureBody(response)) {
        return true;
    }

    if (
        response === null ||
        typeof response !== 'object' ||
        !('js' in (response as Record<string, unknown>))
    ) {
        return false;
    }

    const js = (response as { js?: unknown }).js;

    // Some panels put the phrase directly in `js` instead of an object.
    if (typeof js === 'string') {
        return isStalkerJsonAuthFailurePhrase(js);
    }

    if (js === null || typeof js !== 'object') {
        return false;
    }

    const { error, msg } = js as { error?: unknown; msg?: unknown };
    return [error, msg].some(
        (value) =>
            typeof value === 'string' && isStalkerJsonAuthFailurePhrase(value)
    );
}
