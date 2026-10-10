const send = jest.fn();

jest.mock('../app', () => ({
    __esModule: true,
    default: {
        mainWindow: {
            isDestroyed: () => false,
            webContents: { send: (...args: unknown[]) => send(...args) },
        },
    },
}));

import { readExternalPlayerErrorCode } from '@iptvnator/shared/interfaces';
import {
    buildPlayerStartError,
    classifyPlayerError,
    sendPlayerErrorNotification,
} from './external-player-runtime';

describe('external player error notifications', () => {
    beforeEach(() => send.mockClear());

    it.each([
        ['Failed to open https://example.test/live.m3u8', 'stream-open-failed'],
        ['Protocol not found', 'unsupported-protocol'],
        ['Connection refused', 'connection-failed'],
        ['HTTP error 403 Forbidden', 'access-denied'],
        ['HTTP error 404 Not Found', 'stream-not-found'],
        ['tcp: Timed out', 'timed-out'],
        ['some unrecognised output', null],
    ])('classifies %j as %s', (output, code) => {
        expect(classifyPlayerError(output)).toBe(code);
    });

    it('sends a code and the raw output instead of an English sentence', () => {
        sendPlayerErrorNotification('MPV', 'HTTP error 403 Forbidden');

        expect(send).toHaveBeenCalledWith('player-error', {
            player: 'MPV',
            code: 'access-denied',
            error: 'HTTP error 403 Forbidden',
        });
    });

    it('lets the caller name the code', () => {
        sendPlayerErrorNotification(
            'VLC',
            'VLC player closed unexpectedly (exit code: 1)',
            'closed-unexpectedly'
        );

        expect(send).toHaveBeenCalledWith(
            'player-error',
            expect.objectContaining({ code: 'closed-unexpectedly' })
        );
    });

    it('tags start failures so the renderer can translate the rejection', () => {
        const error = buildPlayerStartError('MPV', new Error('spawn ENOENT'), {
            mode: 'direct',
            playerPath: 'mpv',
            command: 'mpv',
            argsPrefix: [],
        });

        expect(readExternalPlayerErrorCode(error)).toBe('start-failed');
        expect(error.message).toContain(
            'Failed to start MPV player: spawn ENOENT'
        );
    });
});
