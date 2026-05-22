import { TestBed } from '@angular/core/testing';
import {
    PLAYLIST_DELETE_CLEANUP,
    PlaylistDeleteCleanup,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import {
    ElectronXtreamDataSource,
    PwaXtreamDataSource,
    provideXtreamDataSource,
} from './index';
import {
    IXtreamDataSource,
    XTREAM_DATA_SOURCE,
} from './xtream-data-source.interface';

describe('provideXtreamDataSource', () => {
    let electronSource: IXtreamDataSource;
    let pwaSource: IXtreamDataSource;
    let runtime: {
        supportsXtreamSqliteDataSource: boolean;
    };

    function configure(supportsXtreamSqliteDataSource: boolean): void {
        electronSource = {
            deletePlaylist: jest.fn().mockResolvedValue(undefined),
        } as Partial<IXtreamDataSource> as IXtreamDataSource;
        pwaSource = {
            deletePlaylist: jest.fn().mockResolvedValue(undefined),
        } as Partial<IXtreamDataSource> as IXtreamDataSource;
        runtime = {
            supportsXtreamSqliteDataSource,
        };

        TestBed.configureTestingModule({
            providers: [
                ...provideXtreamDataSource(),
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: runtime,
                },
                {
                    provide: ElectronXtreamDataSource,
                    useValue: electronSource,
                },
                {
                    provide: PwaXtreamDataSource,
                    useValue: pwaSource,
                },
            ],
        });
    }

    afterEach(() => TestBed.resetTestingModule());

    it('uses the Electron data source only when the Xtream SQLite capability is available', () => {
        configure(true);

        expect(TestBed.inject(XTREAM_DATA_SOURCE)).toBe(electronSource);
    });

    it('falls back to the PWA data source when the Electron bridge lacks Xtream SQLite methods', () => {
        configure(false);

        expect(TestBed.inject(XTREAM_DATA_SOURCE)).toBe(pwaSource);
    });

    it('skips browser sidecar cleanup for SQLite-backed Xtream storage', async () => {
        configure(true);
        const [cleanup] = TestBed.inject(
            PLAYLIST_DELETE_CLEANUP
        ) as PlaylistDeleteCleanup[];

        await cleanup('playlist-1');

        expect(electronSource.deletePlaylist).not.toHaveBeenCalled();
        expect(pwaSource.deletePlaylist).not.toHaveBeenCalled();
    });

    it('runs browser sidecar cleanup when SQLite-backed Xtream storage is unavailable', async () => {
        configure(false);
        const [cleanup] = TestBed.inject(
            PLAYLIST_DELETE_CLEANUP
        ) as PlaylistDeleteCleanup[];

        await cleanup('playlist-1');

        expect(pwaSource.deletePlaylist).toHaveBeenCalledWith('playlist-1');
        expect(electronSource.deletePlaylist).not.toHaveBeenCalled();
    });
});
