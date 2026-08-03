import {
    InlinePlaybackPlayer,
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
} from './playback-diagnostics.model';
import { createPlaybackSourceMetadata } from './playback-diagnostics.util';
import {
    classifyShakaPlaybackIssue,
    createUnsupportedDrmDiagnostic,
} from './shaka-error-classifier';

interface StructuredShakaDiagnostic {
    readonly code: string;
    readonly details?: string;
    readonly httpStatus?: number;
    readonly shaka?: {
        readonly severity: string;
        readonly category: string;
        readonly engineCode: number | string;
        readonly disposition: string;
        readonly stage: string;
        readonly failure: string;
        readonly httpStatus?: number;
    };
}

type StructuredClassifier = (
    error: Record<string, unknown> | null | undefined,
    sourceMetadata: typeof metadata,
    disposition: 'terminal' | 'recoverable'
) => StructuredShakaDiagnostic | null;

const metadata = createPlaybackSourceMetadata({
    url: 'http://example.com/stream.mpd',
    mimeType: 'application/dash+xml',
    player: InlinePlaybackPlayer.Html5,
});

const classify = classifyShakaPlaybackIssue as StructuredClassifier;

describe('classifyShakaPlaybackIssue', () => {
    it.each([
        ['DRM category/code pair', { severity: 2, category: 6, code: 6001 }],
        ['manifest key-system code', { severity: 2, category: 4, code: 4008 }],
    ])('maps exact %s to DrmOrEncryption', (_label, error) => {
        const issue = classify(error, metadata, 'terminal');
        expect(issue).not.toBeNull();
        expect(issue?.code).toBe(PlaybackDiagnosticCode.DrmOrEncryption);
        expect(issue?.shaka?.failure).toBe('drm');
    });

    it('maps an exact terminal network error and retains only safe status evidence', () => {
        const issue = classify(
            {
                severity: 1,
                category: 1,
                code: 1001,
                message:
                    'Blocked by CORS at https://provider.example/?token=secret',
                data: [
                    'https://provider.example/manifest.mpd?token=secret',
                    503,
                    'provider response secret',
                    { Authorization: 'Bearer secret' },
                ],
            },
            metadata,
            'terminal'
        );

        expect(issue).toEqual(
            expect.objectContaining({
                code: PlaybackDiagnosticCode.NetworkError,
                source: PlaybackDiagnosticSource.Shaka,
                httpStatus: 503,
                details: undefined,
                shaka: {
                    severity: 'recoverable',
                    category: 'network',
                    engineCode: 1001,
                    disposition: 'terminal',
                    stage: 'unknown',
                    failure: 'network',
                    httpStatus: 503,
                },
            })
        );
        const serialized = JSON.stringify(issue);
        expect(serialized).not.toContain('secret');
        expect(serialized).not.toContain('provider.example');
        expect(serialized).not.toContain('Authorization');
        expect(serialized).not.toContain('response');
    });

    it.each([3014, 3015, 3016])(
        'maps exact media pipeline code %s to MediaDecodeError',
        (code) => {
            const issue = classify(
                { severity: 2, category: 3, code },
                metadata,
                'terminal'
            );
            expect(issue?.code).toBe(PlaybackDiagnosticCode.MediaDecodeError);
        }
    );

    it('maps only the exact DASH unsupported-container code to UnsupportedContainer', () => {
        const issue = classify(
            { severity: 2, category: 4, code: 4006 },
            metadata,
            'terminal'
        );
        expect(issue?.code).toBe(PlaybackDiagnosticCode.UnsupportedContainer);
    });

    it.each([
        [
            'manifest parsing',
            { severity: 2, category: 4, code: 4001 },
            'manifest',
        ],
        [
            'ambiguous browser content support',
            { severity: 2, category: 4, code: 4032 },
            'media',
        ],
        [
            'ambiguous restrictions',
            { severity: 2, category: 4, code: 4012 },
            'unknown',
        ],
        [
            'generic media parsing',
            { severity: 2, category: 3, code: 3005 },
            'media',
        ],
        [
            'mismatched category/code pair',
            { severity: 2, category: 1, code: 6001 },
            'unknown',
        ],
        [
            'mismatched media code pair',
            { severity: 2, category: 1, code: 3014 },
            'unknown',
        ],
        [
            'mismatched container code pair',
            { severity: 2, category: 3, code: 4006 },
            'unknown',
        ],
        [
            'provider extension values',
            { severity: 3, category: 11, code: 123456 },
            'unknown',
        ],
    ])(
        'keeps %s as UnknownPlaybackError with structured failure=%s',
        (_label, error, failure) => {
            const issue = classify(
                {
                    ...error,
                    message:
                        'CORS codec DRM unsupported container license request',
                    data: [{ provider: 'secret-payload' }],
                },
                metadata,
                'terminal'
            );

            expect(issue?.code).toBe(
                PlaybackDiagnosticCode.UnknownPlaybackError
            );
            expect(issue?.shaka?.failure).toBe(failure);
            expect(issue?.details).toBeUndefined();
        }
    );

    it('does not turn a recoverable Shaka event into a terminal diagnostic', () => {
        const issue = classify(
            { severity: 1, category: 1, code: 1002 },
            metadata,
            'recoverable'
        );
        expect(issue).toBeNull();
    });

    it('creates unknown structured evidence when no public Shaka error is available', () => {
        const issue = classify(null, metadata, 'terminal');
        expect(issue).toEqual(
            expect.objectContaining({
                code: PlaybackDiagnosticCode.UnknownPlaybackError,
                details: undefined,
                shaka: {
                    severity: 'unknown',
                    category: 'unknown',
                    engineCode: 'unknown',
                    disposition: 'terminal',
                    stage: 'unknown',
                    failure: 'unknown',
                },
            })
        );
    });
});

describe('createUnsupportedDrmDiagnostic', () => {
    it('creates a safe DRM diagnostic without echoing provider license data', () => {
        const secret = 'unsupported-drm-secret';
        const issue = createUnsupportedDrmDiagnostic(
            `https://provider.example/license?token=${secret}`,
            metadata
        );
        expect(issue.code).toBe(PlaybackDiagnosticCode.DrmOrEncryption);
        expect(issue.source).toBe(PlaybackDiagnosticSource.Shaka);
        expect(issue.details).toBe('Unsupported DRM license configuration');
        expect(JSON.stringify(issue)).not.toContain(secret);
        expect(JSON.stringify(issue)).not.toContain('provider.example');
        // MPV/VLC cannot receive KODIPROP license config, so the diagnostic
        // must not offer them as a fallback.
        expect(issue.externalFallbackRecommended).toBe(false);
    });
});
