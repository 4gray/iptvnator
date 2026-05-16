import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { PlaylistActions } from 'm3u-state';
import { Playlist } from 'shared-interfaces';
import { PlaylistFileImportService } from './playlist-file-import.service';

function textFileStub(
    name: string,
    text: string,
    extra: Record<string, unknown> = {}
): File {
    return {
        name,
        arrayBuffer: jest
            .fn()
            .mockResolvedValue(new TextEncoder().encode(text).buffer),
        ...extra,
    } as unknown as File;
}

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
        const file = textFileStub('local-source.m3u', '#EXTM3U', {
            path: '/tmp/local-source.m3u',
        });

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
        const file = textFileStub('dropped-source.m3u', '#EXTM3U');
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

    it('passes source VPN metadata through file parsing', async () => {
        const file = textFileStub('vpn-source.m3u', '#EXTM3U');
        const sourceVpn = {
            vpnProvider: 'proton' as const,
            vpnLocation: 'HR',
            vpnAutoConnectOnOpen: true,
            vpnAutoConnectWhenDefault: false,
        };

        const result = await service.importFile(file, sourceVpn);

        expect(result).toEqual({ ok: true, title: 'vpn-source' });
        expect(store.dispatch).toHaveBeenCalledWith(
            PlaylistActions.parsePlaylist({
                uploadType: 'FILE',
                playlist: '#EXTM3U',
                title: 'vpn-source',
                path: undefined,
                sourceVpn,
            })
        );
    });

    it('decodes non-UTF8 playlist files before dispatching parse', async () => {
        const bytes = new Uint8Array([
            0x23, 0x45, 0x58, 0x54, 0x4d, 0x33, 0x55, 0x0a, 0x23, 0x45,
            0x58, 0x54, 0x49, 0x4e, 0x46, 0x3a, 0x2d, 0x31, 0x20, 0x43,
            0x69, 0x74, 0x74, 0xe0,
        ]);
        const file = {
            name: 'latin-source.m3u',
            arrayBuffer: jest.fn().mockResolvedValue(bytes.buffer),
        } as unknown as File;

        const result = await service.importFile(file);

        expect(result).toEqual({ ok: true, title: 'latin-source' });
        expect(store.dispatch).toHaveBeenCalledWith(
            PlaylistActions.parsePlaylist({
                uploadType: 'FILE',
                playlist: '#EXTM3U\n#EXTINF:-1 Città',
                title: 'latin-source',
                path: undefined,
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
