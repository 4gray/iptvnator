import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { DataService } from '@iptvnator/services';
import {
    ExternalPlayerSession,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import { SettingsStore } from './settings-store.service';
import { PlayerService } from './player.service';

describe('PlayerService', () => {
    let service: PlayerService;
    const dialog = {
        open: jest.fn(),
    };
    const dataService = {
        sendIpcEvent: jest.fn(),
    };
    const settingsStore = {
        player: jest.fn(() => VideoPlayer.VideoJs),
    };

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                PlayerService,
                {
                    provide: MatDialog,
                    useValue: dialog,
                },
                {
                    provide: DataService,
                    useValue: dataService,
                },
                {
                    provide: SettingsStore,
                    useValue: settingsStore,
                },
            ],
        });

        service = TestBed.inject(PlayerService);
        dialog.open.mockReset();
        dataService.sendIpcEvent.mockReset();
        settingsStore.player.mockReset();
        settingsStore.player.mockReturnValue(VideoPlayer.VideoJs);
    });

    it('identifies embedded players', () => {
        expect(service.isEmbeddedPlayer(VideoPlayer.VideoJs)).toBe(true);
        expect(service.isEmbeddedPlayer(VideoPlayer.Html5Player)).toBe(true);
        expect(service.isEmbeddedPlayer(VideoPlayer.ArtPlayer)).toBe(true);
        expect(service.isEmbeddedPlayer(VideoPlayer.EmbeddedMpv)).toBe(true);
        expect(service.isEmbeddedPlayer(VideoPlayer.MPV)).toBe(false);
        expect(service.isEmbeddedPlayer(VideoPlayer.VLC)).toBe(false);
    });

    it('does not open a dialog or IPC for embedded players', async () => {
        const result = await service.openResolvedPlayback({
            streamUrl: 'https://example.com/video.mp4',
            title: 'Example Video',
        });

        expect(result).toBeUndefined();
        expect(dialog.open).not.toHaveBeenCalled();
        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
    });

    it('forwards external playback launches through IPC', async () => {
        const session: ExternalPlayerSession = {
            id: 'session-1',
            player: 'mpv',
            status: 'opened',
            title: 'Example Video',
            streamUrl: 'https://example.com/video.mp4',
            startedAt: '2026-03-07T10:00:00.000Z',
            updatedAt: '2026-03-07T10:00:00.000Z',
            canClose: true,
        };
        settingsStore.player.mockReturnValue(VideoPlayer.MPV);
        dataService.sendIpcEvent.mockResolvedValue(session);

        const result = await service.openResolvedPlayback({
            streamUrl: 'https://example.com/video.mp4',
            title: 'Example Video',
        });

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            'OPEN_MPV_PLAYER',
            expect.objectContaining({
                url: 'https://example.com/video.mp4',
                title: 'Example Video',
            })
        );
        expect(result).toEqual(session);
    });

    it('opens the external-player info dialog once its chunk has loaded', async () => {
        settingsStore.player.mockReturnValue(VideoPlayer.MPV);
        dataService.sendIpcEvent.mockResolvedValue(undefined);

        await service.openResolvedPlayback(
            { streamUrl: 'https://example.com/video.mp4', title: 'Example' },
            false
        );
        await new Promise((resolve) => setTimeout(resolve));

        expect(dialog.open).toHaveBeenCalledTimes(1);
        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            'OPEN_MPV_PLAYER',
            expect.anything()
        );
    });

    it('still starts playback and logs when the info dialog fails to load', async () => {
        const error = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        const unhandled = jest.fn();
        process.on('unhandledRejection', unhandled);
        try {
            settingsStore.player.mockReturnValue(VideoPlayer.VLC);
            dataService.sendIpcEvent.mockResolvedValue(undefined);
            service.loadExternalPlayerInfoDialog = () =>
                Promise.reject(new Error('chunk failed'));

            await service.openResolvedPlayback(
                {
                    streamUrl: 'https://example.com/video.mp4',
                    title: 'Example',
                },
                false
            );
            await new Promise((resolve) => setTimeout(resolve));

            expect(dialog.open).not.toHaveBeenCalled();
            expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
                'OPEN_VLC_PLAYER',
                expect.anything()
            );
            expect(error).toHaveBeenCalledTimes(1);
            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.off('unhandledRejection', unhandled);
            error.mockRestore();
        }
    });

    it('forces external playback without changing the selected embedded player', async () => {
        const session: ExternalPlayerSession = {
            id: 'session-2',
            player: 'vlc',
            status: 'opened',
            title: 'Example Live',
            streamUrl: 'https://example.com/live.m3u8',
            startedAt: '2026-03-07T10:00:00.000Z',
            updatedAt: '2026-03-07T10:00:00.000Z',
            canClose: true,
        };
        settingsStore.player.mockReturnValue(VideoPlayer.VideoJs);
        dataService.sendIpcEvent.mockResolvedValue(session);

        const result = await service.openExternalPlayback(
            {
                streamUrl: 'https://example.com/live.m3u8',
                title: 'Example Live',
                userAgent: 'IPTVnator Test',
                referer: 'https://referrer.example.com',
                origin: 'https://origin.example.com',
            },
            'vlc'
        );

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            'OPEN_VLC_PLAYER',
            expect.objectContaining({
                url: 'https://example.com/live.m3u8',
                title: 'Example Live',
                'user-agent': 'IPTVnator Test',
                referer: 'https://referrer.example.com',
                origin: 'https://origin.example.com',
            })
        );
        expect(dialog.open).not.toHaveBeenCalled();
        expect(result).toEqual(session);
    });
});
