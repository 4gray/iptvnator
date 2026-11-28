import { TestBed } from '@angular/core/testing';
import {
    RuntimeCapabilitiesService,
    USER_DATA_STORAGE,
    type UserDataStorage,
} from '@iptvnator/services';
import { setActivePersonalScope } from '@iptvnator/services/profiles';
import type { PersonalScope } from '@iptvnator/shared/interfaces/profiles';
import { FavoriteChannelMembershipEvents } from '@iptvnator/services/favorites-events';
import {
    CONNECTION_KEY,
    prepareSourceConnection,
    sourceProfileName,
} from '@iptvnator/services/source-sync/connection';
import { createSourceProfileUserDataStorage } from '@iptvnator/services/source-sync/profile-user-data';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { FavoriteChannelFoldersService } from './favorite-channel-folders.service';
import { UnifiedFavoritesDataService } from './unified-favorites-data.service';

const legacyKey = 'global-favorites-channel-order-v1';
const folderKey = 'global-favorite-channel-folders-v1';
const channel = {
    uid: 'm3u::source-one::synthetic-channel',
    contentType: 'live',
    name: 'Synthetic channel',
    sourceType: 'm3u',
    playlistId: 'source-one',
    playlistName: 'Synthetic source',
    streamUrl: 'https://fixture.invalid/stream/18',
} satisfies UnifiedCollectionItem;
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
        const originalLocks = Object.getOwnPropertyDescriptor(
            navigator,
            'locks'
        );
        const originalIndexedDb = Object.getOwnPropertyDescriptor(
            window,
            'indexedDB'
        );
        const legacyOrder = JSON.stringify(['synthetic-2', 'synthetic-1']);
        let documents: Map<string, string>;
        let rejectWrite: boolean;
        const addFavorite = jest.fn();
        const getFavorites = jest.fn();
        const readDocument = jest.fn(
            (key: string) => documents.get(key) ?? null
        );
        const requestLock = jest.fn(
            (_key: string, operation: () => Promise<unknown>) => operation()
        );
        let saved: UnifiedCollectionItem[];

        function open(browserStorage?: UserDataStorage) {
            TestBed.resetTestingModule();
            const set = (key: string, value: string) => {
                if (rejectWrite) throw new Error('Synthetic write failure');
                documents.set(key, value);
            };
            window.electron = {
                dbGetAppState: async (key: string) => readDocument(key),
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
                        useValue: browserStorage ?? {
                            getItem: readDocument,
                            setItem: set,
                        },
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
            Object.defineProperty(navigator, 'locks', {
                configurable: true,
                value: { request: requestLock },
            });
            documents = new Map([[legacyKey, legacyOrder]]);
            rejectWrite = false;
            readDocument.mockClear();
            requestLock.mockClear();
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
            if (originalLocks) {
                Object.defineProperty(navigator, 'locks', originalLocks);
            } else {
                Reflect.deleteProperty(navigator, 'locks');
            }
            if (originalIndexedDb) {
                Object.defineProperty(window, 'indexedDB', originalIndexedDb);
            } else {
                Reflect.deleteProperty(window, 'indexedDB');
            }
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
            expect(service.hasAssignments(folder)).toBe(true);
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
            expect(service.hasAssignments(folder)).toBe(false);
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
                service.move([otherSource], folder, { add: true })
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
            const pending = JSON.parse(documents.get(folderKey) ?? '{}');
            expect(pending.pendingAdd).toEqual(expect.any(String));
            await service.unfile([
                { ...channel, streamUrl: '  ' },
                otherSource,
            ]);
            expect(JSON.parse(documents.get(folderKey) ?? '{}')).toEqual(
                pending
            );
            await service.unfile([channel]);
            expect(JSON.parse(documents.get(folderKey) ?? '{}')).toEqual({
                version: 1,
                folders: [],
                assignments: {},
            });
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
                service.create('  Synthetic folder  '),
                service.create('Other synthetic folder'),
            ]);
            expect(service.folders()[0].name).toBe('Synthetic folder');
            await expect(service.create('  ')).rejects.toMatchObject({
                reason: 'blank',
            });
            await expect(service.create('a'.repeat(101))).rejects.toMatchObject(
                {
                    reason: 'too-long',
                }
            );
            await expect(
                service.rename(second, ' synthetic FOLDER ')
            ).rejects.toMatchObject({ reason: 'duplicate' });
            await service.rename(first, 'SYNTHETIC FOLDER');
            await Promise.all([
                service.move([channel], first),
                service.move([xtream], second),
            ]);
            expect(service.folderOf(channel)).toBe(first);
            expect(service.folderOf(xtream)).toBe(second);
            await service.remove(first);
            await expect(service.move([xtream], first)).rejects.toThrow(
                'Favorite folder no longer exists'
            );
            expect(service.folderOf(xtream)).toBe(second);
            await service.move([xtream], null);
            expect(service.folderOf(xtream)).toBeNull();
            expect(service.hasAssignments(second)).toBe(false);
            expect(saved).toContain(xtream);
        });

        it.each([
            ['invalid JSON', '{'],
            ['unknown version', { version: 2 }],
            ['missing folder array', { folders: undefined }],
            ['null folder', { folders: [null] }],
            ['invalid folder ID', { folders: [{ id: 1, name: 'Synthetic' }] }],
            ['invalid folder name', { folders: [{ id: 'synthetic' }] }],
            ['non-object assignments', { assignments: 5 }],
            ['null assignments', { assignments: null }],
            ['array assignments', { assignments: [] }],
            ['invalid pending add', { pendingAdd: true }],
        ])(
            'preserves a document with %s and retries a failed load',
            async (_case, invalid) => {
                const raw =
                    typeof invalid === 'string'
                        ? invalid
                        : JSON.stringify({
                              version: 1,
                              folders: [],
                              assignments: {},
                              ...invalid,
                          });
                documents.set(folderKey, raw);
                const service = open();
                const load = service.load();
                expect(service.load()).toBe(load);
                await expect(load).rejects.toThrow();
                await expect(
                    service.create('Synthetic folder')
                ).rejects.toThrow();
                expect(documents.get(folderKey)).toBe(raw);
                expect(service.folders()).toEqual([]);

                documents.set(
                    folderKey,
                    JSON.stringify({
                        version: 1,
                        folders: [{ id: 'synthetic', name: 'Recovered' }],
                        assignments: {
                            '["xtream","source-one","18"]': 'deleted-folder',
                        },
                    })
                );
                await expect(service.load()).resolves.toBeUndefined();
                expect(service.folders()).toEqual([
                    { id: 'synthetic', name: 'Recovered' },
                ]);
                expect(service.folderOf(xtream)).toBeNull();
            }
        );

        it('files only channels with durable source identities and distinguishes Stalker radio', async () => {
            const service = open();
            const folder = await service.create('Synthetic folder');
            const movie = { ...xtream, contentType: 'movie' as const };
            const unidentified = [
                { ...channel, playlistId: '' },
                { ...channel, streamUrl: '  ' },
                { ...channel, streamUrl: undefined },
                { ...xtream, xtreamId: undefined },
                { ...stalker, stalkerId: undefined },
                { ...stalker, stalkerItem: { title: 'Synthetic without ID' } },
                movie,
            ];
            expect(unidentified.every((item) => !service.canFile(item))).toBe(
                true
            );
            await expect(service.move([], folder)).rejects.toThrow(
                'Missing favorite channel identity'
            );
            await expect(
                service.move([channel, ...unidentified], folder)
            ).rejects.toThrow('Missing favorite channel identity');
            await expect(
                service.move([channel, stalker], folder, { add: true })
            ).rejects.toThrow('Missing favorite channel identity');
            expect(getFavorites).not.toHaveBeenCalled();

            const radio: UnifiedCollectionItem = {
                ...stalker,
                stalkerId: undefined,
                stalkerItem: { stream_id: ' 18 ' },
                radio: 'true',
            };
            saved.push(radio, movie);
            await service.move([radio, channel], folder);
            expect(service.canFile(radio)).toBe(true);
            expect(service.folderOf({ ...stalker, radio: 'true' })).toBe(
                folder
            );
            expect(service.folderOf(stalker)).toBeNull();
            expect(
                service.folderOf({
                    ...channel,
                    streamUrl: ` ${channel.streamUrl} `,
                })
            ).toBe(folder);
            expect(service.folderOf(otherSource)).toBeNull();
            expect(service.folderOf(unidentified[0])).toBeNull();
        });

        it('releases assignments when one source changes membership and keeps other sources filed', async () => {
            const service = open();
            const folder = await service.create('Synthetic folder');
            const memberships = TestBed.inject(FavoriteChannelMembershipEvents);
            saved.push(otherSource);
            await service.move([channel, otherSource], folder);

            rejectWrite = true;
            const membership = {
                sourceType: 'm3u' as const,
                playlistId: channel.playlistId,
                streamUrl: channel.streamUrl,
            };
            memberships.notify(membership);
            await service.load();
            expect(service.folderOf(channel)).toBe(folder);

            rejectWrite = false;
            memberships.notify(membership);
            await service.unfile([]);
            expect(service.folderOf(channel)).toBeNull();
            expect(service.folderOf(otherSource)).toBe(folder);
        });

        it('handles storage notifications only for the active browser document', async () => {
            const service = open();
            const original = await service.create('Original folder');
            const notify = (key: string | null) =>
                window.dispatchEvent(new StorageEvent('storage', { key }));
            documents.set(folderKey, '{');
            readDocument.mockClear();
            notify(legacyKey);
            await Promise.resolve();
            expect(readDocument).not.toHaveBeenCalled();

            notify(folderKey);
            await Promise.resolve();
            expect(readDocument).toHaveBeenCalledTimes(
                runtime === 'browser' ? 1 : 0
            );
            expect(service.folders()[0].id).toBe(original);

            documents.delete(folderKey);
            notify(null);
            await service.unfile([]);
            expect(service.folders()).toEqual(
                runtime === 'browser'
                    ? []
                    : [{ id: original, name: 'Original folder' }]
            );
        });

        it('writes with the runtime fallback when Web Locks are unavailable', async () => {
            Reflect.deleteProperty(navigator, 'locks');
            const database = { close: jest.fn() };
            const error = new Error('Synthetic IndexedDB lock failure');
            let openingError: Error | null = error;
            const openDatabase = jest.fn(() => {
                const request = {
                    error: openingError,
                    result: database,
                    onerror: () => undefined as void,
                    onupgradeneeded: () => undefined as void,
                    onsuccess: () => undefined as void,
                };
                queueMicrotask(() => {
                    if (request.error) {
                        request.onerror();
                        return;
                    }
                    request.onupgradeneeded();
                    request.onsuccess();
                });
                return request;
            });
            Object.defineProperty(window, 'indexedDB', {
                configurable: true,
                value: { open: openDatabase },
            });
            const service = open();
            if (runtime === 'browser') {
                await expect(service.create('Synthetic folder')).rejects.toBe(
                    error
                );
                expect(documents.has(folderKey)).toBe(false);
            }
            openingError = null;
            const folder = await service.create('Synthetic folder');
            expect(service.folders()).toEqual([
                { id: folder, name: 'Synthetic folder' },
            ]);
            expect(requestLock).not.toHaveBeenCalled();
            if (runtime === 'browser') {
                expect(openDatabase).toHaveBeenCalledWith(
                    `iptvnator-favorite-folders:${folderKey}`
                );
                expect(database.close).toHaveBeenCalledTimes(1);
            } else {
                expect(openDatabase).not.toHaveBeenCalled();
            }
        });

        describe('household profiles', () => {
            const scope: PersonalScope =
                'profile:11111111-1111-4111-8111-111111111111';
            const scopedKey = `${folderKey}:${scope}`;
            afterEach(() => setActivePersonalScope('shared'));

            it('starts a profile with no folders and never writes the household document', async () => {
                const service = open();
                await service.load();
                const household = await service.create('Household folder');
                await service.move([channel], household);
                const householdDocument = documents.get(folderKey);

                setActivePersonalScope(scope);
                window.dispatchEvent(new Event('iptvnator-profile-switched'));
                await service.load();
                expect(service.folders()).toEqual([]);
                expect(service.folderOf(channel)).toBeNull();
                expect(service.hasAssignments(household)).toBe(false);

                const own = await service.create('Profile folder');
                await service.move([channel], own);
                expect(service.folderOf(channel)).toBe(own);
                expect(documents.get(folderKey)).toBe(householdDocument);
                expect(documents.has(scopedKey)).toBe(true);
                expect(requestLock).toHaveBeenLastCalledWith(
                    scopedKey,
                    expect.any(Function)
                );

                setActivePersonalScope('shared');
                window.dispatchEvent(new Event('iptvnator-profile-switched'));
                await service.load();
                expect(service.folders()).toEqual([
                    { id: household, name: 'Household folder' },
                ]);
                expect(service.folderOf(channel)).toBe(household);
            });

            it('keeps a write begun under one profile out of the next profile', async () => {
                const service = open();
                await service.load();
                const pending = service.create('Late folder');
                setActivePersonalScope(scope);
                window.dispatchEvent(new Event('iptvnator-profile-switched'));
                await pending;
                await service.load();
                expect(service.folders()).toEqual([]);
                expect(documents.has(scopedKey)).toBe(false);
            });
        });

        it('opens independent folder documents and lock scopes for each server profile', async () => {
            const select = async (instanceId: string) => {
                localStorage.setItem(
                    CONNECTION_KEY,
                    JSON.stringify({
                        apiUrl: 'https://fixture.invalid/api',
                        instanceId,
                    })
                );
                await prepareSourceConnection();
                return open(
                    createSourceProfileUserDataStorage(sourceProfileName())
                );
            };
            const originalConnection = localStorage.getItem(CONNECTION_KEY);
            const firstProfile = 'folder-fixture-a';
            const secondProfile = 'folder-fixture-b';
            try {
                const first = await select(firstProfile);
                const folder = await first.create('Synthetic folder');
                const second = await select(secondProfile);
                await second.load();
                expect(second.folders()).toEqual([]);
                const reopened = await select(firstProfile);
                await reopened.load();
                expect(reopened.folders()).toEqual([
                    { id: folder, name: 'Synthetic folder' },
                ]);
                expect(requestLock).toHaveBeenCalledWith(
                    `iptvnator-server:${firstProfile}:${folderKey}`,
                    expect.any(Function)
                );
                expect(documents.has(folderKey)).toBe(false);
            } finally {
                for (const profile of [firstProfile, secondProfile]) {
                    createSourceProfileUserDataStorage(
                        `iptvnator-server:${profile}`
                    ).removeItem(folderKey);
                }
                if (originalConnection === null)
                    localStorage.removeItem(CONNECTION_KEY);
                else localStorage.setItem(CONNECTION_KEY, originalConnection);
                await prepareSourceConnection();
            }
        });
    }
);
