import { TestBed } from '@angular/core/testing';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import type { ElectronBridgeApi } from '@iptvnator/shared/interfaces';
import { RecordingService } from './recording.service';

describe('RecordingService', () => {
    const originalElectron = window.electron;
    let updateListener: (() => void) | undefined;
    let bridge: Partial<ElectronBridgeApi>;

    beforeEach(() => {
        bridge = {
            recordingsGetSupport: jest
                .fn()
                .mockResolvedValue({ supported: true }),
            recordingsGetList: jest.fn().mockResolvedValue([
                {
                    id: 'recording-1',
                    playlistId: 'playlist-1',
                    sourceType: 'xtream',
                    channelId: '42',
                    channelName: 'News',
                    title: 'Evening News',
                    scheduledStartAt: '2026-07-14T18:00:00.000Z',
                    scheduledEndAt: '2026-07-14T19:00:00.000Z',
                    paddingBeforeSeconds: 0,
                    paddingAfterSeconds: 0,
                    status: 'scheduled',
                },
            ]),
            recordingsSchedule: jest.fn().mockResolvedValue({ success: true }),
            recordingsCancel: jest.fn().mockResolvedValue({ success: true }),
            recordingsRemove: jest.fn().mockResolvedValue({ success: true }),
            recordingsPlayFile: jest.fn().mockResolvedValue({ success: true }),
            recordingsRevealFile: jest
                .fn()
                .mockResolvedValue({ success: true }),
            onRecordingsUpdate: jest.fn((listener) => {
                updateListener = listener;
                return jest.fn();
            }),
        };
        window.electron = bridge as ElectronBridgeApi;
        TestBed.configureTestingModule({
            providers: [
                RecordingService,
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsRecordings: true },
                },
            ],
        });
    });

    afterEach(() => {
        TestBed.resetTestingModule();
        window.electron = originalElectron;
    });

    it('loads support and the recording library, then refreshes on updates', async () => {
        const service = TestBed.inject(RecordingService);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(service.isAvailable()).toBe(true);
        expect(service.hasDesktopBridge()).toBe(true);
        expect(service.recordings()).toHaveLength(1);
        expect(service.activeCount()).toBe(1);

        updateListener?.();
        await Promise.resolve();
        expect(bridge.recordingsGetList).toHaveBeenCalledTimes(2);
    });

    it('disables scheduling when native recording is unsupported', async () => {
        (bridge.recordingsGetSupport as jest.Mock).mockResolvedValue({
            supported: false,
            reason: 'Native addon unavailable',
        });
        const service = TestBed.inject(RecordingService);
        await Promise.resolve();
        await Promise.resolve();

        expect(service.isAvailable()).toBe(false);
        expect(service.support()?.reason).toBe('Native addon unavailable');
        expect(service.recordings()).toHaveLength(1);
        expect(bridge.recordingsGetList).toHaveBeenCalled();
        await expect(service.schedule({} as never)).resolves.toEqual({
            success: false,
            error: 'Recordings are not available',
        });
        await expect(service.play('recording-1')).resolves.toEqual({
            success: true,
        });
    });

    it('stays unavailable until support is positively confirmed', () => {
        const service = TestBed.inject(RecordingService);

        expect(service.isAvailable()).toBe(false);
    });

    it('exposes a generic load failure and retries support discovery', async () => {
        (bridge.recordingsGetSupport as jest.Mock)
            .mockRejectedValueOnce(new Error('/private/VLC path failed'))
            .mockResolvedValueOnce({ supported: true });
        (bridge.recordingsGetList as jest.Mock).mockRejectedValueOnce(
            new Error('database path is private')
        );
        const service = TestBed.inject(RecordingService);
        await service.refresh();

        expect(service.isAvailable()).toBe(false);
        expect(service.error()).toBe('load');
        expect(service.error()).not.toContain('private');

        await service.refresh();
        expect(service.isAvailable()).toBe(true);
        expect(service.error()).toBeNull();
        expect(bridge.recordingsGetSupport).toHaveBeenCalledTimes(2);
    });

    it('shares concurrent retries and enters loading before support resolves', async () => {
        const service = TestBed.inject(RecordingService);
        await service.refresh();
        let resolveSupport!: (value: { supported: boolean }) => void;
        (bridge.recordingsGetSupport as jest.Mock).mockReturnValueOnce(
            new Promise((resolve) => {
                resolveSupport = resolve;
            })
        );

        const firstRetry = service.refresh();
        const secondRetry = service.refresh();

        expect(secondRetry).toBe(firstRetry);
        expect(service.isLoading()).toBe(true);
        expect(bridge.recordingsGetSupport).toHaveBeenCalledTimes(2);
        resolveSupport({ supported: true });
        await firstRetry;
    });

    it('converts bridge failures into action results', async () => {
        (bridge.recordingsCancel as jest.Mock).mockRejectedValue(
            new Error('IPC failed')
        );
        const service = TestBed.inject(RecordingService);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        await expect(service.cancel('recording-1')).resolves.toEqual({
            success: false,
            error: 'IPC failed',
        });
    });
});
