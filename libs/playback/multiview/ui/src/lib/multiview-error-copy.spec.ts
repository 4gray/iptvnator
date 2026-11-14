import {
    type PlaybackDiagnostic,
    PlaybackDiagnosticCode,
} from '@iptvnator/playback/util';
import { multiviewErrorCopy } from './multiview-error-copy';

const diagnostic = (code: PlaybackDiagnostic['code']) =>
    ({ code }) as PlaybackDiagnostic;

describe('multiviewErrorCopy', () => {
    it('names a spent connection budget outright', () => {
        expect(
            multiviewErrorCopy(
                diagnostic(PlaybackDiagnosticCode.NetworkError),
                {
                    playlistName: 'Synthetic provider',
                    maxConnections: 1,
                    activeConnections: 1,
                }
            )
        ).toEqual({
            titleKey: 'PLAYER.MULTIVIEW.ERROR_LIMIT_TITLE',
            causeKey: 'PLAYER.MULTIVIEW.ERROR_LIMIT_CAUSE',
            params: { playlist: 'Synthetic provider', max: 1 },
        });
    });

    it.each([
        [PlaybackDiagnosticCode.NetworkError, 'ERROR_NETWORK_CAUSE'],
        [PlaybackDiagnosticCode.BrowserAccessError, 'ERROR_NETWORK_CAUSE'],
        [PlaybackDiagnosticCode.UnsupportedCodec, 'ERROR_FORMAT_CAUSE'],
        [PlaybackDiagnosticCode.DrmOrEncryption, 'ERROR_FORMAT_CAUSE'],
        [PlaybackDiagnosticCode.UnknownPlaybackError, 'ERROR_GENERIC_CAUSE'],
    ])('explains %s', (code, cause) => {
        expect(multiviewErrorCopy(diagnostic(code))).toEqual({
            titleKey: 'PLAYER.MULTIVIEW.ERROR_TITLE',
            causeKey: `PLAYER.MULTIVIEW.${cause}`,
            params: {},
        });
    });

    it('falls back to the diagnostic when the budget has room', () => {
        expect(
            multiviewErrorCopy(
                diagnostic(PlaybackDiagnosticCode.NetworkError),
                {
                    playlistName: 'Synthetic provider',
                    maxConnections: 2,
                    activeConnections: 1,
                }
            ).causeKey
        ).toBe('PLAYER.MULTIVIEW.ERROR_NETWORK_CAUSE');
    });

    it('has a generic cause without a diagnostic', () => {
        expect(multiviewErrorCopy(null).causeKey).toBe(
            'PLAYER.MULTIVIEW.ERROR_GENERIC_CAUSE'
        );
    });
});
