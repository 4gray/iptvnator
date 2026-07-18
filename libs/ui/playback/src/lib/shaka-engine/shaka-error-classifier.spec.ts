import {
    InlinePlaybackPlayer,
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
} from '../playback-diagnostics/playback-diagnostics.model';
import { createPlaybackSourceMetadata } from '../playback-diagnostics/playback-diagnostics.util';
import {
    classifyShakaPlaybackIssue,
    createUnsupportedDrmDiagnostic,
} from './shaka-error-classifier';

const metadata = createPlaybackSourceMetadata({
    url: 'http://example.com/stream.mpd',
    mimeType: 'application/dash+xml',
    player: InlinePlaybackPlayer.Html5,
});

describe('classifyShakaPlaybackIssue', () => {
    it.each([
        ['DRM category', { category: 6, code: 6001 }],
        ['restrictions-cannot-be-met', { category: 4, code: 4012 }],
        [
            'license keyword in message',
            { category: 5, code: 5001, message: 'license request failed' },
        ],
    ])('maps %s to DrmOrEncryption', (_label, error) => {
        const issue = classifyShakaPlaybackIssue(error, metadata);
        expect(issue.code).toBe(PlaybackDiagnosticCode.DrmOrEncryption);
        expect(issue.source).toBe(PlaybackDiagnosticSource.Shaka);
    });

    it('maps network category to NetworkError', () => {
        const issue = classifyShakaPlaybackIssue(
            { category: 1, code: 1001 },
            metadata
        );
        expect(issue.code).toBe(PlaybackDiagnosticCode.NetworkError);
    });

    it('maps CORS-flavored network failures to BrowserAccessError', () => {
        const issue = classifyShakaPlaybackIssue(
            { category: 1, code: 1002, message: 'Blocked by CORS policy' },
            metadata
        );
        expect(issue.code).toBe(PlaybackDiagnosticCode.BrowserAccessError);
    });

    it('maps media category to MediaDecodeError', () => {
        const issue = classifyShakaPlaybackIssue(
            { category: 3, code: 3016 },
            metadata
        );
        expect(issue.code).toBe(PlaybackDiagnosticCode.MediaDecodeError);
    });

    it('maps codec-flavored media failures to UnsupportedCodec', () => {
        const issue = classifyShakaPlaybackIssue(
            { category: 3, code: 3005, message: 'addCodec failed for hvc1' },
            metadata
        );
        expect(issue.code).toBe(PlaybackDiagnosticCode.UnsupportedCodec);
    });

    it('maps manifest category to UnsupportedContainer', () => {
        const issue = classifyShakaPlaybackIssue(
            { category: 4, code: 4001 },
            metadata
        );
        expect(issue.code).toBe(PlaybackDiagnosticCode.UnsupportedContainer);
    });

    it('falls back to UnknownPlaybackError and keeps details', () => {
        const issue = classifyShakaPlaybackIssue(
            { category: 7, code: 7002, message: 'boom' },
            metadata
        );
        expect(issue.code).toBe(PlaybackDiagnosticCode.UnknownPlaybackError);
        expect(issue.details).toContain('boom');
        expect(issue.details).toContain('7002');
    });

    it('tolerates missing error objects', () => {
        const issue = classifyShakaPlaybackIssue(null, metadata);
        expect(issue.code).toBe(PlaybackDiagnosticCode.UnknownPlaybackError);
    });
});

describe('createUnsupportedDrmDiagnostic', () => {
    it('creates a DRM diagnostic carrying the license type', () => {
        const issue = createUnsupportedDrmDiagnostic(
            'com.widevine.alpha',
            metadata
        );
        expect(issue.code).toBe(PlaybackDiagnosticCode.DrmOrEncryption);
        expect(issue.source).toBe(PlaybackDiagnosticSource.Shaka);
        expect(issue.details).toContain('com.widevine.alpha');
        expect(issue.externalFallbackRecommended).toBe(true);
    });
});
