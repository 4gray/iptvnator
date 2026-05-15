import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { Playlist } from '@iptvnator/shared/interfaces';
import { PlaylistFileImportService } from './playlist-file-import.service';

describe('PlaylistFileImportService', () => {
    let service: PlaylistFileImportService;
    let store: { dispatch: jest.Mock };
    let originalElectron: typeof window.electron | undefined;

    beforeEach(() => {
        originalElectron = window.electron;
        store = {
            dispatch: jest.fn(),
        };

        TestBed.configureTestingModule({
            providers: [
                PlaylistFileImportService,
                {
                    provide: Store,
                    useValue: store,
                },
            ],
        });

        service = TestBed.inject(PlaylistFileImportService);
    });

    afterEach(() => {
        window.electron = originalElectron as typeof window.electron;
        jest.restoreAllMocks();
    });

    it('passes the Electron file path through when importing a picked file', async () => {
        const file = {
            name: 'local-source.m3u',
            path: '/tmp/local-source.m3u',
            text: jest.fn().mockResolvedValue('#EXTM3U'),
        } as unknown as File;

        const result = await service.importFile(file);

        expect(result).toEqual({ ok: true, title: 'local-source' });
        expect(store.dispatch).toHaveBeenCalledWith(
            PlaylistActions.parsePlaylist({
                uploadType: 'FILE',
                playlist: '#EXTM3U',
                title: 'local-source',
                path: '/tmp/local-source.m3u',
            })
        );
    });

    it('resolves the Electron file path for dropped files without a path property', async () => {
        const file = {
            name: 'dropped-source.m3u',
            text: jest.fn().mockResolvedValue('#EXTM3U'),
        } as unknown as File;
        window.electron = {
            getPathForFile: jest.fn().mockReturnValue('/tmp/dropped-source.m3u'),
        } as unknown as typeof window.electron;

        const result = await service.importFile(file);

        expect(result).toEqual({ ok: true, title: 'dropped-source' });
        expect(window.electron.getPathForFile).toHaveBeenCalledWith(file);
        expect(store.dispatch).toHaveBeenCalledWith(
            PlaylistActions.parsePlaylist({
                uploadType: 'FILE',
                playlist: '#EXTM3U',
                title: 'dropped-source',
                path: '/tmp/dropped-source.m3u',
            })
        );
    });

    it('adds native Electron file-dialog playlists with their stored file path', async () => {
        const playlist = {
            _id: 'playlist-1',
            title: 'Native Local Source',
            filename: 'Native Local Source',
            count: 1,
            importDate: '2026-05-04T12:00:00.000Z',
            lastUsage: '2026-05-04T12:00:00.000Z',
            autoRefresh: false,
            filePath: '/tmp/native-local-source.m3u',
            favorites: [],
            playlist: {
                items: [],
            },
        } as Playlist;
        window.electron = {
            openPlaylistFromFile: jest.fn().mockResolvedValue(playlist),
        } as unknown as typeof window.electron;

        const result = await service.importFromNativeDialog();

        expect(result).toEqual({
            ok: true,
            title: 'Native Local Source',
        });
        expect(store.dispatch).toHaveBeenCalledWith(
            PlaylistActions.addPlaylist({ playlist })
        );
    });

    it('does not dispatch when the native file dialog is cancelled', async () => {
        window.electron = {
            openPlaylistFromFile: jest.fn().mockResolvedValue(null),
        } as unknown as typeof window.electron;

        const result = await service.importFromNativeDialog();

        expect(result).toEqual({ ok: false, reason: 'cancelled' });
        expect(store.dispatch).not.toHaveBeenCalled();
    });
});
