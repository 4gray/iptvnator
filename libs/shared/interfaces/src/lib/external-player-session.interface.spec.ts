import {
    EXTERNAL_PLAYER_ERROR_KEYS,
    readExternalPlayerErrorCode,
    tagExternalPlayerError,
} from './external-player-session.interface';

describe('external player error codes', () => {
    it('reads the code back from a tagged message', () => {
        const message = tagExternalPlayerError(
            'start-failed',
            'Failed to start MPV player: spawn mpv ENOENT'
        );

        expect(readExternalPlayerErrorCode(new Error(message))).toBe(
            'start-failed'
        );
        expect(readExternalPlayerErrorCode(message)).toBe('start-failed');
    });

    it('survives the prefix Electron adds to a rejected IPC call', () => {
        const rejected = new Error(
            `Error invoking remote method 'OPEN_MPV_PLAYER': Error: ${tagExternalPlayerError(
                'previous-closing',
                'Cannot launch player'
            )}`
        );

        expect(readExternalPlayerErrorCode(rejected)).toBe('previous-closing');
    });

    it('returns null for untagged messages and unknown codes', () => {
        expect(readExternalPlayerErrorCode(new Error('boom'))).toBeNull();
        expect(
            readExternalPlayerErrorCode(
                '[iptvnator:external-player:not-a-code] boom'
            )
        ).toBeNull();
        expect(
            readExternalPlayerErrorCode(
                '[iptvnator:external-player:constructor]'
            )
        ).toBeNull();
        expect(readExternalPlayerErrorCode(null)).toBeNull();
        expect(readExternalPlayerErrorCode({ message: 42 })).toBeNull();
    });

    it('maps every code to a key in the EXTERNAL_PLAYER.ERRORS group', () => {
        for (const key of Object.values(EXTERNAL_PLAYER_ERROR_KEYS)) {
            expect(key).toMatch(/^EXTERNAL_PLAYER\.ERRORS\.[A-Z_]+$/);
        }
    });
});
