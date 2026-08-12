import { buildHostConnectivityFastFailMessage } from '@iptvnator/shared/interfaces';
import {
    buildStalkerEndpointCandidates,
    classifyStalkerProbeResponse,
    getStalkerRequestErrorStatus,
    isStalkerAuthFailureBody,
    isStalkerAuthFailureMessage,
    isStalkerAuthFailureResponse,
    isStalkerProbeTimeout,
    legacyTransformStalkerPortalUrl,
    normalizeStalkerPortalInputUrl,
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
            buildStalkerEndpointCandidates(
                'http://portal.example/cp/portal.php'
            )
        ).toEqual([
            'http://portal.example/cp/portal.php',
            'http://portal.example/cp/server/load.php',
            'http://portal.example/cp/stalker_portal/server/load.php',
        ]);
    });

    it("derives standard fallbacks from a nonstandard endpoint's directory", () => {
        // The pasted endpoint keeps the first shot, but recovery candidates
        // must be its SIBLINGS — not paths appended to the file itself.
        expect(
            buildStalkerEndpointCandidates('http://portal.example/cp/api.php')
        ).toEqual([
            'http://portal.example/cp/api.php',
            'http://portal.example/cp/portal.php',
            'http://portal.example/cp/server/load.php',
            'http://portal.example/cp/stalker_portal/server/load.php',
        ]);
    });

    it('keeps a real installation directory named c', () => {
        // `/tenant/c/portal.php` means the installation lives in `/tenant/c`
        // — the `/c` landing-page rewrite must not strip it, or the
        // siblings would be probed one level too high.
        expect(
            buildStalkerEndpointCandidates(
                'http://portal.example/tenant/c/portal.php'
            )
        ).toEqual([
            'http://portal.example/tenant/c/portal.php',
            'http://portal.example/tenant/c/server/load.php',
            'http://portal.example/tenant/c/stalker_portal/server/load.php',
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

    it('derives candidates from the pathname when the URL carries a query or fragment', () => {
        // Suffix matching on the raw string would keep `/c` and append the
        // endpoints inside the query — every probe would still hit /c.
        expect(
            buildStalkerEndpointCandidates('http://portal.example/c?key=value')
        ).toEqual([
            'http://portal.example/portal.php',
            'http://portal.example/server/load.php',
            'http://portal.example/stalker_portal/server/load.php',
        ]);
        expect(
            buildStalkerEndpointCandidates(
                'http://portal.example:8080/portal.php?sn=1#frag'
            )
        ).toEqual([
            'http://portal.example:8080/portal.php',
            'http://portal.example:8080/server/load.php',
            'http://portal.example:8080/stalker_portal/server/load.php',
        ]);
    });

    it('returns no candidates for empty or unparseable URLs', () => {
        expect(buildStalkerEndpointCandidates('   ')).toEqual([]);
        expect(buildStalkerEndpointCandidates('not-a-url')).toEqual([]);
    });
});

describe('normalizeStalkerPortalInputUrl', () => {
    it('reduces a URL to origin + pathname', () => {
        expect(
            normalizeStalkerPortalInputUrl('http://host.example/c?key=value#f')
        ).toBe('http://host.example/c');
        expect(
            normalizeStalkerPortalInputUrl('  http://host.example:8080/c/  ')
        ).toBe('http://host.example:8080/c');
    });

    it('feeds the legacy fallback transform a rewritable path', () => {
        // The offline-import fallback runs the legacy /c → portal.php
        // rewrite on this form; unnormalized input would keep the /c page.
        expect(
            legacyTransformStalkerPortalUrl(
                normalizeStalkerPortalInputUrl(
                    'http://host.example/c?key=value'
                ) ?? ''
            )
        ).toBe('http://host.example/portal.php');
    });

    it('returns null for unparseable input', () => {
        expect(normalizeStalkerPortalInputUrl('not-a-url')).toBeNull();
        expect(normalizeStalkerPortalInputUrl('   ')).toBeNull();
    });

    it('preserves the accepted URL authority instead of rebuilding from origin', () => {
        // Basic-auth credentials must not be silently dropped…
        expect(
            normalizeStalkerPortalInputUrl(
                'https://user:pass@host.example/c?key=value'
            )
        ).toBe('https://user:pass@host.example/c');
        // …and file: URLs (origin "null") must stay parseable rather than
        // becoming "null/tmp/c" and throwing in the candidate builder.
        expect(normalizeStalkerPortalInputUrl('file:///tmp/c')).toBe(
            'file:///tmp/c'
        );
        expect(buildStalkerEndpointCandidates('file:///tmp/c')).toEqual([
            'file:///tmp/portal.php',
            'file:///tmp/server/load.php',
            'file:///tmp/stalker_portal/server/load.php',
        ]);
        expect(
            buildStalkerEndpointCandidates('https://user:pass@host.example/c')
        ).toEqual([
            'https://user:pass@host.example/portal.php',
            'https://user:pass@host.example/server/load.php',
            'https://user:pass@host.example/stalker_portal/server/load.php',
        ]);
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

describe('isStalkerAuthFailureResponse', () => {
    it('recognizes both the plain-text body and the JSON envelope forms', () => {
        expect(isStalkerAuthFailureResponse('Authorization failed.')).toBe(
            true
        );
        expect(
            isStalkerAuthFailureResponse({
                js: { error: 'Authorization failed' },
            })
        ).toBe(true);
        expect(
            isStalkerAuthFailureResponse({ js: { msg: 'Access denied.' } })
        ).toBe(true);
    });

    it('recognizes the wider structured-field phrases the session service accepts', () => {
        expect(
            isStalkerAuthFailureResponse({ js: { error: 'Invalid token' } })
        ).toBe(true);
        expect(
            isStalkerAuthFailureResponse({ js: { error: 'Auth failed' } })
        ).toBe(true);
        expect(
            isStalkerAuthFailureResponse({ js: { msg: 'unauthorized' } })
        ).toBe(true);
    });

    it('does not flag ordinary data or unrelated js errors', () => {
        expect(isStalkerAuthFailureResponse({ js: { data: [] } })).toBe(false);
        expect(
            isStalkerAuthFailureResponse({
                js: { error: 'Unknown action: get_genres' },
            })
        ).toBe(false);
        expect(isStalkerAuthFailureResponse(undefined)).toBe(false);
    });
});

describe('isStalkerAuthFailureMessage', () => {
    it('matches the wide phrase set our own auth layer produces', () => {
        expect(
            isStalkerAuthFailureMessage('Profile error: Invalid token')
        ).toBe(true);
        expect(isStalkerAuthFailureMessage('Profile error: Auth failed')).toBe(
            true
        );
        expect(
            isStalkerAuthFailureMessage('Profile error: Access denied.')
        ).toBe(true);
    });

    it('stays narrower than a free-form body check for unrelated text', () => {
        expect(isStalkerAuthFailureMessage('nothing_to_play')).toBe(false);
        expect(isStalkerAuthFailureMessage('timeout of 15000ms exceeded')).toBe(
            false
        );
        expect(isStalkerAuthFailureMessage(undefined)).toBe(false);
    });

    it('is wider than the plain-text BODY matcher on purpose', () => {
        // A portal BODY saying "Invalid token" is not one of the three
        // middleware phrases; a controlled Error message is.
        expect(isStalkerAuthFailureBody('Invalid token')).toBe(false);
        expect(isStalkerAuthFailureMessage('Invalid token')).toBe(true);
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

    it('classifies the JSON-envelope auth failure as auth-required, not data', () => {
        // Some panels answer HTTP 200 + {js:{error:"Authorization failed"}}
        // instead of the plain-text body; treating it as data would persist
        // the portal as token-free with no repair trigger ever firing.
        expect(
            classifyStalkerProbeResponse({
                js: { error: 'Authorization failed' },
            })
        ).toBe('auth-required');
    });

    it('requires a real get_genres data shape, not a bare js key', () => {
        // A 200 error envelope must not end discovery on a broken
        // candidate — the healthy sibling would never be probed.
        expect(
            classifyStalkerProbeResponse({ js: { error: 'Unknown action' } })
        ).toBe('not-a-portal');
        expect(classifyStalkerProbeResponse({ js: false })).toBe(
            'not-a-portal'
        );
        expect(classifyStalkerProbeResponse({ js: null })).toBe('not-a-portal');
        expect(classifyStalkerProbeResponse({ js: {} })).toBe('not-a-portal');
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

describe('host connectivity guard fast-fail message', () => {
    // The main process refuses requests to a host that stopped answering, and
    // only the message survives `ipcRenderer.invoke`. These assertions are the
    // contract: the wording must land in the "connection-level failure" slot,
    // because that is what a tripped guard actually means. Any other reading
    // has a consequence — a parsed status makes discovery walk every candidate
    // and can fire lazy repair against a host we just declared dead; timeout
    // wording loses the abort-early semantics; an auth phrase fires repair too.
    const message = buildHostConnectivityFastFailMessage(
        'http://portal.example:8080'
    );
    const ipcWrapped = new Error(
        `Error invoking remote method 'STALKER_REQUEST': ${message}`
    );

    it('carries no HTTP status, bare or IPC-wrapped', () => {
        expect(
            getStalkerRequestErrorStatus(new Error(message))
        ).toBeUndefined();
        expect(getStalkerRequestErrorStatus(ipcWrapped)).toBeUndefined();
    });

    it('does not read as a timeout', () => {
        expect(isStalkerProbeTimeout(new Error(message))).toBe(false);
        expect(isStalkerProbeTimeout(ipcWrapped)).toBe(false);
    });

    it('does not read as an authorization failure', () => {
        expect(isStalkerAuthFailureMessage(message)).toBe(false);
        expect(isStalkerAuthFailureMessage(ipcWrapped.message)).toBe(false);
    });

    it('survives an endpoint whose hostname reads like a classifier keyword', () => {
        // The endpoint is interpolated user data: a portal at
        // `https://authorization.example` would otherwise match the broad auth
        // phrase set and send an unreachable host into lazy portal repair.
        const keywordHost = buildHostConnectivityFastFailMessage(
            'https://authorization.example'
        );

        expect(isStalkerAuthFailureMessage(keywordHost)).toBe(false);
        expect(isStalkerProbeTimeout(new Error(keywordHost))).toBe(false);
        expect(
            getStalkerRequestErrorStatus(new Error(keywordHost))
        ).toBeUndefined();

        const unauthorizedHost = buildHostConnectivityFastFailMessage(
            'http://unauthorized.example:8080'
        );
        expect(isStalkerAuthFailureMessage(unauthorizedHost)).toBe(false);
    });

    it('names the endpoint so the snackbar it reaches says something useful', () => {
        // Scheme included: the same panel can be imported over both HTTP and
        // HTTPS, and the user needs to know which one was skipped.
        expect(message).toContain('http://portal.example:8080');
    });
});

describe('legacyTransformStalkerPortalUrl', () => {
    it('uses portal.php for an offline bare host', () => {
        expect(legacyTransformStalkerPortalUrl('http://x.example')).toBe(
            'http://x.example/portal.php'
        );
    });

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
