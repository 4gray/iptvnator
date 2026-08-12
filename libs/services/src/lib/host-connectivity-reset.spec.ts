import { CONNECTIVITY_GUARD_RESET } from '@iptvnator/shared/interfaces';
import { resetHostConnectivityGuard } from './host-connectivity-reset';

describe('resetHostConnectivityGuard', () => {
    let sendIpcEvent: jest.Mock;

    beforeEach(() => {
        sendIpcEvent = jest.fn().mockResolvedValue({ success: true });
    });

    it('asks the main process to forget the failures recorded for the host', async () => {
        await resetHostConnectivityGuard(
            { sendIpcEvent },
            'http://portal.example:8080'
        );

        expect(sendIpcEvent).toHaveBeenCalledWith(CONNECTIVITY_GUARD_RESET, {
            url: 'http://portal.example:8080',
        });
    });

    it.each([undefined, null, ''])(
        'sends nothing when there is no URL to reset (%p)',
        async (url) => {
            // A playlist can be missing its address entirely; there is no host
            // to clear then, and an empty reset would be a pointless round-trip.
            await resetHostConnectivityGuard({ sendIpcEvent }, url);

            expect(sendIpcEvent).not.toHaveBeenCalled();
        }
    );

    it('never propagates a transport failure to the caller', async () => {
        // The guard only ever delays a request, so a failed reset must not
        // block the retry, discovery run or status check that asked for it.
        sendIpcEvent.mockRejectedValue(new Error('IPC unavailable'));

        await expect(
            resetHostConnectivityGuard({ sendIpcEvent }, 'http://x.example')
        ).resolves.toBeUndefined();
    });

    it('tolerates the PWA no-op, where the channel is unknown', async () => {
        // PwaService.sendIpcEvent returns undefined synchronously for channels
        // it does not implement; nothing there records per-host failures yet.
        sendIpcEvent.mockReturnValue(undefined);

        await expect(
            resetHostConnectivityGuard({ sendIpcEvent }, 'http://x.example')
        ).resolves.toBeUndefined();
    });
});
