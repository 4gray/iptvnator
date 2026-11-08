import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import * as stalker from '@iptvnator/portal/stalker/data-access';
import {
    DataService,
    ParentalLockService,
    PlaylistsService,
} from '@iptvnator/services';
import {
    CONNECTIVITY_GUARD_RESET,
    type Playlist,
    type PlaylistMeta,
} from '@iptvnator/shared/interfaces';
import { EMPTY, of, Subject } from 'rxjs';
import type { StalkerGlobalSearchContext } from './stalker-global-search.service';

type LoadSearchPage = typeof stalker.loadStalkerSearchPage;
const loadPage = jest.fn<
    ReturnType<LoadSearchPage>,
    Parameters<LoadSearchPage>
>();
jest.unstable_mockModule('@iptvnator/portal/stalker/data-access', () => ({
    ...stalker,
    loadStalkerSearchPage: loadPage,
}));

const { StalkerGlobalSearchService } =
    await import('./stalker-global-search.service');

function source(suffix: string): PlaylistMeta {
    return {
        _id: `portal-${suffix}`,
        title: `Fixture Portal ${suffix.toUpperCase()}`,
        portalUrl: `https://portal-${suffix}.example.test`,
        macAddress: '02:00:00:00:00:01',
        importDate: '',
        count: 0,
        autoRefresh: false,
    };
}

const portalA = source('a');
const portalB = source('b');
const portalC = source('c');
const comet = 'Fixture comet';

describe('StalkerGlobalSearchService', () => {
    let preview: InstanceType<typeof StalkerGlobalSearchService>;
    const context = signal<StalkerGlobalSearchContext>({
        term: comet,
        movies: true,
        series: true,
        lockVersion: 0,
        sources: [portalA, portalB, portalC],
    });
    const sendIpcEvent = jest.fn();
    const getPlaylistById = jest.fn<
        ReturnType<PlaylistsService['getPlaylistById']>,
        [string]
    >();
    const applyOverride = jest.fn((playlist: PlaylistMeta) => playlist);
    const active = signal(false);
    const withholdsEverything = signal(false);
    const lockedStalkerIds = jest.fn<string[], [string, string]>();
    let requests: {
        resolve: (page: stalker.StalkerSearchPage) => void;
        reject: (error: Error) => void;
    }[];

    beforeEach(() => {
        context.set({
            term: comet,
            movies: true,
            series: true,
            lockVersion: 0,
            sources: [portalA, portalB, portalC],
        });
        requests = [];
        loadPage.mockReset().mockImplementation(
            () =>
                new Promise((resolve, reject) => {
                    requests.push({ resolve, reject });
                })
        );
        sendIpcEvent.mockReset();
        getPlaylistById.mockReset().mockImplementation((id) => {
            const playlist = context().sources.find(({ _id }) => _id === id);
            return playlist ? of({ ...playlist, lastUsage: '' }) : EMPTY;
        });
        applyOverride.mockReset().mockImplementation((playlist) => playlist);
        active.set(false);
        withholdsEverything.set(false);
        lockedStalkerIds.mockReset().mockReturnValue([]);
        TestBed.configureTestingModule({
            providers: [
                StalkerGlobalSearchService,
                { provide: DataService, useValue: { sendIpcEvent } },
                { provide: PlaylistsService, useValue: { getPlaylistById } },
                { provide: stalker.StalkerSessionService, useValue: {} },
                {
                    provide: stalker.StalkerPortalRepairService,
                    useValue: { applyOverride },
                },
                {
                    provide: ParentalLockService,
                    useValue: { active, withholdsEverything, lockedStalkerIds },
                },
            ],
        });
        preview = TestBed.inject(StalkerGlobalSearchService);
    });

    function setContext(changes: Partial<StalkerGlobalSearchContext>): void {
        context.update((value) => ({ ...value, ...changes }));
    }

    async function search(): Promise<void> {
        preview.search(context);
        await Promise.resolve();
    }

    async function resolve(
        request: number,
        rawItems: stalker.StalkerVodSource[] = [],
        totalItems = rawItems.length
    ): Promise<void> {
        requests[request].resolve({ rawItems, totalItems });
        await Promise.resolve();
        await Promise.resolve();
    }

    function calls() {
        return loadPage.mock.calls.map(([, playlist, origin, term]) => [
            playlist._id,
            origin,
            term,
        ]);
    }

    it('sends the full persisted portal mode and identity to the search pipeline', async () => {
        setContext({ sources: [portalA], series: false });
        const persisted: Playlist = {
            ...portalA,
            lastUsage: '',
            isFullStalkerPortal: true,
            stalkerDeviceId1: 'fixture-device',
        };
        getPlaylistById.mockReturnValueOnce(of(persisted));
        preview.search(context);
        await Promise.resolve();

        expect(loadPage).toHaveBeenCalledWith(
            expect.anything(),
            persisted,
            'vod',
            comet,
            1,
            { silent: true }
        );
    });

    it('skips dispatch if a source is reconfigured during playlist hydration', async () => {
        setContext({ sources: [portalA], series: false });
        const persisted = new Subject<Playlist>();
        getPlaylistById.mockReturnValueOnce(persisted);
        preview.search(context);
        setContext({
            sources: [{ ...portalA, portalUrl: 'https://edited.example.test' }],
        });
        persisted.next({ ...portalA, lastUsage: '' });
        await Promise.resolve();

        expect(loadPage).not.toHaveBeenCalled();
        expect(preview.groups()).toEqual([]);
    });

    it('reports a missing persisted row and recovers by retrying the read', async () => {
        setContext({ sources: [portalA], series: false });
        getPlaylistById.mockReturnValueOnce(EMPTY);
        preview.search(context);
        await Promise.resolve();

        expect(loadPage).not.toHaveBeenCalled();
        expect(preview.groups()[0]).toMatchObject({
            loading: false,
            hasError: true,
        });

        await preview.retry('portal-a', context);
        await Promise.resolve();
        expect(loadPage).toHaveBeenCalledTimes(1);
    });

    it('starts two portals in metadata order for the same minimum query as global search', async () => {
        TestBed.tick();
        expect(loadPage).not.toHaveBeenCalled();
        expect(preview.groups()).toEqual([]);
        setContext({ term: 'up' });
        preview.search(context);
        await search();
        expect(calls()).toEqual([
            ['portal-a', 'vod', 'up'],
            ['portal-b', 'vod', 'up'],
        ]);
        expect(loadPage).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining(portalA),
            'vod',
            'up',
            1,
            { silent: true }
        );
    });

    it('keeps settled cards without resending the query after a metadata update', async () => {
        setContext({ sources: [portalA], series: false });
        await search();
        await resolve(0, [{ id: 42 }], 5);
        setContext({ sources: [{ ...portalA, count: 7 }] });
        await search();

        expect(loadPage).toHaveBeenCalledTimes(1);
        expect(preview.groups()[0]).toMatchObject({
            more: ['vod'],
            items: [expect.objectContaining({ id: '42' })],
        });
    });

    it.each([
        { term: '  x ' },
        { movies: false, series: false },
        { sources: [{ ...portalA, macAddress: undefined }] },
    ])('does not dispatch for an ineligible context %o', async (changes) => {
        setContext(changes);
        await search();
        expect(preview.groups()).toEqual([]);
        expect(getPlaylistById).not.toHaveBeenCalled();
        expect(loadPage).not.toHaveBeenCalled();
    });

    it('retains both active slots across a superseding search', async () => {
        await search();
        setContext({ term: 'Fixture eclipse' });
        await search();
        expect(loadPage).toHaveBeenCalledTimes(2);

        await resolve(1, [{ id: 'old', name: 'Old result' }]);
        expect(calls()[2]).toEqual(['portal-a', 'vod', 'Fixture eclipse']);
        expect(preview.groups().every(({ items }) => !items.length)).toBe(true);
        await resolve(0);
        expect(calls()[3]).toEqual(['portal-b', 'vod', 'Fixture eclipse']);
    });

    it('publishes partial results in portal order with independent catalog identities', async () => {
        setContext({ sources: [portalA, portalB] });
        await search();
        await resolve(1, [{ id: '42', name: 'Second portal result' }]);
        expect(preview.groups()[1]).toMatchObject({
            playlistName: 'Fixture Portal B',
            loading: true,
            items: [{ playlistId: 'portal-b', id: '42', origin: 'vod' }],
        });
        await resolve(2, [{ series_id: 42, name: 'First portal series' }]);
        await resolve(0, [
            { id: ' ', stream_id: 42, is_series: '1' },
            { id: '42' },
            { name: 'No usable ID' },
        ]);
        await resolve(3);

        const [first, second] = preview.groups();
        expect([first.playlistId, second.playlistId]).toEqual([
            'portal-a',
            'portal-b',
        ]);
        expect(first.items).toHaveLength(2);
        expect(first.items).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    origin: 'vod',
                    displayType: 'series',
                }),
                expect.objectContaining({
                    origin: 'series',
                    displayType: 'series',
                }),
            ])
        );
        expect(
            new Set([...first.items, ...second.items].map(({ key }) => key))
                .size
        ).toBe(3);
    });

    it('only requests VOD and leaves a filtered-empty group for Movies', async () => {
        setContext({ sources: [portalA], series: false });
        await search();
        await resolve(0, [
            { id: 1, is_series: true },
            { id: 2, series: [1] },
        ]);
        expect(calls()).toEqual([['portal-a', 'vod', comet]]);
        expect(preview.groups()[0]).toMatchObject({
            origins: ['vod'],
            loading: false,
            hasError: false,
            items: [],
        });
    });

    it('includes all matching series from the first page of both catalogs', async () => {
        setContext({ sources: [portalA], movies: false });
        await search();
        await resolve(1, [{ id: 1, name: 'Regular series' }]);
        await resolve(0, [
            { id: 1, name: 'VOD movie' },
            { id: 2, is_series: 1 },
            { id: 3, series: ['episode'] },
            ...Array.from({ length: 8 }, (_, index) => ({
                id: index + 4,
                is_series: true,
            })),
        ]);
        const [{ items }] = preview.groups();
        expect(items).toHaveLength(11);
        expect(items).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ origin: 'series', id: '1' }),
                expect.objectContaining({ origin: 'vod', id: '2' }),
                expect.objectContaining({ origin: 'vod', id: '3' }),
            ])
        );
        expect(items.every(({ displayType }) => displayType === 'series')).toBe(
            true
        );
    });

    it('retries only a failed catalog and retains the successful page', async () => {
        setContext({ sources: [portalA] });
        await search();
        requests[0].reject(new Error('Fixture failure'));
        await resolve(1, [{ id: 42 }]);
        const [retained] = preview.groups()[0].items;
        expect(preview.groups()[0]).toMatchObject({
            loading: false,
            hasError: true,
        });

        const effective = {
            ...portalA,
            portalUrl: 'https://repair.example.test',
        };
        applyOverride.mockReturnValue(effective);
        await preview.retry('portal-a', context);
        await Promise.resolve();
        expect(sendIpcEvent).toHaveBeenCalledWith(CONNECTIVITY_GUARD_RESET, {
            url: effective.portalUrl,
        });
        expect(calls()).toEqual([
            ['portal-a', 'vod', comet],
            ['portal-a', 'series', comet],
            ['portal-a', 'vod', comet],
        ]);
        expect(preview.groups()[0].items).toEqual([retained]);
        await resolve(2, [{ id: 9 }]);
        expect(preview.groups()[0]).toMatchObject({
            loading: false,
            hasError: false,
        });
        expect(preview.groups()[0].items).toContain(retained);
    });

    it('rechecks the portal after waiting for the retry guard reset', async () => {
        setContext({ sources: [portalA], series: false });
        await search();
        requests[0].reject(new Error('Fixture failure'));
        await Promise.resolve();
        let finishReset!: () => void;
        sendIpcEvent.mockReturnValue(
            new Promise<void>((resolve) => {
                finishReset = resolve;
            })
        );

        const retry = preview.retry('portal-a', context);
        void preview.retry('portal-a', context);
        setContext({ sources: [] });
        finishReset();
        await retry;
        expect(sendIpcEvent).toHaveBeenCalledTimes(1);
        expect(loadPage).toHaveBeenCalledTimes(1);
        expect(preview.groups()).toEqual([]);
    });

    it.each([
        { term: '' },
        { term: 'Fixture eclipse' },
        { movies: false },
        { lockVersion: 1 },
        { sources: [] },
        { sources: [{ ...portalA, portalUrl: 'https://edited.example.test' }] },
        { sources: [{ ...portalA, isFullStalkerPortal: true }] },
        { sources: [{ ...portalA, stalkerDeviceId1: 'fixture-device' }] },
    ])(
        'discards pending results after a context change %o',
        async (changes) => {
            setContext({ sources: [portalA], series: false });
            await search();
            setContext(changes);
            expect(preview.groups()).toEqual([]);
            await resolve(0, [{ id: 42 }]);
            expect(preview.groups()).toEqual([]);
        }
    );

    it('retires a submission across an observed A → B → A query change', async () => {
        setContext({ sources: [portalA] });
        await search();
        TestBed.tick();
        setContext({ term: 'Fixture eclipse' });
        TestBed.tick();
        setContext({ term: comet });
        await resolve(0, [{ id: 42 }]);
        expect(preview.groups()).toEqual([]);
    });

    it('drops just the removed portal and skips its queued catalog', async () => {
        setContext({ sources: [portalA, portalB] });
        await search();
        setContext({ sources: [portalB] });
        expect(preview.groups().map(({ playlistId }) => playlistId)).toEqual([
            'portal-b',
        ]);
        await resolve(0, [{ id: 42 }]);
        await resolve(1, [{ id: 42 }]);
        expect(calls()).toEqual([
            ['portal-a', 'vod', comet],
            ['portal-b', 'vod', comet],
            ['portal-b', 'series', comet],
        ]);
        expect(preview.groups()[0].items).toMatchObject([
            { playlistId: 'portal-b', id: '42' },
        ]);
        setContext({ sources: [portalA, portalB] });
        expect(preview.groups().map(({ playlistId }) => playlistId)).toEqual([
            'portal-b',
        ]);
    });

    it('accepts a response after the request repairs its own connection', async () => {
        setContext({ sources: [portalA], series: false });
        await search();
        const repaired = {
            ...portalA,
            portalUrl: 'https://repair.example.test',
            isFullStalkerPortal: true,
        };
        applyOverride.mockImplementation((playlist) =>
            playlist.portalUrl === portalA.portalUrl ? repaired : playlist
        );
        setContext({ sources: [repaired] });
        await resolve(0, [{ id: 42 }]);
        const [item] = preview.groups()[0].items;
        expect(item.id).toBe('42');
        expect(preview.canOpen(item)).toBe(true);
    });

    it('filters by origin catalog and rechecks locks on activation', async () => {
        setContext({ sources: [portalA] });
        active.set(true);
        lockedStalkerIds.mockImplementation((_, origin) =>
            origin === 'vod' ? ['9'] : []
        );
        await search();
        await resolve(0, [{ id: 42, is_series: 1, category_id: '9' }]);
        await resolve(1, [{ id: 42, category_id: '9' }]);
        const [{ items }] = preview.groups();
        expect(items).toMatchObject([{ origin: 'series', id: '42' }]);
        expect(preview.canOpen(items[0])).toBe(true);
        withholdsEverything.set(true);
        expect(preview.canOpen(items[0])).toBe(false);
        expect(preview.groups()[0].items).toEqual([]);
    });

    it('withholds rows with and without a category when locks are unreadable', async () => {
        setContext({ sources: [portalA], series: false });
        active.set(true);
        withholdsEverything.set(true);
        await search();
        await resolve(0, [{ id: 42 }, { id: 43, category_id: '9' }]);
        expect(preview.groups()[0]).toMatchObject({
            items: [],
            hasError: false,
        });
    });

    it('rejects a card from an older submission even if its ID matches', async () => {
        setContext({ sources: [portalA], series: false });
        await search();
        await resolve(0, [{ id: 42 }]);
        const [previous] = preview.groups()[0].items;
        setContext({ term: 'Fixture eclipse' });
        await search();
        await resolve(1, [{ id: 42 }]);
        expect(preview.canOpen(previous)).toBe(false);
        expect(preview.canOpen(preview.groups()[0].items[0])).toBe(true);
    });

    it('drops queued and pending work when destroyed', async () => {
        await search();
        TestBed.resetTestingModule();
        await resolve(0, [{ id: 42 }]);
        await resolve(1, [{ id: 43 }]);
        expect(loadPage).toHaveBeenCalledTimes(2);
        expect(preview.groups()).toEqual([]);
    });
});
