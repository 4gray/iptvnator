import {
    normalizeStalkerPortalPageResponse,
    readStalkerPortalPageUrl,
} from './stalker-portal-page.util';

const HTML =
    '<html><head><script src="xpcom.common.js"></script></head></html>';

describe('normalizeStalkerPortalPageResponse', () => {
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
        expect(normalizeStalkerPortalPageResponse(HTML, finalUrl)).toEqual({
            stalkerPortalPage: expected,
        });
    });

    it('drops the query, fragment and credentials from the landing address', () => {
        expect(
            normalizeStalkerPortalPageResponse(
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
        expect(normalizeStalkerPortalPageResponse(HTML, url)).toBe(HTML);
    });

    it.each(['Authorization failed.', 'Service unavailable', ''])(
        'preserves a non-HTML body served from a portal page (%j)',
        (body) => {
            expect(
                normalizeStalkerPortalPageResponse(
                    body,
                    'https://node.example.invalid/c/'
                )
            ).toBe(body);
        }
    );

    it.each([
        '\uFEFF\n<!DOCTYPE html><title>Portal</title>',
        ' \n<!-- Portal page -->\n<!-- Start -->\n<!DOCTYPE html><title>Portal</title>',
    ])('recognizes the portal HTML preamble %j', (body) => {
        expect(
            normalizeStalkerPortalPageResponse(
                body,
                'https://node.example.invalid/c/'
            )
        ).toEqual({ stalkerPortalPage: 'https://node.example.invalid/c/' });
    });

    it('preserves replies whose HTML comment never closes', () => {
        const body = '<!-- <!DOCTYPE html><title>Portal</title>';
        expect(
            normalizeStalkerPortalPageResponse(
                body,
                'https://node.example.invalid/c/'
            )
        ).toBe(body);
    });

    it('ignores JSON answers and missing or invalid final addresses', () => {
        expect(
            normalizeStalkerPortalPageResponse(
                { js: [] },
                'http://node.example.invalid/stalker_portal/c/'
            )
        ).toEqual({ js: [] });
        expect(normalizeStalkerPortalPageResponse(HTML, undefined)).toBe(HTML);
        expect(normalizeStalkerPortalPageResponse(HTML, 'not a url')).toBe(
            HTML
        );
        expect(normalizeStalkerPortalPageResponse(HTML, 'file:///tmp/c/')).toBe(
            HTML
        );
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
