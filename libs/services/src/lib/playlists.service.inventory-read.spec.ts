import { firstValueFrom, of } from 'rxjs';
import { Playlist } from '@iptvnator/shared/interfaces';
import { PlaylistsService } from './playlists.service';

// Performance journey J1: the playlist effect and the XMLTV source
// reconciliation both read the inventory at startup. They must share one
// worker round trip, without ever handing a caller a pre-write inventory.
describe('PlaylistsService inventory reads', () => {
    const original = window.electron;
    afterEach(() => {
        window.electron = original;
        jest.restoreAllMocks();
    });

    function deferred<T>() {
        let resolve!: (value: T) => void;
        const promise = new Promise<T>((done) => (resolve = done));
        return { promise, resolve };
    }

    function setup() {
        const reads: ReturnType<typeof deferred<Playlist[]>>[] = [];
        const electron = {
            dbGetAppState: jest.fn(
                async (_key: string): Promise<string | null> => '1'
            ),
            dbSetAppState: jest.fn(),
            dbRecoverLegacyPlaylists: jest.fn(async () => undefined),
            dbGetAppPlaylists: jest.fn(async () => []),
            dbGetAppPlaylistMetas: jest.fn(() => {
                const read = deferred<Playlist[]>();
                reads.push(read);
                return read.promise;
            }),
            dbGetAppPlaylistFavoriteChannels: jest.fn(async () => []),
            dbUpsertAppPlaylist: jest.fn(async () => undefined),
        };
        window.electron = electron as unknown as typeof window.electron;
        const service = Object.create(
            PlaylistsService.prototype
        ) as PlaylistsService;
        Object.assign(service, {
            dbService: { getAll: jest.fn(() => of([])) },
            runtime: { supportsSqlite: true },
            electronMigrationPromise: null,
            pendingMetas: null,
            playlistWriteQueues: new Map(),
        });
        const settle = async (index: number, playlists: Playlist[]) => {
            // The read starts after the memoized migration's awaits.
            while (!reads[index]) await Promise.resolve();
            reads[index].resolve(playlists);
        };
        return { electron, service, settle };
    }

    const source = (id: string) =>
        ({ _id: id, title: id, favorites: ['a'] }) as unknown as Playlist;

    it('shares one metadata read between concurrent callers', async () => {
        const { electron, service, settle } = setup();

        const effectRead = firstValueFrom(service.getAllPlaylists());
        const reconcileRead = firstValueFrom(service.getAllPlaylists());
        await settle(0, [source('m3u')]);
        const [first, second] = await Promise.all([effectRead, reconcileRead]);

        expect(electron.dbGetAppPlaylistMetas).toHaveBeenCalledTimes(1);
        expect(second).toEqual(first);
        // The joiner holds its own copy: no caller mutates another's result.
        expect(second).not.toBe(first);
        expect(second[0].favorites).not.toBe(first[0].favorites);
    });

    it('never reuses a settled read', async () => {
        const { electron, service, settle } = setup();

        const first = firstValueFrom(service.getAllPlaylists());
        await settle(0, [source('before')]);
        await first;
        const second = firstValueFrom(service.getAllPlaylists());
        await settle(1, [source('after')]);

        await expect(second).resolves.toEqual([source('after')]);
        expect(electron.dbGetAppPlaylistMetas).toHaveBeenCalledTimes(2);
    });

    it('starts a fresh read for callers that arrive after a write', async () => {
        const { electron, service, settle } = setup();
        const added = source('added');

        const staleRead = firstValueFrom(service.getAllPlaylists());
        while (electron.dbGetAppPlaylistMetas.mock.calls.length === 0)
            await Promise.resolve();
        await firstValueFrom(service.addPlaylist(added));
        const freshRead = firstValueFrom(service.getAllPlaylists());
        await settle(0, []);
        await settle(1, [added]);

        await expect(staleRead).resolves.toEqual([]);
        await expect(freshRead).resolves.toEqual([added]);
        expect(electron.dbGetAppPlaylistMetas).toHaveBeenCalledTimes(2);
    });
});
