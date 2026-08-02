import {
    isFullStalkerPortalPlaylist,
    isFullStalkerPortalUrl,
} from './stalker-portal-mode.util';

describe('isFullStalkerPortalUrl', () => {
    it.each([
        // The canonical Ministra endpoint the old IMPORT predicate missed —
        // the root cause of "portal added, no content" (#850).
        'http://portal.example/server/load.php',
        // /stalker_portal without a trailing slash, which the old RUNTIME
        // predicate (`includes('/stalker_portal/')`) missed.
        'http://portal.example/stalker_portal',
        'http://portal.example/stalker_portal/c',
        'http://portal.example/stalker_portal/server/load.php',
    ])('classifies %s as a full portal URL', (url) => {
        expect(isFullStalkerPortalUrl(url)).toBe(true);
    });

    it.each([
        'http://portal.example/portal.php',
        'http://portal.example/c',
        'http://portal.example',
        '',
    ])('classifies %s as a non-full portal URL', (url) => {
        expect(isFullStalkerPortalUrl(url)).toBe(false);
    });
});

describe('isFullStalkerPortalPlaylist', () => {
    it('trusts an explicit true flag even for a portal.php URL', () => {
        // Discovery can prove a portal.php panel enforces the token; the
        // observed behavior must beat the URL shape.
        expect(
            isFullStalkerPortalPlaylist({
                isFullStalkerPortal: true,
                portalUrl: 'http://portal.example/portal.php',
            })
        ).toBe(true);
    });

    it('trusts an explicit false flag even for a canonical URL', () => {
        expect(
            isFullStalkerPortalPlaylist({
                isFullStalkerPortal: false,
                portalUrl: 'http://portal.example/server/load.php',
            })
        ).toBe(false);
    });

    it('falls back to the portalUrl shape when the flag is undefined', () => {
        expect(
            isFullStalkerPortalPlaylist({
                portalUrl: 'http://portal.example/server/load.php',
            })
        ).toBe(true);
        expect(
            isFullStalkerPortalPlaylist({
                portalUrl: 'http://portal.example/portal.php',
            })
        ).toBe(false);
    });

    it('falls back to the legacy url field when portalUrl is absent', () => {
        expect(
            isFullStalkerPortalPlaylist({
                url: 'http://portal.example/stalker_portal/c',
            })
        ).toBe(true);
    });

    it('treats a playlist with no URL at all as a simple portal', () => {
        expect(isFullStalkerPortalPlaylist({})).toBe(false);
    });
});
