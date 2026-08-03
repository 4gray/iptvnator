import mpegts from 'mpegts.js';
import {
    InlinePlaybackPlayer,
    PlaybackDiagnosticCode,
    classifyMpegTsPlaybackIssue,
    createPlaybackSourceMetadata,
} from './playback-diagnostics.util';
import {
    MpegTsPlaybackEngineDetails,
    MpegTsPlaybackEngineType,
} from './mpegts-playback-evidence.model';
import {
    MPEGTS_DIAGNOSTIC_VERSION,
    createMpegTsPlaybackEvidence,
} from './mpegts-playback-evidence.util';

const METADATA = createPlaybackSourceMetadata({
    url: 'https://example.test/live.ts',
    mimeType: 'video/mp2t',
    player: InlinePlaybackPlayer.VideoJs,
});

describe('mpegts.js playback evidence', () => {
    it('locks the accepted public contract to mpegts.js 1.8.0', () => {
        expect(mpegts.version).toBe(MPEGTS_DIAGNOSTIC_VERSION);
        expect(mpegts.ErrorTypes).toEqual({
            NETWORK_ERROR: MpegTsPlaybackEngineType.Network,
            MEDIA_ERROR: MpegTsPlaybackEngineType.Media,
            OTHER_ERROR: MpegTsPlaybackEngineType.Other,
        });
        expect(mpegts.ErrorDetails).toEqual({
            NETWORK_EXCEPTION:
                MpegTsPlaybackEngineDetails.NetworkException,
            NETWORK_STATUS_CODE_INVALID:
                MpegTsPlaybackEngineDetails.HttpStatusCodeInvalid,
            NETWORK_TIMEOUT: MpegTsPlaybackEngineDetails.ConnectingTimeout,
            NETWORK_UNRECOVERABLE_EARLY_EOF:
                MpegTsPlaybackEngineDetails.UnrecoverableEarlyEof,
            MEDIA_MSE_ERROR: MpegTsPlaybackEngineDetails.MediaMseError,
            MEDIA_FORMAT_ERROR: MpegTsPlaybackEngineDetails.FormatError,
            MEDIA_FORMAT_UNSUPPORTED:
                MpegTsPlaybackEngineDetails.FormatUnsupported,
            MEDIA_CODEC_UNSUPPORTED:
                MpegTsPlaybackEngineDetails.CodecUnsupported,
        });
    });

    it.each([
        [
            'NetworkError',
            'HttpStatusCodeInvalid',
            'loader',
            'http',
        ],
        ['NetworkError', 'ConnectingTimeout', 'loader', 'timeout'],
        ['NetworkError', 'Exception', 'loader', 'network'],
        [
            'NetworkError',
            'UnrecoverableEarlyEof',
            'loader',
            'truncated-stream',
        ],
        ['MediaError', 'FormatError', 'demux', 'format'],
        ['MediaError', 'FormatUnsupported', 'demux', 'format'],
        ['MediaError', 'CodecUnsupported', 'demux', 'codec'],
        [
            'MediaError',
            'MediaMSEError',
            'media-source',
            'media-source',
        ],
    ])(
        'maps %s + %s to %s/%s',
        (engineType, engineDetails, stage, failure) => {
            expect(
                createMpegTsPlaybackEvidence(
                    engineType,
                    engineDetails,
                    undefined
                )
            ).toEqual({
                engineType,
                engineDetails,
                disposition: 'terminal',
                stage,
                failure,
            });
        }
    );

    it.each([
        ['OtherError', 'CodecUnsupported'],
        ['NetworkError', 'CodecUnsupported'],
        ['MediaError', 'ConnectingTimeout'],
        ['networkerror', 'HttpStatusCodeInvalid'],
        ['NetworkError', 'httpstatuscodeinvalid'],
        [{ type: 'NetworkError' }, 'Exception'],
        ['MediaError', { details: 'FormatError' }],
    ])('keeps inconsistent or malformed %p + %p evidence unknown', (type, details) => {
        const evidence = createMpegTsPlaybackEvidence(type, details, {
            code: 503,
        });

        expect(evidence.stage).toBe('unknown');
        expect(evidence.failure).toBe('unknown');
        expect(evidence.httpStatus).toBeUndefined();
    });

    it.each([399, 600, 404.5, '404', null, undefined])(
        'rejects invalid HTTP status %p',
        (code) => {
            const evidence = createMpegTsPlaybackEvidence(
                'NetworkError',
                'HttpStatusCodeInvalid',
                { code }
            );

            expect(evidence.httpStatus).toBeUndefined();
        }
    );

    it('reads HTTP status only from the exact top-level public slot', () => {
        expect(
            createMpegTsPlaybackEvidence(
                'NetworkError',
                'HttpStatusCodeInvalid',
                { code: 404 }
            ).httpStatus
        ).toBe(404);
        expect(
            createMpegTsPlaybackEvidence('NetworkError', 'Exception', {
                code: 503,
            }).httpStatus
        ).toBeUndefined();
        expect(
            createMpegTsPlaybackEvidence(
                'NetworkError',
                'HttpStatusCodeInvalid',
                { response: { code: 503 } }
            ).httpStatus
        ).toBeUndefined();
    });

    it('does not inspect or retain arbitrary engine information', () => {
        const secret = 'mpegts-info-secret';
        const circularInfo: Record<string, unknown> = {
            code: 404,
            msg: `Not Found ${secret}`,
            url: `https://provider.example/error?token=${secret}`,
            headers: { Authorization: secret },
        };
        circularInfo['self'] = circularInfo;

        const evidence = createMpegTsPlaybackEvidence(
            'NetworkError',
            'HttpStatusCodeInvalid',
            circularInfo
        );

        expect(evidence.httpStatus).toBe(404);
        expect(JSON.stringify(evidence)).not.toContain(secret);
        expect(JSON.stringify(evidence)).not.toContain('provider.example');
    });

    it.each([
        ['NetworkError', 'HttpStatusCodeInvalid', 'network-error', false],
        ['NetworkError', 'ConnectingTimeout', 'network-error', false],
        ['NetworkError', 'Exception', 'network-error', false],
        [
            'NetworkError',
            'UnrecoverableEarlyEof',
            'media-decode-error',
            true,
        ],
        ['MediaError', 'FormatError', 'media-decode-error', true],
        [
            'MediaError',
            'FormatUnsupported',
            'unsupported-container',
            true,
        ],
        [
            'MediaError',
            'CodecUnsupported',
            'unsupported-codec',
            true,
        ],
        ['MediaError', 'MediaMSEError', 'media-decode-error', true],
        ['OtherError', 'Exception', 'unknown-playback-error', false],
    ])(
        'classifies %s + %s as %s with fallback=%s',
        (type, details, code, externalFallbackRecommended) => {
            const issue = classifyMpegTsPlaybackIssue(
                createMpegTsPlaybackEvidence(type, details, undefined),
                METADATA
            );

            expect(issue.code).toBe(code);
            expect(issue.externalFallbackRecommended).toBe(
                externalFallbackRecommended
            );
            expect(issue.details).toBeUndefined();
        }
    );

    it('preserves an exact HTTP failure without retaining provider details', () => {
        const secret = 'mpegts-http-secret';
        const issue = classifyMpegTsPlaybackIssue(
            createMpegTsPlaybackEvidence(
                'NetworkError',
                'HttpStatusCodeInvalid',
                {
                    code: 404,
                    msg: `Not Found ${secret}`,
                    url: `https://provider.example/error?token=${secret}`,
                }
            ),
            METADATA
        );

        expect(issue).toEqual(
            expect.objectContaining({
                code: PlaybackDiagnosticCode.NetworkError,
                httpStatus: 404,
                mpegTs: expect.objectContaining({
                    engineType: 'NetworkError',
                    engineDetails: 'HttpStatusCodeInvalid',
                    disposition: 'terminal',
                    stage: 'loader',
                    failure: 'http',
                    httpStatus: 404,
                }),
                externalFallbackRecommended: false,
            })
        );
        expect(issue.details).toBeUndefined();
        expect(JSON.stringify(issue)).not.toContain(secret);
    });
});
