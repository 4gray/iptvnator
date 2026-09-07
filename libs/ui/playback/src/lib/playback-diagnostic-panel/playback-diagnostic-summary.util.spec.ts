import {
    createUnsupportedDrmDiagnostic,
    createPlaybackSourceMetadata,
    classifyShakaPlaybackIssue,
    type PlaybackDiagnostic,
} from '@iptvnator/playback/util';
import { getDiagnosticDescriptionKey } from './playback-diagnostic-view.util';

const metadata = createPlaybackSourceMetadata({
    url: 'https://private.test/live.mpd',
});
function shaka(code: number, category = 6): PlaybackDiagnostic {
    const result = classifyShakaPlaybackIssue(
        { code, category, severity: 2 },
        metadata,
        'terminal'
    );
    if (!result) throw new Error('Expected terminal diagnostic');
    return result;
}
const description = (issue: PlaybackDiagnostic) =>
    getDiagnosticDescriptionKey(issue, false, false);

describe('evidence-backed diagnostic summaries', () => {
    it('explains an explicitly unsupported app DRM configuration', () => {
        expect(
            description(
                createUnsupportedDrmDiagnostic('com.widevine.alpha', metadata)
            )
        ).toBe('PLAYBACK_DIAGNOSTICS.DRM_CONFIGURATION_UNSUPPORTED');
    });
    it.each([
        [6001, 'DRM_CONFIGURATION_UNAVAILABLE'],
        [6007, 'LICENSE_REQUEST_FAILED'],
        [6008, 'LICENSE_RESPONSE_REJECTED'],
        [6012, 'LICENSE_SERVER_MISSING'],
    ])('explains Shaka DRM code %s', (code, key) => {
        expect(description(shaka(code))).toBe(`PLAYBACK_DIAGNOSTICS.${key}`);
    });
    it('does not infer unsupported DRM from the manifest or arbitrary message', () => {
        expect(
            description({
                ...shaka(6002),
                drmSystems: ['widevine'],
                details: 'Unsupported DRM license configuration',
            })
        ).toBe('PLAYBACK_DIAGNOSTICS.DRM_OR_ENCRYPTION.DESCRIPTION');
    });
    it('explains access refusal only for a confirmed segment request', () => {
        const result = classifyShakaPlaybackIssue(
            {
                code: 1001,
                category: 1,
                severity: 2,
                data: ['secret', 403, 'body', {}, 1],
            },
            metadata,
            'terminal'
        );
        if (!result) throw new Error('Expected terminal diagnostic');
        expect(description(result)).toBe(
            'PLAYBACK_DIAGNOSTICS.SEGMENT_ACCESS_DENIED'
        );
        expect(description({ ...result, shaka: undefined })).toBe(
            'PLAYBACK_DIAGNOSTICS.NETWORK_ERROR.DESCRIPTION'
        );
    });
});
