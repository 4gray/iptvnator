import { signal } from '@angular/core';
import type { ExternalPlayerSession } from '@iptvnator/shared/interfaces';
import { replaceOwnedExternalSession } from './replace-owned-external-session';

function session(
    overrides: Partial<ExternalPlayerSession> = {}
): ExternalPlayerSession {
    return {
        id: 'mpv-1',
        player: 'mpv',
        status: 'opened',
        canClose: true,
        contentInfo: {
            playlistId: 'portal-1',
            contentXtreamId: 42,
            contentType: 'vod',
        },
        ...overrides,
    } as ExternalPlayerSession;
}

describe('replaceOwnedExternalSession', () => {
    function playback(active: ExternalPlayerSession | null) {
        return {
            activeSession: signal(active),
            closeSession: jest.fn().mockResolvedValue(undefined),
        };
    }

    it('closes the owned session and reports the replacement as safe', async () => {
        const running = session();
        const external = playback(running);
        await expect(
            replaceOwnedExternalSession(
                external,
                (info) => info.contentXtreamId === 42
            )
        ).resolves.toBe(true);
        expect(external.closeSession).toHaveBeenCalledWith(running);
    });

    it('leaves a session the page does not own alone', async () => {
        const external = playback(session());
        await expect(
            replaceOwnedExternalSession(
                external,
                (info) => info.contentXtreamId === 7
            )
        ).resolves.toBe(true);
        expect(external.closeSession).not.toHaveBeenCalled();
    });

    it('cancels the replacement when the close fails', async () => {
        const external = playback(session());
        external.closeSession.mockRejectedValue(new Error('busy'));
        const warn = jest.fn();
        await expect(
            replaceOwnedExternalSession(external, () => true, warn)
        ).resolves.toBe(false);
        expect(warn).toHaveBeenCalledTimes(1);
    });
});
