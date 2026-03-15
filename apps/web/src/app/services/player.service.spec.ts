import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { DataService } from 'services';
import { ExternalPlayerSession, VideoPlayer } from 'shared-interfaces';
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
        expect(service.isEmbeddedPlayer(VideoPlayer.MPV)).toBe(false);
        expect(service.isEmbeddedPlayer(VideoPlayer.VLC)).toBe(false);
        expect(service.isEmbeddedPlayer(VideoPlayer.PotPlayer)).toBe(false);
    });

    it('uses the dialog fallback for embedded players', async () => {
        await service.openResolvedPlayback({
            streamUrl: 'https://example.com/video.mp4',
            title: 'Example Video',
        });

        expect(dialog.open).toHaveBeenCalled();
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
});
