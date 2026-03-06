import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { DataService } from 'services';
import { VideoPlayer } from 'shared-interfaces';
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
    });

    it('uses the dialog fallback for embedded players', () => {
        service.openResolvedPlayback({
            streamUrl: 'https://example.com/video.mp4',
            title: 'Example Video',
        });

        expect(dialog.open).toHaveBeenCalled();
        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
    });
});
