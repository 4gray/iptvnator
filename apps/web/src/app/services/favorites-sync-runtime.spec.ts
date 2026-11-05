import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import {
    ParentalLockService,
    PlaylistsService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import { SourceSyncService } from '@iptvnator/services/source-sync';
import { prepareSourceConnection } from '@iptvnator/services/source-sync/connection';
import {
    ElectronXtreamDataSource,
    PwaXtreamDataSource,
} from '@iptvnator/portal/xtream/data-access';
import {
    favoriteAddressKey,
    FAVORITES_SYNC_CAPABILITY,
} from '@iptvnator/shared/interfaces/favorites-sync';
import type {
    FavoriteEntry,
    FavoriteLocalRequest,
} from '@iptvnator/shared/interfaces/favorites-sync';
import type {
    Playlist,
    SourceServerRequest,
    SourceServerResponse,
} from '@iptvnator/shared/interfaces';
import { FavoritesSyncRuntime } from './favorites-sync-runtime';
import {
    favoritesPlaylistBridgeFactory,
    invokeFavorites,
} from './favorites-sync.providers';
import { EnvironmentInjector } from '@angular/core';

const instanceId = 'synthetic-runtime';
const consentKey = `iptvnator-server:${instanceId}:favorites-consent-v1`;
const playlist = {
    _id: 'synthetic-source',
    title: 'Synthetic library',
    playlist: {
        items: [
            {
                id: 'synthetic-channel',
                name: 'Synthetic channel',
                url: 'https://synthetic.test/stream',
            },
        ],
    },
    favorites: [],
} as unknown as Playlist;

describe('favorites runtime consent and lifecycle', () => {
    const original = window.electron;
    let runtime: FavoritesSyncRuntime;
    let request: jest.Mock<
        Promise<SourceServerResponse>,
        [SourceServerRequest]
    >;
    let refresh: jest.Mock;
    let rows: FavoriteEntry[];
    let dispatch: jest.Mock;
    let capabilities: {
        isElectron: boolean;
        supportsFavoritesStorage: boolean;
        supportsXtreamSqliteDataSource: boolean;
    };
    const create = () => (runtime = TestBed.inject(FavoritesSyncRuntime));
    beforeEach(async () => {
        jest.useFakeTimers();
        localStorage.clear();
        localStorage.setItem(
            'iptvnator:source-server',
            JSON.stringify({ apiUrl: 'https://synthetic.test/api', instanceId })
        );
        localStorage.setItem(
            consentKey,
            JSON.stringify({
                enabled: false,
                generation: 'old',
                deviceId: 'synthetic-device',
            })
        );
        rows = [];
        request = jest.fn(
            async (
                input: SourceServerRequest
            ): Promise<SourceServerResponse> => {
                switch (input.operation) {
                    case 'instance':
                        return {
                            status: 200,
                            body: {
                                instanceId,
                                capabilities: [FAVORITES_SYNC_CAPABILITY],
                            },
                        };
                    case 'favorites-context':
                        return {
                            status: 200,
                            body: {
                                sourceId: input.id,
                                sourceIncarnation: 'first',
                                provider: 'm3u',
                            },
                        };
                    case 'favorites-list':
                        return { status: 200, body: { entries: [] } };
                    default:
                        throw new Error('Unexpected synthetic request');
                }
            }
        );
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: {
                sourceSyncRequest: request,
                favoritesLocalRequest: async (input: FavoriteLocalRequest) => {
                    switch (input.operation) {
                        case 'list':
                            return rows.filter(
                                (row) => row.address.sourceId === input.sourceId
                            );
                        case 'pending':
                            return rows.flatMap((row) => row.record.pending);
                        case 'read':
                            return (
                                rows.find(
                                    (row) =>
                                        favoriteAddressKey(row.address) ===
                                        favoriteAddressKey(input.address)
                                )?.record ?? null
                            );
                        case 'commit': {
                            const row = rows.find(
                                (row) =>
                                    favoriteAddressKey(row.address) ===
                                    favoriteAddressKey(input.address)
                            );
                            if (
                                JSON.stringify(row?.record ?? null) !==
                                (input.expected ?? 'null')
                            )
                                return { conflict: true };
                            if (row) row.record = input.value;
                            else
                                rows.push({
                                    address: input.address,
                                    record: input.value,
                                });
                            return { value: input.value };
                        }
                    }
                },
            },
        });
        await prepareSourceConnection();
        refresh = jest.fn(async () => undefined);
        dispatch = jest.fn();
        capabilities = {
            isElectron: true,
            supportsFavoritesStorage: true,
            supportsXtreamSqliteDataSource: true,
        };
        TestBed.configureTestingModule({
            providers: [
                FavoritesSyncRuntime,
                { provide: RuntimeCapabilitiesService, useValue: capabilities },
                {
                    provide: ParentalLockService,
                    useValue: {
                        active: () => false,
                        withholdsEverything: () => false,
                        version: () => 0,
                    },
                },
                {
                    provide: SourceSyncService,
                    useValue: { refresh, state: () => 'connected' },
                },
                {
                    provide: PlaylistsService,
                    useValue: {
                        getAllPlaylists: () => of([playlist]),
                        getPlaylistById: () => of(playlist),
                    },
                },
                {
                    provide: Router,
                    useValue: { url: `/workspace/playlists/${playlist._id}` },
                },
                { provide: Store, useValue: { dispatch } },
                { provide: ElectronXtreamDataSource, useValue: {} },
                { provide: PwaXtreamDataSource, useValue: {} },
            ],
        });
    });
    afterEach(async () => {
        TestBed.resetTestingModule();
        window.electron = original;
        jest.useRealTimers();
        localStorage.clear();
        await prepareSourceConnection();
    });
    it('enables by downloading, publishes the active playlist, and disables without uploading local choices', async () => {
        const value = create();
        expect(value.stateKey()).toBe('FAVORITES_SYNC.STATE_disabled');
        await value.setEnabled(true);
        expect(value.enabled()).toBe(true);
        expect(value.state()).toBe('ready');
        expect(value.lastSync()).toBeInstanceOf(Date);
        expect(value.sourceTitle(playlist._id)).toBe(playlist.title);
        expect(value.sourceTitle('synthetic-missing')).toBe(
            'synthetic-missing'
        );
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                playlistId: playlist._id,
                playlist: expect.objectContaining({ favorites: [] }),
            })
        );
        rows.push({
            address: {
                instanceId,
                scope: 'shared',
                sourceId: playlist._id,
                sourceIncarnation: 'first',
                content: { provider: 'xtream', kind: 'movie', id: '42' },
            },
            record: {
                base: { revision: 1, member: true },
                state: { revision: 1, member: true },
                pending: [],
            },
        });
        await value.setEnabled(false);
        expect(value.enabled()).toBe(false);
        expect(value.state()).toBe('disabled');
        expect(rows[0].record.local).toEqual(rows[0].record.state);
        expect(
            request.mock.calls.some(([r]) => r.operation === 'favorites-apply')
        ).toBe(false);
        const reads = request.mock.calls.length;
        await value.refresh();
        expect(request).toHaveBeenCalledTimes(reads);
    });
    it('retains an offline edit through opt-out, backup and Keep local until explicit import', async () => {
        const value = create();
        await value.setEnabled(true);
        const handle = request.getMockImplementation()!;
        let offline = true;
        request.mockImplementation(async (input) => {
            if (input.operation !== 'favorites-apply') return handle(input);
            if (offline) throw new Error('Synthetic offline');
            const operation = input.favorite?.operation;
            if (!operation) throw new Error('Missing synthetic operation');
            return {
                status: 200,
                body: {
                    status: 'applied',
                    state: {
                        revision: operation.expectedRevision + 1,
                        member: operation.member,
                        snapshot: operation.snapshot,
                    },
                },
            };
        });
        const edited = await value.mutate(playlist, () => [
            'synthetic-channel',
        ]);
        expect(edited?.favorites).toEqual(['https://synthetic.test/stream']);
        expect(value.pending()).toBe(1);
        await value.setEnabled(false);
        const backup = {
            portalType: 'm3u',
            exportedId: playlist._id,
            title: 'Synthetic library',
            autoRefresh: false,
            source: { kind: 'text', rawM3u: '#EXTM3U' },
            userState: {
                favorites: [],
                recentlyViewed: [],
                hiddenGroupTitles: [],
            },
        } satisfies Parameters<FavoritesSyncRuntime['exportFavorites']>[1];
        const exported = await value.exportFavorites(playlist, backup);
        expect(exported.userState.favorites).toEqual([
            'https://synthetic.test/stream',
        ]);
        await value.backupRestorer()(playlist._id, exported);
        await expect(value.previewImport()).rejects.toThrow(
            'Favorite consent disabled'
        );
        await value.setEnabled(true);
        expect(value.parkedCount()).toBe(1);
        await value.parked(false);
        expect(value.pending()).toBe(0);
        expect(rows[0].record.localOnly).toBe(true);
        offline = false;
        const preview = await value.previewImport();
        expect(preview.sources[0].items).toHaveLength(1);
        expect(await value.importFavorites(preview)).toBe(0);
        expect(rows[0].record.pending).toHaveLength(0);
        expect(rows[0].record.state.member).toBe(true);
        rows[0].record.conflict = { revision: 9, member: false };
        await value.resolve(rows[0].address, false);
        expect(rows[0].record.state).toEqual({ revision: 9, member: false });
        expect(value.conflicts()).toEqual([]);
        expect((await value.project(playlist)).favorites).toEqual([]);
        const raw = { getFavorites: async () => [] } as unknown as Parameters<
            FavoritesSyncRuntime['invoke']
        >[0];
        expect(await value.invoke(raw, 'getFavorites', [playlist._id])).toEqual(
            []
        );
        await expect(
            value.invoke(raw, 'synthetic-unknown', [null, playlist._id])
        ).rejects.toThrow();
        expect(value.error()).toBe(true);
        await expect(
            value.mutate(playlist, () => {
                throw new Error('Synthetic transform failed');
            })
        ).rejects.toThrow('Synthetic transform failed');
    });
    it('keeps the lazy bridge local before consent and persists unresolved local choices after enabling', async () => {
        const bridge = TestBed.runInInjectionContext(
            favoritesPlaylistBridgeFactory
        );
        expect(bridge.active()).toBe(true);
        localStorage.removeItem(consentKey);
        expect(bridge.active()).toBe(false);
        expect(await bridge.project(playlist)).toBe(playlist);
        expect(await bridge.mutate(playlist, () => [])).toBeNull();
        const value = create();
        await value.setEnabled(true);
        expect((await bridge.project(playlist)).favorites).toEqual([]);
        const persist = jest.fn(async () => undefined);
        const edited = await bridge.mutate(
            playlist,
            () => ['synthetic-unresolved'],
            persist
        );
        expect(persist).toHaveBeenCalledWith(['synthetic-unresolved']);
        expect(edited?.favorites).toEqual(['synthetic-unresolved']);
        const raw = { getFavorites: async () => [] } as unknown as Parameters<
            FavoritesSyncRuntime['invoke']
        >[0];
        expect(
            await invokeFavorites(
                TestBed.inject(EnvironmentInjector),
                raw,
                'getFavorites',
                [playlist._id]
            )
        ).toEqual([]);
    });
    it('polls a visible enabled profile and observes cross-tab opt-out', async () => {
        const visibility = jest
            .spyOn(document, 'hidden', 'get')
            .mockReturnValue(false);
        try {
            const value = create();
            await value.setEnabled(true);
            const count = refresh.mock.calls.length;
            jest.advanceTimersByTime(5000);
            await value.refresh();
            expect(refresh.mock.calls.length).toBe(count + 1);
            const stored = JSON.parse(localStorage.getItem(consentKey)!);
            localStorage.setItem(
                consentKey,
                JSON.stringify({ ...stored, enabled: false })
            );
            window.dispatchEvent(new Event('storage'));
            expect(value.enabled()).toBe(false);
            expect(value.state()).toBe('disabled');
        } finally {
            visibility.mockRestore();
        }
    });
    it('refuses consent when durable favorite storage is unavailable', async () => {
        capabilities.supportsFavoritesStorage = false;
        const value = create();
        await expect(value.setEnabled(true)).rejects.toThrow(
            'Favorite consent failed'
        );
        expect(value.error()).toBe(true);
        expect(value.busy()).toBe(false);
        expect(request).not.toHaveBeenCalled();
    });
    it('serializes overlapping consent changes and retains the device identity', async () => {
        const value = create();
        await Promise.all([
            value.setEnabled(true),
            value.setEnabled(false),
            value.setEnabled(false),
        ]);
        expect(value.enabled()).toBe(false);
        expect(JSON.parse(localStorage.getItem(consentKey)!)).toMatchObject({
            enabled: false,
            deviceId: 'synthetic-device',
        });
        expect(value.busy()).toBe(false);
    });
    it.each(['unsupported', 'instance', 'offline'] as const)(
        'refuses consent on %s verification without changing stored consent',
        async (mode) => {
            const before = localStorage.getItem(consentKey);
            const value = create();
            request.mockImplementation(async () => {
                if (mode === 'offline') throw new Error('Synthetic offline');
                return {
                    status: 200,
                    body: {
                        instanceId:
                            mode === 'instance'
                                ? 'synthetic-other'
                                : instanceId,
                        capabilities: [],
                    },
                };
            });
            if (mode === 'unsupported') {
                await value.setEnabled(true);
                expect(value.state()).toBe('incompatible');
            } else
                await expect(value.setEnabled(true)).rejects.toThrow(
                    'Favorite consent failed'
                );
            expect(localStorage.getItem(consentKey)).toBe(before);
            expect(value.busy()).toBe(false);
            expect(value.enabled()).toBe(false);
        }
    );
    it('does not save consent after a sibling changes it during verification', async () => {
        const value = create();
        request.mockImplementation(async () => {
            localStorage.setItem(
                consentKey,
                JSON.stringify({
                    enabled: false,
                    generation: 'sibling',
                    deviceId: 'synthetic-device',
                })
            );
            return {
                status: 200,
                body: { instanceId, capabilities: [FAVORITES_SYNC_CAPABILITY] },
            };
        });
        await value.setEnabled(true);
        expect(JSON.parse(localStorage.getItem(consentKey)!).generation).toBe(
            'sibling'
        );
        expect(value.enabled()).toBe(false);
    });
    it('reports transport failure and recovers on focus, then releases polling on destroy', async () => {
        const value = create();
        await value.setEnabled(true);
        refresh.mockRejectedValueOnce(new Error('Synthetic offline'));
        await value.refresh();
        expect(value.state()).toBe('offline');
        expect(value.error()).toBe(true);
        window.dispatchEvent(new Event('focus'));
        await value.refresh();
        expect(value.state()).toBe('ready');
        expect(value.error()).toBe(false);
        const count = refresh.mock.calls.length;
        TestBed.resetTestingModule();
        window.dispatchEvent(new Event('online'));
        jest.advanceTimersByTime(10000);
        expect(refresh).toHaveBeenCalledTimes(count);
    });
});
