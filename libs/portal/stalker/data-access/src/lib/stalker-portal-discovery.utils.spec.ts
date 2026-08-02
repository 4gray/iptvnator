import {
    buildStalkerEndpointCandidates,
    classifyStalkerProbeResponse,
    getStalkerRequestErrorStatus,
    isStalkerAuthFailureBody,
    legacyTransformStalkerPortalUrl,
} from './stalker-portal-discovery.utils';

describe('buildStalkerEndpointCandidates', () => {
    it('probes the standard order for a /c URL users copy from the browser', () => {
        expect(
            buildStalkerEndpointCandidates('http://portal.example/c')
        ).toEqual([
            'http://portal.example/portal.php',
            'http://portal.example/server/load.php',
            'http://portal.example/stalker_portal/server/load.php',
        ]);
    });

    it('probes the same order for a bare host', () => {
        expect(buildStalkerEndpointCandidates('http://portal.example')).toEqual(
            [
                'http://portal.example/portal.php',
                'http://portal.example/server/load.php',
                'http://portal.example/stalker_portal/server/load.php',
            ]
        );
    });

    it('strips trailing slashes before deriving candidates', () => {
        expect(
            buildStalkerEndpointCandidates('http://portal.example/c///')
        ).toEqual([
            'http://portal.example/portal.php',
            'http://portal.example/server/load.php',
            'http://portal.example/stalker_portal/server/load.php',
        ]);
    });

    it('gives an explicitly pasted .php endpoint the first shot', () => {
        expect(
            buildStalkerEndpointCandidates(
                'http://portal.example/server/load.php'
            )
        ).toEqual([
            'http://portal.example/server/load.php',
            'http://portal.example/portal.php',
            'http://portal.example/stalker_portal/server/load.php',
        ]);
    });

    it('keeps a nonstandard pasted endpoint as the first candidate', () => {
        expect(
            buildStalkerEndpointCandidates('http://portal.example/cp/portal.php')
        ).toEqual([
            'http://portal.example/cp/portal.php',
            'http://portal.example/cp/server/load.php',
            'http://portal.example/cp/stalker_portal/server/load.php',
        ]);
    });

    it('never nests stalker_portal twice for a /stalker_portal/c URL', () => {
        expect(
            buildStalkerEndpointCandidates(
                'http://portal.example/stalker_portal/c'
            )
        ).toEqual([
            'http://portal.example/stalker_portal/portal.php',
            'http://portal.example/stalker_portal/server/load.php',
        ]);
    });

    it('deduplicates the pasted canonical stalker_portal endpoint', () => {
        expect(
            buildStalkerEndpointCandidates(
                'http://portal.example/stalker_portal/server/load.php'
            )
        ).toEqual([
            'http://portal.example/stalker_portal/server/load.php',
            'http://portal.example/stalker_portal/portal.php',
        ]);
    });

    it('returns no candidates for an empty URL', () => {
        expect(buildStalkerEndpointCandidates('   ')).toEqual([]);
    });
});

describe('isStalkerAuthFailureBody', () => {
    it.each([
        'Authorization failed.',
        'Authorization failed. 75',
        'Access denied.',
        'Unauthorized request.',
        '  Authorization failed.  ',
    ])('recognizes the middleware body %j', (body) => {
        expect(isStalkerAuthFailureBody(body)).toBe(true);
    });

    it('rejects long HTML pages that merely mention the phrase', () => {
        const page = `<html><head><title>Site</title></head><body>${'x'.repeat(
            300
        )} access denied ${'y'.repeat(100)}</body></html>`;
        expect(isStalkerAuthFailureBody(page)).toBe(false);
    });

    it('rejects non-string and empty responses', () => {
        expect(isStalkerAuthFailureBody({ js: [] })).toBe(false);
        expect(isStalkerAuthFailureBody(undefined)).toBe(false);
        expect(isStalkerAuthFailureBody(null)).toBe(false);
        expect(isStalkerAuthFailureBody('')).toBe(false);
        expect(isStalkerAuthFailureBody('OK')).toBe(false);
    });
});

describe('classifyStalkerProbeResponse', () => {
    it('classifies a js envelope as data', () => {
        expect(classifyStalkerProbeResponse({ js: [] })).toBe('data');
        expect(classifyStalkerProbeResponse({ js: { data: [] } })).toBe('data');
    });

    it('classifies the plain-text auth failure as auth-required', () => {
        expect(classifyStalkerProbeResponse('Authorization failed.')).toBe(
            'auth-required'
        );
    });

    it('classifies anything else as not-a-portal', () => {
        expect(classifyStalkerProbeResponse('<html>welcome</html>')).toBe(
            'not-a-portal'
        );
        expect(classifyStalkerProbeResponse(undefined)).toBe('not-a-portal');
        expect(classifyStalkerProbeResponse({ payload: 1 })).toBe(
            'not-a-portal'
        );
    });
});

describe('getStalkerRequestErrorStatus', () => {
    it('reads the status the Electron transport throws for HTTP errors', () => {
        expect(
            getStalkerRequestErrorStatus({
                message: 'HTTP Error 404: Not Found',
                status: 404,
            })
        ).toBe(404);
    });

    it('parses the status out of the IPC-wrapped message — invoke strips custom properties', () => {
        expect(
            getStalkerRequestErrorStatus(
                new Error(
                    "Error invoking remote method 'STALKER_REQUEST': HTTP Error 404: Not Found"
                )
            )
        ).toBe(404);
        // HTTP/2 has no reason phrases; the code alone must be enough.
        expect(
            getStalkerRequestErrorStatus(new Error('HTTP Error 404: '))
        ).toBe(404);
    });

    it('returns undefined for plain errors', () => {
        expect(getStalkerRequestErrorStatus(new Error('boom'))).toBeUndefined();
        expect(getStalkerRequestErrorStatus(undefined)).toBeUndefined();
        expect(getStalkerRequestErrorStatus({ status: '404' })).toBeUndefined();
    });
});

describe('legacyTransformStalkerPortalUrl', () => {
    it('keeps the historical rewrites for the unreachable-host fallback', () => {
        expect(legacyTransformStalkerPortalUrl('http://x.example/c')).toBe(
            'http://x.example/portal.php'
        );
        expect(
            legacyTransformStalkerPortalUrl('http://x.example/stalker_portal/c')
        ).toBe('http://x.example/stalker_portal/server/load.php');
        expect(
            legacyTransformStalkerPortalUrl('http://x.example/stalker_portal')
        ).toBe('http://x.example/stalker_portal/server/load.php');
        expect(
            legacyTransformStalkerPortalUrl('http://x.example/portal.php')
        ).toBe('http://x.example/portal.php');
    });
});
