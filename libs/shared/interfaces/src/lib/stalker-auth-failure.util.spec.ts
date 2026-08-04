import {
    classifyStalkerAuthFailureBody,
    createStalkerAuthFailureMarker,
    extractStalkerAuthFailureBody,
    isStalkerAuthFailureBody,
    isStalkerAuthFailureMessage,
    isStalkerAuthFailureResponse,
} from './stalker-auth-failure.util';

describe('classifyStalkerAuthFailureBody', () => {
    it.each([
        ['Authorization failed.', 'Authorization failed.'],
        // The stock server appends a numeric debug counter to this body only.
        ['Authorization failed. 75', 'Authorization failed.'],
        ['authorization failed', 'Authorization failed.'],
        ['Access denied.', 'Access denied.'],
        ['access denied', 'Access denied.'],
        ['Unauthorized request.', 'Unauthorized request.'],
        ['  Unauthorized request.\n', 'Unauthorized request.'],
    ])('classifies %j as %j', (body, expected) => {
        expect(classifyStalkerAuthFailureBody(body)).toBe(expected);
    });

    it('rejects a short proxy/WAF page that merely contains the phrase', () => {
        // 38 characters — well under any length cap, so only anchoring keeps
        // it out. Read as the middleware speaking it would trigger portal
        // reclassification against a portal that never answered at all.
        expect(
            classifyStalkerAuthFailureBody(
                '<html><body>Access denied</body></html>'
            )
        ).toBeNull();
        expect(
            classifyStalkerAuthFailureBody('Error: access denied by policy')
        ).toBeNull();
        expect(
            classifyStalkerAuthFailureBody(
                'The request Authorization failed. Try again later.'
            )
        ).toBeNull();
    });

    it('rejects long pages, non-strings and empty bodies', () => {
        expect(
            classifyStalkerAuthFailureBody(
                `<html>${'x'.repeat(300)} access denied</html>`
            )
        ).toBeNull();
        expect(classifyStalkerAuthFailureBody({ js: [] })).toBeNull();
        expect(classifyStalkerAuthFailureBody(undefined)).toBeNull();
        expect(classifyStalkerAuthFailureBody(null)).toBeNull();
        expect(classifyStalkerAuthFailureBody('')).toBeNull();
        expect(classifyStalkerAuthFailureBody('OK')).toBeNull();
    });

    it('exposes the same verdict through the boolean primitive', () => {
        expect(isStalkerAuthFailureBody('Access denied.')).toBe(true);
        expect(isStalkerAuthFailureBody('Access denied by policy')).toBe(false);
    });
});

describe('isStalkerAuthFailureResponse', () => {
    it('recognizes the plain-text body and the JSON envelope forms', () => {
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

    it('recognizes the wider structured-field phrases', () => {
        expect(
            isStalkerAuthFailureResponse({ js: { error: 'Invalid token' } })
        ).toBe(true);
        expect(
            isStalkerAuthFailureResponse({ js: { msg: 'Auth failed' } })
        ).toBe(true);
        expect(
            isStalkerAuthFailureResponse({ js: { error: 'unauthorized' } })
        ).toBe(true);
    });

    it('recognizes a phrase placed directly in js', () => {
        expect(
            isStalkerAuthFailureResponse({ js: 'Authorization failed. 75' })
        ).toBe(true);
    });

    it('leaves ordinary responses alone', () => {
        expect(isStalkerAuthFailureResponse({ js: { data: [] } })).toBe(false);
        expect(isStalkerAuthFailureResponse({ js: [] })).toBe(false);
        expect(isStalkerAuthFailureResponse({ js: false })).toBe(false);
        expect(isStalkerAuthFailureResponse(undefined)).toBe(false);
    });
});

describe('transport marker', () => {
    it('round-trips through create / detect / extract', () => {
        const marker = createStalkerAuthFailureMarker('Access denied.');
        expect(isStalkerAuthFailureResponse(marker)).toBe(true);
        expect(extractStalkerAuthFailureBody(marker)).toBe('Access denied.');
    });

    it('is what keeps the repair trigger working once Electron classifies', () => {
        // The main process replaces the plain-text body with this marker, so
        // a detector that only knew the raw string would silently stop
        // triggering portal repair on the desktop app.
        expect(
            isStalkerAuthFailureResponse({
                stalkerAuthFailure: 'Authorization failed.',
            })
        ).toBe(true);
    });

    it('does not accept arbitrary objects as markers', () => {
        expect(isStalkerAuthFailureResponse({ stalkerAuthFailure: 'nope' })).toBe(
            false
        );
        expect(extractStalkerAuthFailureBody({})).toBeNull();
    });
});

describe('extractStalkerAuthFailureBody', () => {
    it('extracts from the raw PWA payload string', () => {
        expect(extractStalkerAuthFailureBody('Authorization failed. 12')).toBe(
            'Authorization failed.'
        );
    });

    it('extracts from a {js: body} envelope', () => {
        expect(
            extractStalkerAuthFailureBody({ js: 'Authorization failed. 75' })
        ).toBe('Authorization failed.');
    });

    it('reports no canonical body for the structured panel wording', () => {
        // Still an auth failure — just not one of the middleware's bodies.
        const response = { js: { error: 'Invalid token' } };
        expect(extractStalkerAuthFailureBody(response)).toBeNull();
        expect(isStalkerAuthFailureResponse(response)).toBe(true);
    });

    it('returns null for ordinary responses', () => {
        expect(extractStalkerAuthFailureBody({ js: { data: [] } })).toBeNull();
        expect(extractStalkerAuthFailureBody(undefined)).toBeNull();
    });
});

describe('isStalkerAuthFailureMessage', () => {
    it('accepts messages our own auth layer produces', () => {
        expect(
            isStalkerAuthFailureMessage('Profile error: Invalid token')
        ).toBe(true);
        expect(isStalkerAuthFailureMessage('Authorization failed. 75')).toBe(
            true
        );
    });

    it('rejects unrelated messages', () => {
        expect(isStalkerAuthFailureMessage('HTTP Error 404: Not Found')).toBe(
            false
        );
        expect(isStalkerAuthFailureMessage(undefined)).toBe(false);
    });
});
