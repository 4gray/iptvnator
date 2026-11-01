import type { XtreamPendingRestoreState } from '@iptvnator/shared/interfaces';
import { XtreamDeferredCatalogRestoreService } from './xtream-deferred-catalog-restore.service';

const state = (): XtreamPendingRestoreState => ({
    favorites: [],
    playbackPositions: [],
    hiddenCategories: [1, 2].map((xtreamId) => ({
        categoryType: 'movies',
        xtreamId,
    })),
    recentlyViewed: [1, 2].map((xtreamId) => ({
        contentType: 'movie',
        xtreamId,
        viewedAt: 'synthetic-time',
    })),
});
let service: XtreamDeferredCatalogRestoreService;
beforeEach(() => {
    localStorage.clear();
    service = new XtreamDeferredCatalogRestoreService();
});
afterEach(() => localStorage.clear());

it('parks available identities before replay so an empty native proof cannot lose them', () => {
    const prepared = service.prepare('synthetic', state(), ['movie']);
    expect(prepared.snapshot.state.recentlyViewed).toEqual(
        state().recentlyViewed
    );
    expect(prepared.snapshot.state.hiddenCategories).toEqual(
        state().hiddenCategories
    );
    service.complete('synthetic', prepared.snapshot, ['movie'], {
        identities: [],
    });
    expect(
        service.forExport('synthetic', {
            hiddenCategories: [],
            recentlyViewed: [],
        })
    ).toEqual({
        hiddenCategories: state().hiddenCategories,
        recentlyViewed: state().recentlyViewed,
    });
});

it('retains missing identities when a formerly dormant type becomes available', () => {
    const parked = service.prepare('synthetic', state(), []);
    service.complete('synthetic', parked.snapshot, ['movie'], {
        identities: [{ contentType: 'movie', xtreamId: 1 }],
    });
    expect(service.getSnapshot('synthetic').state.recentlyViewed).toEqual([
        state().recentlyViewed[1],
    ]);
    expect(service.getSnapshot('synthetic').state.hiddenCategories).toEqual(
        state().hiddenCategories
    );
});

it('retains unresolved history in an available authoritative native journal', () => {
    service.prepare('synthetic', state(), []);
    const current = { ...state(), recentlyViewed: [state().recentlyViewed[1]] };
    const prepared = service.prepare(
        'synthetic',
        current,
        ['movie'],
        false,
        true
    );
    expect(prepared.snapshot.state.recentlyViewed).toEqual(
        current.recentlyViewed
    );
    service.complete('synthetic', prepared.snapshot, ['movie'], {
        identities: [],
    });
    expect(service.getSnapshot('synthetic').state.recentlyViewed).toEqual(
        current.recentlyViewed
    );
});

it('does not export-drop an absent movie merely because its recovery includes movie', () => {
    const prepared = service.prepare('synthetic', state(), []);
    expect(
        service.forExport(
            'synthetic',
            { hiddenCategories: [], recentlyViewed: [] },
            undefined,
            {
                snapshot: prepared.snapshot,
                contentTypes: ['movie'],
            }
        ).recentlyViewed
    ).toEqual(state().recentlyViewed);
});

it('consumes only applied typed categories, retaining missing and colliding choices', () => {
    const archived = state();
    archived.hiddenCategories.push({ categoryType: 'series', xtreamId: 1 });
    const prepared = service.prepare('synthetic', archived, []);
    service.complete(
        'synthetic',
        prepared.snapshot,
        ['movie', 'series'],
        { identities: [] },
        [{ categoryType: 'movies', xtreamId: 1 }]
    );
    expect(service.getSnapshot('synthetic').state.hiddenCategories).toEqual([
        { categoryType: 'movies', xtreamId: 2 },
        { categoryType: 'series', xtreamId: 1 },
    ]);
});

it('captures an authoritative visible category without losing unrelated missing choices', () => {
    service.prepare('synthetic', state(), []);
    const prepared = service.prepare(
        'synthetic',
        {
            ...state(),
            hiddenCategories: [],
            recentlyViewed: [],
        },
        ['movie'],
        true,
        false,
        [{ categoryType: 'movies', xtreamId: 1 }]
    );
    expect(prepared.snapshot.state.hiddenCategories).toEqual([
        { categoryType: 'movies', xtreamId: 2 },
    ]);
    expect(prepared.snapshot.state.recentlyViewed).toEqual(
        state().recentlyViewed
    );
});
