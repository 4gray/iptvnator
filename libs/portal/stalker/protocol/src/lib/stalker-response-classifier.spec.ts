import {
    classifyStalkerDoAuth,
    classifyStalkerProfile,
    classifyStalkerResponseFailure,
    parseStalkerResponseEnvelope,
} from './stalker-response-classifier';

describe('Stalker response classifier', () => {
    it.each([
        [0, 'ready'],
        ['0', 'ready'],
        [1, 'blocked'],
        ['1', 'blocked'],
        [2, 'credentials-required'],
        ['2', 'credentials-required'],
    ])('normalizes profile status %p', (status, expectedKind) => {
        expect(classifyStalkerProfile({ js: { id: 7, status } })).toMatchObject(
            {
                kind: expectedKind,
            }
        );
    });

    it.each([
        ['profile block flag', { js: { blocked: true, status: 1 } }, 'blocked'],
        [
            'envelope block flag',
            { account_blocked: '1', js: { status: '1' } },
            'blocked',
        ],
        [
            'profile credential flag',
            { js: { credentials_required: true, status: 2 } },
            'credentials-required',
        ],
        [
            'envelope credential flag',
            { auth_required: '1', js: { status: '2' } },
            'credentials-required',
        ],
    ])(
        'accepts a status confirmed by a matching %s',
        (_, value, expectedKind) => {
            expect(classifyStalkerProfile(value)).toMatchObject({
                kind: expectedKind,
            });
        }
    );

    it.each([
        { js: { credentials_required: true, status: 1 } },
        { js: { blocked: true, status: 2 } },
        { js: { blocked: true, status: 0 } },
    ])('rejects a profile status with a conflicting indicator', (value) => {
        expect(classifyStalkerProfile(value)).toEqual({
            kind: 'failure',
            reason: 'incompatible-response',
        });
    });

    it('accepts a recognized status-less profile success', () => {
        expect(
            classifyStalkerProfile({
                js: { id: 7, mac: '00:1A:79:00:00:01' },
            })
        ).toMatchObject({ kind: 'ready', status: 'statusless' });
    });

    it.each([
        { js: { error: 'Access denied', id: 7 } },
        { js: { blocked: true, id: 7 } },
        { js: { credentials_required: true, id: 7 } },
        { error: 'Authorization failed', js: { id: 7 } },
    ])('rejects status-less profiles carrying failure indicators', (value) => {
        expect(classifyStalkerProfile(value)).toEqual({
            kind: 'failure',
            reason: 'incompatible-response',
        });
    });

    it.each([
        { error: { message: 'Access denied' }, js: { id: 7 } },
        { js: { error: { message: 'Access denied' }, id: 7 } },
    ])('rejects structured profile failure indicators', (value) => {
        expect(classifyStalkerProfile(value)).toEqual({
            kind: 'failure',
            reason: 'incompatible-response',
        });
        expect(
            classifyStalkerResponseFailure({
                httpStatus: 200,
                value,
            })
        ).toEqual({
            kind: 'failure',
            reason: 'incompatible-response',
        });
    });

    it('rejects a failure indicator before accepting profile status 0', () => {
        expect(
            classifyStalkerProfile({
                js: { error: 'Access denied', id: 7, status: 0 },
            })
        ).toEqual({
            kind: 'failure',
            reason: 'incompatible-response',
        });
    });

    it.each([
        { js: { id: 7, status: 3 } },
        { js: { status: 'unknown' } },
        { status: 0 },
        { js: { unrelated: true } },
    ])('rejects unknown status or unsupported envelopes', (value) => {
        expect(classifyStalkerProfile(value)).toEqual({
            kind: 'failure',
            reason: 'incompatible-response',
        });
    });

    it('requires canonical boolean do_auth outcomes', () => {
        expect(classifyStalkerDoAuth({ js: true })).toEqual({
            kind: 'success',
        });
        expect(classifyStalkerDoAuth({ js: false })).toEqual({
            kind: 'credentials-rejected',
        });
        expect(classifyStalkerDoAuth({ js: 1 })).toEqual({
            kind: 'failure',
            reason: 'incompatible-response',
        });
        expect(classifyStalkerDoAuth({ js: 'true' })).toEqual({
            kind: 'failure',
            reason: 'incompatible-response',
        });
    });

    it('keeps token rejection, access denial, WAF, and ambiguous 403 distinct', () => {
        expect(
            classifyStalkerResponseFailure({
                httpStatus: 401,
                value: { js: { error: 'ignored' } },
            })
        ).toEqual({ kind: 'token-rejected' });
        expect(
            classifyStalkerResponseFailure({
                httpStatus: 200,
                value: { js: { error: 'Authorization failed' } },
            })
        ).toEqual({ kind: 'token-rejected' });
        expect(
            classifyStalkerResponseFailure({
                httpStatus: 200,
                value: { js: { error: 'Access denied' } },
            })
        ).toEqual({
            kind: 'failure',
            reason: 'account-access-denied',
        });
        expect(
            classifyStalkerResponseFailure({
                httpStatus: 403,
                rawBody: '<html>Cloudflare challenge</html>',
            })
        ).toEqual({
            kind: 'failure',
            reason: 'portal-protection-blocked',
        });
        expect(
            classifyStalkerResponseFailure({
                httpStatus: 403,
                value: { js: { error: 'Forbidden' } },
            })
        ).toEqual({
            kind: 'failure',
            reason: 'incompatible-response',
        });
    });

    it('gives recognized 403 protection evidence precedence over token text', () => {
        expect(
            classifyStalkerResponseFailure({
                httpStatus: 403,
                rawBody: '<html>Cloudflare challenge</html>',
                value: { js: { error: 'Authorization failed' } },
            })
        ).toEqual({
            kind: 'failure',
            reason: 'portal-protection-blocked',
        });
    });

    it.each([
        [
            429,
            {
                kind: 'failure',
                reason: 'rate-limited',
            },
        ],
        [
            503,
            {
                kind: 'failure',
                reason: 'portal-unavailable',
            },
        ],
        [404, { kind: 'none' }],
    ])(
        'gives HTTP status %i precedence over an authorization error body',
        (httpStatus, expected) => {
            expect(
                classifyStalkerResponseFailure({
                    httpStatus,
                    value: { js: { error: 'Authorization failed' } },
                })
            ).toEqual(expected);
        }
    );

    it.each([
        ['Authorization failed', { kind: 'token-rejected' }],
        ['Access denied', { kind: 'failure', reason: 'account-access-denied' }],
    ])('classifies the canonical error %s on HTTP 403', (error, expected) => {
        expect(
            classifyStalkerResponseFailure({
                httpStatus: 403,
                value: { js: { error } },
            })
        ).toEqual(expected);
    });

    it('ignores a normal raw JSON body when a parsed response value exists', () => {
        expect(
            classifyStalkerResponseFailure({
                httpStatus: 200,
                rawBody: '{"js":{"status":0}}',
                value: { js: { status: 0 } },
            })
        ).toEqual({ kind: 'none' });
    });

    it('accepts the empty error field returned by successful create_link responses', () => {
        expect(
            classifyStalkerResponseFailure({
                httpStatus: 200,
                value: {
                    js: {
                        cmd: 'ffmpeg http://media.invalid/movie.ts',
                        error: '',
                        load: '',
                    },
                },
            })
        ).toEqual({ kind: 'none' });
    });

    it.each([
        ['Authorization failed', { kind: 'token-rejected' }],
        ['Access denied', { kind: 'failure', reason: 'account-access-denied' }],
    ])('recognizes the exact plain error body %s', (rawBody, expected) => {
        expect(
            classifyStalkerResponseFailure({
                httpStatus: 200,
                rawBody,
            })
        ).toEqual(expected);
    });

    it.each(['Authorization failed.', 'Access denied.'])(
        'rejects the noncanonical error variant %s',
        (error) => {
            expect(
                classifyStalkerResponseFailure({
                    httpStatus: 200,
                    value: { js: { error } },
                })
            ).toEqual({
                kind: 'failure',
                reason: 'incompatible-response',
            });
        }
    );

    it.each(['application/json', 'text/json; charset=utf-8'])(
        'accepts JSON for %s',
        (contentType) => {
            expect(
                parseStalkerResponseEnvelope({
                    body: '{"js":{"status":0}}',
                    contentType,
                    maxBodyBytes: 1024,
                })
            ).toEqual({
                format: 'json',
                kind: 'parsed',
                value: { js: { status: 0 } },
            });
        }
    );

    it('accepts only an allowlisted JSONP callback for JavaScript media', () => {
        expect(
            parseStalkerResponseEnvelope({
                body: 'callback({"js":{"status":0}});',
                contentType: 'application/javascript',
                maxBodyBytes: 1024,
            })
        ).toMatchObject({ format: 'jsonp', kind: 'parsed' });
        expect(
            parseStalkerResponseEnvelope({
                body: 'evil({"js":{"status":0}});',
                contentType: 'application/javascript',
                maxBodyBytes: 1024,
            })
        ).toEqual({
            kind: 'failure',
            reason: 'incompatible-response',
        });
    });

    it.each([undefined, 'text/plain; charset=utf-8'])(
        'uses bounded compatibility sniffing for %s',
        (contentType) => {
            expect(
                parseStalkerResponseEnvelope({
                    body: '{"js":{"status":0}}',
                    contentType,
                    maxBodyBytes: 1024,
                })
            ).toMatchObject({ format: 'json', kind: 'parsed' });
        }
    );

    it('rejects HTML media even when its body is valid JSON', () => {
        expect(
            parseStalkerResponseEnvelope({
                body: '{"js":{"status":0}}',
                contentType: 'text/html',
                maxBodyBytes: 1024,
            })
        ).toEqual({
            kind: 'failure',
            reason: 'incompatible-response',
        });
    });

    it('rejects a body before parsing when it crosses the operation cap', () => {
        expect(
            parseStalkerResponseEnvelope({
                body: '{"js":{"status":0}}',
                contentType: 'application/json',
                maxBodyBytes: 4,
            })
        ).toEqual({
            kind: 'failure',
            reason: 'response-too-large',
        });
    });
});
