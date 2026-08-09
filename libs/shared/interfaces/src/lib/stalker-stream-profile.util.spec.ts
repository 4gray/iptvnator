import { isStalkerStreamCredentialSafe } from './stalker-stream-profile.util';

describe('isStalkerStreamCredentialSafe', () => {
    const PORTAL = 'http://portal.example/stalker_portal/c/';

    it('accepts a stream on the exact portal origin', () => {
        expect(
            isStalkerStreamCredentialSafe(
                PORTAL,
                'http://portal.example/live/ch1.ts'
            )
        ).toBe(true);
    });

    it('accepts a same-host stream on a different port', () => {
        // The #1158 class: panels routinely serve streams from :8080 next to
        // the portal on :80, and those streams are gated on the portal cookie.
        expect(
            isStalkerStreamCredentialSafe(
                PORTAL,
                'http://portal.example:8080/live/ch1.ts'
            )
        ).toBe(true);
    });

    it('accepts a same-host scheme upgrade (http portal → https stream)', () => {
        expect(
            isStalkerStreamCredentialSafe(
                PORTAL,
                'https://portal.example/live/ch1.ts'
            )
        ).toBe(true);
    });

    it('rejects an https→http downgrade on the same host', () => {
        expect(
            isStalkerStreamCredentialSafe(
                'https://portal.example/stalker_portal/c/',
                'http://portal.example/live/ch1.ts'
            )
        ).toBe(false);
    });

    it('rejects a different host', () => {
        expect(
            isStalkerStreamCredentialSafe(
                PORTAL,
                'http://cdn.other.example/live/ch1.ts'
            )
        ).toBe(false);
    });

    it('compares hostnames case-insensitively', () => {
        expect(
            isStalkerStreamCredentialSafe(
                PORTAL,
                'http://PORTAL.example:8080/live/ch1.ts'
            )
        ).toBe(true);
    });

    it('rejects non-HTTP(S) stream schemes', () => {
        expect(
            isStalkerStreamCredentialSafe(PORTAL, 'rtsp://portal.example/ch1')
        ).toBe(false);
    });

    it('treats a terminal DNS root dot as the same host', () => {
        // `portal.example.` and `portal.example` resolve identically, but
        // `URL` preserves the dot — comparing literally classified a
        // portal-owned stream as third-party and stripped its credentials.
        expect(
            isStalkerStreamCredentialSafe(
                PORTAL,
                'http://portal.example./live/ch1.ts'
            )
        ).toBe(true);
        expect(
            isStalkerStreamCredentialSafe(
                'http://portal.example./portal.php',
                'http://portal.example/live/ch1.ts'
            )
        ).toBe(true);
    });

    it('still rejects a different host that merely shares a suffix', () => {
        expect(
            isStalkerStreamCredentialSafe(
                PORTAL,
                'http://evil.portal.example./live/ch1.ts'
            )
        ).toBe(false);
    });

    it('fails closed on missing or unparseable URLs', () => {
        expect(isStalkerStreamCredentialSafe(PORTAL, undefined)).toBe(false);
        expect(isStalkerStreamCredentialSafe(PORTAL, '')).toBe(false);
        expect(isStalkerStreamCredentialSafe(undefined, PORTAL)).toBe(false);
        expect(isStalkerStreamCredentialSafe(PORTAL, 'not a url')).toBe(false);
        expect(isStalkerStreamCredentialSafe('not a url', PORTAL)).toBe(false);
    });
});
