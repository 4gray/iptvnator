import { TestBed } from '@angular/core/testing';
import {
    RuntimeCapabilitiesService,
    USER_DATA_STORAGE,
} from '@iptvnator/services';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { FavoriteChannelFoldersService } from './favorite-channel-folders.service';
import { UnifiedFavoritesDataService } from './unified-favorites-data.service';

const legacyKey = 'global-favorites-channel-order-v1';
const channel: UnifiedCollectionItem = {
    uid: 'm3u::source-one::synthetic-channel',
    contentType: 'live',
    name: 'Synthetic channel',
    sourceType: 'm3u',
    playlistId: 'source-one',
    playlistName: 'Synthetic source',
    streamUrl: 'https://fixture.invalid/stream/18',
};
const otherSource = { ...channel, playlistId: 'source-two' };
const xtream: UnifiedCollectionItem = {
    ...channel,
    sourceType: 'xtream',
    xtreamId: 18,
    contentId: 11,
};
const stalker: UnifiedCollectionItem = {
    ...channel,
    sourceType: 'stalker',
    stalkerId: 18,
};

describe.each(['browser', 'electron'])(
    'favorite channel folders (%s)',
    (runtime) => {
        const originalElectron = window.electron;
        const legacyOrder = JSON.stringify(['synthetic-2', 'synthetic-1']);
        let documents: Map<string, string>;
        let rejectWrite: boolean;
        const addFavorite = jest.fn();
        const getFavorites = jest.fn();
        let saved: UnifiedCollectionItem[];

        function open() {
            TestBed.resetTestingModule();
            const get = (key: string) => documents.get(key) ?? null;
            const set = (key: string, value: string) => {
                if (rejectWrite) throw new Error('Synthetic write failure');
                documents.set(key, value);
            };
            window.electron = {
                dbGetAppState: async (key: string) => get(key),
                dbSetAppState: async (key: string, value: string) => {
                    if (rejectWrite) return { success: false };
                    set(key, value);
                    return { success: true };
                },
            } as Window['electron'];
            TestBed.configureTestingModule({
                providers: [
                    {
                        provide: RuntimeCapabilitiesService,
                        useValue: {
                            supportsAppStateStorage: runtime === 'electron',
                        },
                    },
                    {
                        provide: USER_DATA_STORAGE,
                        useValue: { getItem: get, setItem: set },
                    },
                    {
                        provide: UnifiedFavoritesDataService,
                        useValue: {
                            addFavorite,
                            getPlaylistFavoritesForMembership: getFavorites,
                        },
                    },
                ],
            });
            return TestBed.inject(FavoriteChannelFoldersService);
        }

        beforeEach(() => {
            documents = new Map([[legacyKey, legacyOrder]]);
            rejectWrite = false;
            saved = [channel, xtream, stalker];
            getFavorites
                .mockReset()
                .mockImplementation(async (playlistId, sourceType) =>
                    saved.filter(
                        (item) =>
                            item.playlistId === playlistId &&
                            item.sourceType === sourceType
                    )
                );
            addFavorite
                .mockReset()
                .mockImplementation(async (item: UnifiedCollectionItem) => {
                    saved.push(item);
                });
        });

        afterEach(() => {
            window.electron = originalElectron;
        });

        it('reopens an old profile unchanged, writes bulk assignments and deletes a folder in one document', async () => {
            let service = open();
            await service.load();
            expect(service.folders()).toEqual([]);
            expect(service.folderOf(channel)).toBeNull();
            expect(documents.size).toBe(1);

            const folder = await service.create('Synthetic folder');
            expect(service.folderOf(channel)).toBeNull();
            await service.move([channel, xtream, stalker], folder);
            await service.rename(folder, 'Renamed synthetic folder');
            service = open();
            await service.load();
            expect(service.folders()).toEqual([
                { id: folder, name: 'Renamed synthetic folder' },
            ]);
            expect(service.folderOf(channel)).toBe(folder);
            const reimported = { ...xtream, contentId: 912 };
            expect(service.folderOf(reimported)).toBe(folder);
            expect(service.folderOf(stalker)).toBe(folder);
            expect(service.folderOf({ ...stalker, radio: 'true' })).toBeNull();
            expect(service.folderOf(otherSource)).toBeNull();
            expect(
                service.folderOf({ ...xtream, contentType: 'movie' })
            ).toBeNull();
            expect([...documents.values()].join()).not.toContain(
                channel.streamUrl
            );
            expect(documents.get(legacyKey)).toBe(legacyOrder);

            await service.remove(folder);
            service = open();
            await service.load();
            expect(service.folders()).toEqual([]);
            expect(service.folderOf(channel)).toBeNull();
            expect(documents.get(legacyKey)).toBe(legacyOrder);
        });

        it('keeps confirmed state on a failed write and supports retry', async () => {
            const service = open();
            const folder = await service.create('Synthetic folder');
            rejectWrite = true;
            await expect(
                service.move([channel, xtream], folder)
            ).rejects.toThrow();
            await expect(
                service.move([channel], folder, { add: true })
            ).rejects.toThrow();
            expect(addFavorite).not.toHaveBeenCalled();
            expect(service.folderOf(channel)).toBeNull();
            rejectWrite = false;
            await service.move([channel, xtream], folder);
            expect(service.folderOf(xtream)).toBe(folder);
            await service.unfile([channel]);
            expect(service.folderOf(channel)).toBeNull();
        });

        it('does not publish a direct add or new folder when membership is rejected', async () => {
            const service = open();
            saved = [];
            addFavorite.mockRejectedValueOnce(
                new Error('Synthetic add failure')
            );
            await expect(
                service.move(
                    [channel],
                    { name: 'Synthetic folder' },
                    { add: true }
                )
            ).rejects.toThrow();
            expect(service.folders()).toEqual([]);
            expect(service.folderOf(channel)).toBeNull();
            await service.move(
                [channel],
                { name: 'Synthetic folder' },
                { add: true }
            );
            expect(service.folderOf(channel)).toBe(service.folders()[0].id);
        });

        it('leaves a failed final write invisible and never retries membership without a successful read', async () => {
            let service = open();
            saved = [];
            addFavorite.mockImplementationOnce(
                async (item: UnifiedCollectionItem) => {
                    saved.push(item);
                    rejectWrite = true;
                }
            );
            await expect(
                service.move(
                    [channel],
                    { name: 'Synthetic folder' },
                    { add: true }
                )
            ).rejects.toThrow();
            expect(service.folders()).toEqual([]);

            rejectWrite = false;
            service = open();
            await service.load();
            expect(service.folders()).toEqual([]);
            expect(service.folderOf(channel)).toBeNull();
            getFavorites.mockRejectedValueOnce(
                new Error('Synthetic read failure')
            );
            await expect(
                service.move(
                    [channel],
                    { name: 'Synthetic folder' },
                    { add: true }
                )
            ).rejects.toThrow('Synthetic read failure');
            expect(addFavorite).toHaveBeenCalledTimes(1);
            expect(service.folders()).toEqual([]);
            await service.move(
                [channel],
                { name: 'Synthetic folder' },
                { add: true }
            );
            expect(addFavorite).toHaveBeenCalledTimes(1);
            expect(service.folderOf(channel)).toBe(service.folders()[0].id);
        });

        it('rejects moving a selection containing a removed favorite', async () => {
            const service = open();
            const folder = await service.create('Synthetic folder');
            saved = [channel];
            await expect(
                service.move([channel, xtream], folder)
            ).rejects.toThrow();
            expect(service.folderOf(channel)).toBeNull();
            expect(service.folderOf(xtream)).toBeNull();
        });

        it('rejects duplicate names and serializes edits against the latest document', async () => {
            const service = open();
            const [first, second] = await Promise.all([
                service.create('Synthetic folder'),
                service.create('Other synthetic folder'),
            ]);
            await expect(
                service.rename(second, ' synthetic FOLDER ')
            ).rejects.toMatchObject({ reason: 'duplicate' });
            await Promise.all([
                service.move([channel], first),
                service.move([xtream], second),
            ]);
            expect(service.folderOf(channel)).toBe(first);
            expect(service.folderOf(xtream)).toBe(second);
        });
    }
);
