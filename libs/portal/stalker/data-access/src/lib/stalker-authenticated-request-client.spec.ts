import type { DataService } from '@iptvnator/services';
import { Playlist } from '@iptvnator/shared/interfaces';
import { StalkerAuthenticatedRequestClient } from './stalker-authenticated-request-client';
import { StalkerTokenCache } from './stalker-token-cache';

it.each(['body', 'http'])(
    'preserves silent EPG transport through %s auth renewal',
    async (failure) => {
        const sendIpcEvent = jest.fn();
        if (failure === 'body') {
            sendIpcEvent.mockResolvedValueOnce('Authorization failed.');
        } else {
            sendIpcEvent.mockRejectedValueOnce({ status: 401 });
        }
        sendIpcEvent.mockResolvedValueOnce({ js: [] });
        const client = new StalkerAuthenticatedRequestClient(
            { sendIpcEvent } as unknown as DataService,
            new StalkerTokenCache(),
            jest.fn().mockResolvedValue({ token: 'token' }),
            jest.fn()
        );
        await client.request(
            {
                _id: 'portal',
                portalUrl: 'https://example.test/server/load.php',
                isFullStalkerPortal: true,
            } as Playlist,
            { action: 'get_short_epg' },
            true,
            { silent: true }
        );
        expect(sendIpcEvent).toHaveBeenCalledTimes(2);
        for (const [, payload] of sendIpcEvent.mock.calls) {
            expect(payload.silent).toBe(true);
        }
    }
);
