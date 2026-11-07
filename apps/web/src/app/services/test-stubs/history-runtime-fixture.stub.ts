import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import {
    PlaylistsService,
    RuntimeCapabilitiesService,
    ParentalLockService,
} from '@iptvnator/services';
import { SourceSyncService } from '@iptvnator/services/source-sync';
import { prepareSourceConnection } from '@iptvnator/services/source-sync/connection';
import {
    ElectronXtreamDataSource,
    PwaXtreamDataSource,
} from '@iptvnator/portal/xtream/data-access';
import { IndexedDbHistoryStore } from '@iptvnator/services/history-sync';
import {
    historyScopeKey,
    emptyHistoryState,
    applyHistoryOperation,
    assertHistoryRecord,
    type HistoryRecord,
    type HistoryScope,
    type HistoryLocalRequest,
} from '@iptvnator/shared/interfaces/history-sync';
import type {
    Playlist,
    SourceServerRequest,
    SourceServerResponse,
} from '@iptvnator/shared/interfaces';
import { HistorySyncRuntime } from '../history-sync-runtime';

export const historyInstance = 'synthetic-history-runtime';
export const historyConsent = `iptvnator-server:${historyInstance}:history-consent-v1`;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export async function historyRuntimeFixture(native = true, enabled = false) {
    const recent = {
        source: 'm3u' as const,
        id: 'synthetic-channel',
        url: 'https://history.example/stream',
        title: 'Synthetic channel',
        category_id: 'live' as const,
        added_at: '2026-01-01T00:00:00Z',
    };
    const playlist = {
        _id: 'synthetic-m3u',
        title: 'Synthetic playlist',
        count: 1,
        playlist: {
            items: [{ id: recent.id, name: recent.title, url: recent.url }],
        },
        recentlyViewed: [recent],
    } as Playlist;
    const portal = {
        _id: 'synthetic-xtream',
        title: 'Synthetic portal',
        serverUrl: 'https://portal.example',
    } as Playlist;
    const scopes = [playlist, portal].map((source): HistoryScope => ({
        instanceId: historyInstance,
        sourceId: source._id,
        sourceIncarnation: 'synthetic-first',
        provider: source.serverUrl ? 'xtream' : 'm3u',
    }));
    const records = new Map<string, HistoryRecord>();
    const remote = new Map(
        scopes.map((scope) => [scope.sourceId, emptyHistoryState()])
    );
    let offline = false;
    const request = jest.fn(
        async (input: SourceServerRequest): Promise<SourceServerResponse> => {
            if (offline) throw new Error('Synthetic offline transport');
            if (input.operation === 'instance')
                return {
                    status: 200,
                    body: {
                        instanceId: historyInstance,
                        capabilities: ['history-v1'],
                    },
                };
            const scope = scopes.find(
                (scope) =>
                    scope.sourceId ===
                    (input.id ?? input.history?.scope.sourceId)
            );
            if (!scope) throw new Error('Unknown synthetic source');
            if (input.operation === 'history-read')
                return {
                    status: 200,
                    body: { scope, state: copy(remote.get(scope.sourceId)!) },
                };
            if (
                input.operation === 'history-apply' &&
                input.history?.operation
            ) {
                const applied = applyHistoryOperation(
                    remote.get(scope.sourceId)!,
                    input.history.operation,
                    false,
                    Date.now()
                );
                remote.set(scope.sourceId, applied.state);
                return { status: 200, body: copy(applied) };
            }
            throw new Error('Unexpected synthetic request');
        }
    );
    const read = async (scope: HistoryScope) =>
        copy(records.get(historyScopeKey(scope)) ?? null);
    const mutate = async (
        scope: HistoryScope,
        update: (record: HistoryRecord | null) => HistoryRecord
    ) => {
        const next = update(await read(scope));
        assertHistoryRecord(scope, next);
        records.set(historyScopeKey(scope), copy(next));
        return copy(next);
    };
    jest.spyOn(IndexedDbHistoryStore.prototype, 'read').mockImplementation(
        read
    );
    jest.spyOn(IndexedDbHistoryStore.prototype, 'mutate').mockImplementation(
        mutate
    );
    const local = jest.fn(async (input: HistoryLocalRequest) => {
        if (input.operation === 'read') return read(input.scope);
        const current = await read(input.scope);
        if ((current ? JSON.stringify(current) : null) !== input.expected)
            return { conflict: true };
        return { value: await mutate(input.scope, () => input.value) };
    });
    Object.defineProperty(window, 'electron', {
        configurable: true,
        writable: true,
        value: { sourceSyncRequest: request, historyLocalRequest: local },
    });
    localStorage.setItem(
        'iptvnator:source-server',
        JSON.stringify({
            apiUrl: 'https://history.example/api',
            instanceId: historyInstance,
        })
    );
    localStorage.setItem(
        historyConsent,
        JSON.stringify({
            enabled,
            generation: 'synthetic-old',
            deviceId: 'synthetic-device',
        })
    );
    await prepareSourceConnection();
    const raw = {
        getRecentItems: jest.fn(async () => [
            {
                id: 41,
                xtream_id: 41,
                type: 'movie',
                title: 'Synthetic archived movie',
                viewed_at: '2026-01-01T00:00:00Z',
                category_id: 7,
            },
        ]),
        getContentByXtreamId: jest.fn(async (id: number) => ({
            id,
            xtream_id: id,
            type: 'movie',
            title: 'Synthetic movie',
            category_id: 7,
        })),
        getAllCategories: jest.fn(async () => [{ id: 7, locked: false }]),
    };
    const refresh = jest.fn(async (): Promise<void> => undefined);
    const dispatch = jest.fn();
    const capabilities = {
        isElectron: native,
        supportsHistoryStorage: true,
        supportsXtreamSqliteDataSource: native,
    };
    TestBed.configureTestingModule({
        providers: [
            HistorySyncRuntime,
            { provide: RuntimeCapabilitiesService, useValue: capabilities },
            {
                provide: PlaylistsService,
                useValue: {
                    getAllPlaylists: () => of([playlist, portal]),
                    getPlaylistById: (id: string) =>
                        of(id === playlist._id ? playlist : portal),
                },
            },
            { provide: SourceSyncService, useValue: { refresh } },
            {
                provide: ParentalLockService,
                useValue: {
                    active: () => false,
                    withholdsEverything: () => false,
                    version: () => 0,
                },
            },
            { provide: Store, useValue: { dispatch } },
            { provide: ElectronXtreamDataSource, useValue: raw },
            { provide: PwaXtreamDataSource, useValue: raw },
        ],
    });
    const runtime = TestBed.inject(HistorySyncRuntime);
    return {
        runtime,
        request,
        local,
        records,
        scopes,
        raw,
        playlist,
        portal,
        recent,
        refresh,
        dispatch,
        capabilities,
        offline: (value: boolean) => {
            offline = value;
        },
    };
}
