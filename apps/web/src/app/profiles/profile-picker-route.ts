/** Route constants and the in-memory "who's watching" answer of this session. */
export const PROFILE_PICKER_PATH = '/profile-picker';
export const PROFILE_PICKER_FALLBACK = '/workspace';

let pickedThisSession = false;

/** The picker asks once per app start; leaving it sets this, so the workspace guard lets the user in. */
export function markProfilePicked(): void {
    pickedThisSession = true;
}

export function profilePickedThisSession(): boolean {
    return pickedThisSession;
}

/** Test seam: a fresh app start. */
export function resetProfilePickedForTests(): void {
    pickedThisSession = false;
}

/**
 * Only an in-app absolute path survives: no scheme, no protocol-relative
 * `//host`, no backslash tricks, and never the picker or sign-in themselves.
 */
export function sanitizeReturnUrl(value: unknown): string {
    if (
        typeof value !== 'string' ||
        value.length > 2048 ||
        !value.startsWith('/') ||
        value.startsWith('//') ||
        Array.from(value).some(
            (char) => char === '\\' || char.charCodeAt(0) < 0x20
        )
    ) {
        return PROFILE_PICKER_FALLBACK;
    }
    const path = value.split(/[?#]/, 1)[0];
    return path === PROFILE_PICKER_PATH ||
        path === '/server-sign-in' ||
        path === '/'
        ? PROFILE_PICKER_FALLBACK
        : value;
}
