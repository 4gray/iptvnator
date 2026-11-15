import {
    createStalkerPortalPageMarker,
    readStalkerPortalPageUrl,
} from './stalker-portal-page.util';

const HTML =
    '<html><head><script src="xpcom.common.js"></script></head></html>';

describe('createStalkerPortalPageMarker', () => {
    it.each([
        [
            'http://node.example.invalid/stalker_portal/c/',
            'http://node.example.invalid/stalker_portal/c/',
        ],
        [
            'http://node.example.invalid:8080/stalker_portal/c',
            'http://node.example.invalid:8080/stalker_portal/c',
        ],
        [
            'https://node.example.invalid/c/index.html',
            'https://node.example.invalid/c/index.html',
        ],
    ])('marks an HTML body served from %s', (finalUrl, expected) => {
        expect(createStalkerPortalPageMarker(HTML, finalUrl)).toEqual({
            stalkerPortalPage: expected,
        });
    });

    it('drops the query, fragment and credentials from the landing address', () => {
        expect(
            createStalkerPortalPageMarker(
                HTML,
                'http://user:secret@node.example.invalid/stalker_portal/c/?mac=00:1A:79:00:00:01#top'
            )
        ).toEqual({
            stalkerPortalPage: 'http://node.example.invalid/stalker_portal/c/',
        });
    });

    it.each([
        'http://portal.example.invalid/',
        'http://portal.example.invalid/server/load.php',
        'http://portal.example.invalid/cdn/page.html',
        'http://portal.example.invalid/abc/',
    ])('ignores bodies served from a non-portal-page address (%s)', (url) => {
        expect(createStalkerPortalPageMarker(HTML, url)).toBeNull();
    });

    it('ignores JSON answers and missing or invalid final addresses', () => {
        expect(
            createStalkerPortalPageMarker(
                { js: [] },
                'http://node.example.invalid/stalker_portal/c/'
            )
        ).toBeNull();
        expect(createStalkerPortalPageMarker(HTML, undefined)).toBeNull();
        expect(createStalkerPortalPageMarker(HTML, 'not a url')).toBeNull();
        expect(
            createStalkerPortalPageMarker(HTML, 'file:///tmp/c/')
        ).toBeNull();
    });
});

describe('readStalkerPortalPageUrl', () => {
    it('reads the landing address from a marker', () => {
        expect(
            readStalkerPortalPageUrl({
                stalkerPortalPage: 'http://node.example.invalid/c/',
            })
        ).toBe('http://node.example.invalid/c/');
    });

    it.each([null, undefined, HTML, { js: [] }, { stalkerPortalPage: '' }])(
        'returns null for %p',
        (value) => {
            expect(readStalkerPortalPageUrl(value)).toBeNull();
        }
    );
});
