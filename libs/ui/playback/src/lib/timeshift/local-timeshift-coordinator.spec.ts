import { TestBed } from '@angular/core/testing';
import type {
    ElectronBridgeApi,
    LocalTimeshiftSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { LocalTimeshiftCoordinator } from './local-timeshift-coordinator';

const sourcePlayback: ResolvedPortalPlayback = {
    streamUrl: 'https://provider.example/live.ts',
    title: 'Live news',
    isLive: true,
    headers: { Authorization: 'Bearer secret' },
    userAgent: 'IPTVnator test',
};

const settings = {
    enabled: true,
    maxDurationMinutes: 30,
    bufferDirectory: '',
};

function session(id = 'timeshift-1'): LocalTimeshiftSession {
    return {
        id,
        playbackUrl: `http://127.0.0.1:43100/${id}/index.m3u8`,
        status: 'ready',
        maxDurationSeconds: 1800,
        bufferedDurationSeconds: 4,
        bytesUsed: 1024,
        startedAt: '2026-07-15T10:00:00.000Z',
        updatedAt: '2026-07-15T10:00:04.000Z',
    };
}

async function flushPromises(): Promise<void> {
    for (let i = 0; i < 8; i++) {
        await Promise.resolve();
    }
}

describe('LocalTimeshiftCoordinator', () => {
    const originalElectron = window.electron;
    let bridge: {
        getLocalTimeshiftSupport: jest.Mock;
        startLocalTimeshift: jest.Mock;
        stopLocalTimeshift: jest.Mock;
        onLocalTimeshiftSessionUpdate: jest.Mock;
    };

    beforeEach(() => {
        bridge = {
            getLocalTimeshiftSupport: jest
                .fn()
                .mockResolvedValue({ supported: true, engine: 'ffmpeg' }),
            startLocalTimeshift: jest.fn().mockResolvedValue(session()),
            stopLocalTimeshift: jest.fn().mockResolvedValue(null),
            onLocalTimeshiftSessionUpdate: jest.fn(() => jest.fn()),
        };
        window.electron = bridge as unknown as ElectronBridgeApi;
        TestBed.configureTestingModule({
            providers: [LocalTimeshiftCoordinator],
        });
    });

    afterEach(() => {
        TestBed.resetTestingModule();
        window.electron = originalElectron;
    });

    it('waits for the local playlist and strips provider headers from playback', async () => {
        const coordinator = TestBed.inject(LocalTimeshiftCoordinator);

        coordinator.configure(sourcePlayback, settings, true);

        expect(coordinator.status()).toBe('starting');
        expect(coordinator.playback()).toBeNull();

        await flushPromises();

        expect(bridge.startLocalTimeshift).toHaveBeenCalledWith({
            playback: sourcePlayback,
            maxDurationMinutes: 30,
            bufferDirectory: undefined,
        });
        expect(coordinator.status()).toBe('ready');
        expect(coordinator.playback()).toEqual({
            ...sourcePlayback,
            streamUrl: session().playbackUrl,
            headers: undefined,
            userAgent: undefined,
            referer: undefined,
            origin: undefined,
        });
    });

    it('does not start for catch-up playback', async () => {
        const coordinator = TestBed.inject(LocalTimeshiftCoordinator);
        const catchup = { ...sourcePlayback, isLive: false };

        coordinator.configure(catchup, settings, true);
        await flushPromises();

        expect(bridge.getLocalTimeshiftSupport).not.toHaveBeenCalled();
        expect(bridge.startLocalTimeshift).not.toHaveBeenCalled();
        expect(coordinator.playback()).toEqual(catchup);
    });

    it('does not send a superseded start after a rapid channel change', async () => {
        const stopResolvers: Array<() => void> = [];
        bridge.stopLocalTimeshift.mockImplementation(
            () =>
                new Promise<null>((resolve) =>
                    stopResolvers.push(() => resolve(null))
                )
        );
        const coordinator = TestBed.inject(LocalTimeshiftCoordinator);

        coordinator.configure(sourcePlayback, settings, true);
        await flushPromises();
        coordinator.configure(
            {
                ...sourcePlayback,
                streamUrl: 'https://provider.example/second.ts',
            },
            settings,
            true
        );
        await flushPromises();

        stopResolvers.forEach((resolve) => resolve());
        await flushPromises();

        expect(bridge.startLocalTimeshift).toHaveBeenCalledTimes(1);
        expect(bridge.startLocalTimeshift).toHaveBeenCalledWith(
            expect.objectContaining({
                playback: expect.objectContaining({
                    streamUrl: 'https://provider.example/second.ts',
                }),
            })
        );
        expect(coordinator.status()).toBe('ready');
    });

    it('retries the support probe after a transient failure', async () => {
        bridge.getLocalTimeshiftSupport
            .mockRejectedValueOnce(new Error('IPC unavailable'))
            .mockResolvedValueOnce({ supported: true, engine: 'ffmpeg' });
        const coordinator = TestBed.inject(LocalTimeshiftCoordinator);

        coordinator.configure(sourcePlayback, settings, true);
        await flushPromises();

        expect(coordinator.status()).toBe('error');
        expect(coordinator.playback()).toEqual(sourcePlayback);

        const secondPlayback = {
            ...sourcePlayback,
            streamUrl: 'https://provider.example/second.ts',
        };
        coordinator.configure(secondPlayback, settings, true);
        await flushPromises();

        expect(bridge.getLocalTimeshiftSupport).toHaveBeenCalledTimes(2);
        expect(coordinator.status()).toBe('ready');
        expect(coordinator.playback()?.streamUrl).toBe(session().playbackUrl);
    });

    it('stops a stale session that resolves after a channel change', async () => {
        let resolveFirst!: (value: LocalTimeshiftSession) => void;
        bridge.startLocalTimeshift
            .mockImplementationOnce(
                () =>
                    new Promise<LocalTimeshiftSession>((resolve) => {
                        resolveFirst = resolve;
                    })
            )
            .mockResolvedValueOnce(session('timeshift-2'));
        const coordinator = TestBed.inject(LocalTimeshiftCoordinator);

        coordinator.configure(sourcePlayback, settings, true);
        await flushPromises();
        coordinator.configure(
            {
                ...sourcePlayback,
                streamUrl: 'https://provider.example/second.ts',
            },
            settings,
            true
        );
        await flushPromises();

        expect(bridge.stopLocalTimeshift).toHaveBeenCalledWith(undefined);
        resolveFirst(session('timeshift-1'));
        await flushPromises();

        expect(bridge.stopLocalTimeshift).toHaveBeenCalledWith('timeshift-1');
        expect(coordinator.playback()?.streamUrl).toBe(
            session('timeshift-2').playbackUrl
        );
    });
});
