import {
    ErrorDetails,
    ErrorTypes,
    type ErrorData,
    type LoaderResponse,
} from 'hls.js';
import * as diagnostics from './playback-diagnostics.util';

interface ExpectedHlsPlaybackEvidence {
    readonly engineType: string;
    readonly engineDetails: string;
    readonly disposition: string;
    readonly stage: string;
    readonly failure: string;
    readonly httpStatus?: number;
}

type EvidenceFactory = (data: ErrorData) => ExpectedHlsPlaybackEvidence;

describe('HLS playback evidence', () => {
    it('extracts a fatal manifest HTTP failure from the hls.js response shape', () => {
        const evidence = createEvidence(
            createErrorData({
                type: ErrorTypes.NETWORK_ERROR,
                details: ErrorDetails.MANIFEST_LOAD_ERROR,
                response: createResponse(404),
            })
        );

        expect(evidence).toEqual({
            engineType: ErrorTypes.NETWORK_ERROR,
            engineDetails: ErrorDetails.MANIFEST_LOAD_ERROR,
            disposition: 'fatal',
            stage: 'manifest',
            failure: 'http',
            httpStatus: 404,
        });
    });

    it('extracts exact timeout and level-stage evidence', () => {
        const evidence = createEvidence(
            createErrorData({
                type: ErrorTypes.NETWORK_ERROR,
                details: ErrorDetails.LEVEL_LOAD_TIMEOUT,
            })
        );

        expect(evidence).toEqual({
            engineType: ErrorTypes.NETWORK_ERROR,
            engineDetails: ErrorDetails.LEVEL_LOAD_TIMEOUT,
            disposition: 'fatal',
            stage: 'level',
            failure: 'timeout',
        });
    });

    it('marks a non-fatal fragment load event as recoverable network evidence', () => {
        const evidence = createEvidence(
            createErrorData({
                type: ErrorTypes.NETWORK_ERROR,
                details: ErrorDetails.FRAG_LOAD_ERROR,
                fatal: false,
            })
        );

        expect(evidence).toEqual({
            engineType: ErrorTypes.NETWORK_ERROR,
            engineDetails: ErrorDetails.FRAG_LOAD_ERROR,
            disposition: 'recoverable',
            stage: 'segment',
            failure: 'network',
        });
    });

    it.each([
        {
            details: ErrorDetails.MANIFEST_PARSING_ERROR,
            stage: 'manifest',
        },
        { details: ErrorDetails.AUDIO_TRACK_LOAD_ERROR, stage: 'level' },
        { details: ErrorDetails.FRAG_DECRYPT_ERROR, stage: 'segment' },
        { details: ErrorDetails.KEY_LOAD_ERROR, stage: 'key' },
        { details: ErrorDetails.BUFFER_ADD_CODEC_ERROR, stage: 'media' },
        { details: ErrorDetails.INTERNAL_EXCEPTION, stage: 'unknown' },
    ])('maps $details to the exact $stage stage', ({ details, stage }) => {
        expect(createEvidence(createErrorData({ details })).stage).toBe(stage);
    });

    it('keeps a successful response status as evidence without calling it an HTTP failure', () => {
        const evidence = createEvidence(
            createErrorData({
                type: ErrorTypes.NETWORK_ERROR,
                details: ErrorDetails.MANIFEST_PARSING_ERROR,
                response: createResponse(200),
            })
        );

        expect(evidence.httpStatus).toBe(200);
        expect(evidence.failure).toBe('network');
    });

    it.each([
        { status: 99, expected: undefined },
        { status: 100, expected: 100 },
        { status: 599, expected: 599 },
        { status: 600, expected: undefined },
        { status: 404.5, expected: undefined },
    ])(
        'retains HTTP status $status only inside the protocol range',
        ({ status, expected }) => {
            const evidence = createEvidence(
                createErrorData({
                    response: createResponse(status),
                })
            );

            expect(evidence.httpStatus).toBe(expected);
        }
    );

    it('uses unknown for unrecognized runtime engine identifiers', () => {
        const evidence = createEvidence(
            createErrorData({
                type: 'providerNetworkCodecError' as ErrorTypes,
                details: 'providerStatusCodecFailure' as ErrorDetails,
            })
        );

        expect(evidence).toEqual({
            engineType: 'unknown',
            engineDetails: ErrorDetails.UNKNOWN,
            disposition: 'fatal',
            stage: 'unknown',
            failure: 'unknown',
        });
    });

    it('drops URLs, headers, bodies, credentials, and arbitrary provider payloads', () => {
        const secret = 'evidence-secret-sentinel';
        const evidence = createEvidence(
            createErrorData({
                type: ErrorTypes.NETWORK_ERROR,
                details: ErrorDetails.MANIFEST_LOAD_ERROR,
                error: new Error(`provider message ${secret}`),
                reason: `provider reason ${secret}`,
                url: `https://user:${secret}@provider.example/manifest.m3u8`,
                response: {
                    code: 503,
                    url: `https://provider.example/error?token=${secret}`,
                    text: `response text ${secret}`,
                    data: { body: secret },
                },
                context: {
                    url: `https://provider.example/context?token=${secret}`,
                    responseType: 'text',
                    headers: { Authorization: `Bearer ${secret}` },
                } as ErrorData['context'],
                networkDetails: {
                    responseURL: `https://provider.example/xhr?token=${secret}`,
                    responseText: secret,
                },
            })
        );
        const serialized = JSON.stringify(evidence);

        expect(evidence.httpStatus).toBe(503);
        expect(serialized).not.toContain(secret);
        expect(serialized).not.toContain('provider.example');
        expect(serialized).not.toContain('Authorization');
        expect(serialized).not.toContain('response text');
        expect(Object.keys(evidence).sort()).toEqual(
            [
                'disposition',
                'engineDetails',
                'engineType',
                'failure',
                'httpStatus',
                'stage',
            ].sort()
        );
    });
});

function createEvidence(data: ErrorData): ExpectedHlsPlaybackEvidence {
    const factory = (
        diagnostics as unknown as {
            readonly createHlsPlaybackEvidence?: EvidenceFactory;
        }
    ).createHlsPlaybackEvidence;

    expect(factory).toBeDefined();
    if (!factory) {
        throw new Error('createHlsPlaybackEvidence is not exported');
    }
    return factory(data);
}

function createErrorData(overrides: Partial<ErrorData> = {}): ErrorData {
    return {
        type: ErrorTypes.OTHER_ERROR,
        details: ErrorDetails.UNKNOWN,
        error: new Error('provider payload must not survive'),
        fatal: true,
        ...overrides,
    };
}

function createResponse(code: number): LoaderResponse {
    return {
        url: 'https://provider.example/response-must-not-survive',
        code,
    };
}
