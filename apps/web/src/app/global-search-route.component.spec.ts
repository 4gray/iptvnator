import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { OPEN_STALKER_ITEM_STATE_KEY } from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { ParentalLockService } from '@iptvnator/services';
import { GlobalSearchRouteComponent } from './global-search-route.component';
import {
    type StalkerGlobalSearchItem,
    StalkerGlobalSearchService,
} from './stalker-global-search.service';

describe('GlobalSearchRouteComponent', () => {
    const globalUrl = '/workspace/search?q=Fixture%20comet';
    const filters = signal({ live: true, movie: false, series: true });
    const preview = {
        search: jest.fn(),
        canOpen: jest.fn(),
        groups: signal([]),
    };
    const navigate = jest.fn().mockResolvedValue(true);
    const source = {
        _id: 'portal-a',
        title: 'Fixture portal',
        portalUrl: 'https://portal.example.test/portal.php',
        macAddress: '00:1A:79:00:00:01',
    };
    let component: GlobalSearchRouteComponent;

    beforeEach(() => {
        jest.clearAllMocks();
        const queryParamMap = convertToParamMap({ q: 'Fixture comet' });
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: ActivatedRoute,
                    useValue: {
                        queryParamMap: of(queryParamMap),
                        snapshot: { queryParamMap },
                    },
                },
                { provide: Router, useValue: { url: globalUrl, navigate } },
                {
                    provide: Store,
                    useValue: { selectSignal: () => signal([source]) },
                },
                { provide: XtreamStore, useValue: { searchFilters: filters } },
                {
                    provide: ParentalLockService,
                    useValue: { version: () => 7 },
                },
                { provide: StalkerGlobalSearchService, useValue: preview },
            ],
        });
        component = TestBed.runInInjectionContext(
            () => new GlobalSearchRouteComponent()
        );
    });

    it('searches Stalker automatically with the applied global query and filters', () => {
        TestBed.tick();
        expect(preview.search).toHaveBeenCalledTimes(1);
        expect(preview.search.mock.calls[0][0]()).toEqual({
            term: 'Fixture comet',
            movies: false,
            series: true,
            sources: [source],
            lockVersion: 7,
        });
    });

    it.each(['vod', 'series'] as const)(
        'opens a series through its original %s catalog and keeps the global return URL',
        (origin) => {
            const result: StalkerGlobalSearchItem = {
                key: `portal-a:${origin}:42`,
                playlistId: 'portal-a',
                origin,
                id: '42',
                displayType: 'series',
                item: { movie_id: '42', category_id: '7', is_series: '1' },
            };
            preview.canOpen.mockReturnValue(false);
            component.openStalkerItem(result);
            expect(navigate).not.toHaveBeenCalled();

            preview.canOpen.mockReturnValue(true);
            component.openStalkerItem(result);
            expect(navigate).toHaveBeenCalledWith(
                ['/workspace', 'stalker', 'portal-a', origin, '7'],
                {
                    state: {
                        [OPEN_STALKER_ITEM_STATE_KEY]: {
                            ...result.item,
                            id: '42',
                        },
                        stalkerReturnTo: globalUrl,
                    },
                }
            );
        }
    );
});
