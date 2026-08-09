import type { Playlist } from '@iptvnator/shared/interfaces';
import type { createLogger } from '@iptvnator/portal/shared/util';
import { StalkerWatchdogController } from './stalker-watchdog.controller';

describe('StalkerWatchdogController', () => {
    const playlist = {
        _id: 'playlist-1',
        portalUrl: 'https://portal.example.com/stalker_portal/server/load.php',
        macAddress: '00:1A:79:AA:BB:CC',
        isFullStalkerPortal: true,
    } as Playlist;

    let sendRequest: jest.Mock;
    let readPersistedPlaylist: jest.Mock;
    let controller: StalkerWatchdogController;

    const logger = {
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
    } as unknown as ReturnType<typeof createLogger>;

    beforeEach(() => {
        jest.useFakeTimers();
        sendRequest = jest.fn().mockResolvedValue({ js: {} });
        // The row is the source of truth for each ping; specs that care
        // about mid-session edits override this per test.
        readPersistedPlaylist = jest.fn().mockResolvedValue(playlist);
        controller = new StalkerWatchdogController({
            sendRequest,
            readPersistedPlaylist,
            logger,
        });
    });

    afterEach(() => {
        controller.setActivePlaylist(null);
        jest.useRealTimers();
    });

    /** Lets the async sendPing settle between timer advances. */
    async function flush(): Promise<void> {
        await Promise.resolve();
        await Promise.resolve();
    }

    it('pings immediately with init=1, then every 120 s by default', async () => {
        controller.setActivePlaylist(playlist);
        await flush();

        expect(sendRequest).toHaveBeenCalledTimes(1);
        expect(sendRequest).toHaveBeenCalledWith(
            playlist,
            expect.objectContaining({
                action: 'get_events',
                type: 'watchdog',
                init: '1',
            })
        );

        // The legacy cadence was 25 s — nothing may fire that early.
        jest.advanceTimersByTime(25_000);
        await flush();
        expect(sendRequest).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(95_000);
        await flush();
        expect(sendRequest).toHaveBeenCalledTimes(2);
        expect(sendRequest.mock.calls[1][1]).toEqual(
            expect.objectContaining({ init: '0' })
        );
    });

    it('reschedules to the profile cadence with the timeslot offset', async () => {
        controller.setActivePlaylist(playlist);
        await flush();
        sendRequest.mockClear();

        controller.applyProfileTiming(playlist._id, {
            watchdogTimeoutSeconds: 90,
            timeslotSeconds: 10,
        });

        // Timeslot offset: nothing during the first 10 s...
        jest.advanceTimersByTime(9_000);
        await flush();
        expect(sendRequest).not.toHaveBeenCalled();

        // ...then the 90 s cadence starts.
        jest.advanceTimersByTime(91_000);
        await flush();
        expect(sendRequest).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(90_000);
        await flush();
        expect(sendRequest).toHaveBeenCalledTimes(2);
    });

    it('keeps the stored cadence when the watchdog restarts', async () => {
        controller.applyProfileTiming(playlist._id, {
            watchdogTimeoutSeconds: 60,
            timeslotSeconds: 0,
        });
        controller.setActivePlaylist(playlist);
        await flush();
        sendRequest.mockClear();

        jest.advanceTimersByTime(60_000);
        await flush();
        expect(sendRequest).toHaveBeenCalledTimes(1);
    });

    it('clamps a garbage watchdog_timeout instead of adopting it', async () => {
        controller.applyProfileTiming(playlist._id, {
            watchdogTimeoutSeconds: 1,
            timeslotSeconds: 0,
        });
        controller.setActivePlaylist(playlist);
        await flush();
        sendRequest.mockClear();

        // Clamped to the 30 s floor — a 1 s cadence would hammer the portal.
        jest.advanceTimersByTime(29_000);
        await flush();
        expect(sendRequest).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1_000);
        await flush();
        expect(sendRequest).toHaveBeenCalledTimes(1);
    });

    it('logs and continues when a ping fails — never retries or escalates', async () => {
        sendRequest.mockRejectedValue(new Error('portal down'));
        controller.setActivePlaylist(playlist);
        await flush();

        expect(logger.warn).toHaveBeenCalled();
        expect(sendRequest).toHaveBeenCalledTimes(1);

        // No immediate retry: the next attempt is the next scheduled tick.
        jest.advanceTimersByTime(119_000);
        await flush();
        expect(sendRequest).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(1_000);
        await flush();
        expect(sendRequest).toHaveBeenCalledTimes(2);
    });

    it('stops pinging when the active playlist is cleared', async () => {
        controller.setActivePlaylist(playlist);
        await flush();
        sendRequest.mockClear();

        controller.setActivePlaylist(null);
        jest.advanceTimersByTime(600_000);
        await flush();
        expect(sendRequest).not.toHaveBeenCalled();
    });

    it('never pings for a simple (non-full) portal', async () => {
        controller.setActivePlaylist({
            ...playlist,
            isFullStalkerPortal: false,
        } as Playlist);
        jest.advanceTimersByTime(600_000);
        await flush();
        expect(sendRequest).not.toHaveBeenCalled();
    });
});
