import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
    PORTAL_CATALOG_DETAIL_COMPONENT,
    PORTAL_CATALOG_FACADE,
    STALKER_SIMILAR_ORIGIN,
    type PortalCatalogFacade,
} from '@iptvnator/portal/shared/util';
import { ParentalLockService } from '@iptvnator/services';
import { of } from 'rxjs';
import { CategoryContentViewComponent } from './category-content-view.component';

describe('Stalker catalog return from Similar', () => {
    const originalHistory = window.history.state;
    afterEach(() => window.history.replaceState(originalHistory, ''));

    it.each([false, true])(
        'reopens the original detail only while its category is visible (relocked: %s)',
        async (relocked) => {
            type Item = { id: string; category_id: string | number };
            const selectedItem = signal<Item | null>(null);
            const lastNavigation = signal<{
                trigger: 'imperative' | 'popstate';
                finalUrl?: { fragment: string };
            } | null>(null);
            const isStalkerCategoryLocked = jest.fn(() => false);
            const catalog = {
                provider: 'stalker',
                playlist: signal({ id: 'fixture-source' }),
                contentType: signal('vod'),
                selectedCategory: signal({ id: '5' }),
                paginatedContent: signal([]),
                selectedItem,
                isPaginatedContentLoading: signal(false),
                selectedCategoryTitle: signal('Fixture category'),
                categoryItemCount: signal(0),
                contentSortMode: signal(null),
                hasMore: signal(false),
                isAppending: signal(false),
                appendError: signal(false),
                loadMore: jest.fn(),
                retryAppend: jest.fn(),
                initialize: jest.fn(),
                clearSelectedItem: () => selectedItem.set(null),
                setContentSortMode: jest.fn(),
                selectItem: (item: Item) => {
                    selectedItem.set(item);
                    return null;
                },
                getItemProgress: () => ({}),
                restoreCatalogSimilarReturn: jest.fn(),
            } satisfies PortalCatalogFacade<{ id: string }, Item, Item>;

            TestBed.configureTestingModule({
                imports: [CategoryContentViewComponent],
                providers: [
                    { provide: PORTAL_CATALOG_FACADE, useValue: catalog },
                    {
                        provide: PORTAL_CATALOG_DETAIL_COMPONENT,
                        useValue: null,
                    },
                    {
                        provide: Router,
                        useValue: { lastSuccessfulNavigation: lastNavigation },
                    },
                    {
                        provide: ParentalLockService,
                        useValue: { isStalkerCategoryLocked },
                    },
                    {
                        provide: ActivatedRoute,
                        useValue: {
                            paramMap: of(
                                convertToParamMap({ categoryId: '5' })
                            ),
                            queryParamMap: of(convertToParamMap({})),
                        },
                    },
                ],
            }).overrideComponent(CategoryContentViewComponent, {
                set: { template: '' },
            });
            const fixture = TestBed.createComponent(
                CategoryContentViewComponent
            );
            fixture.detectChanges();

            const shell = document.createElement('app-portal-detail-shell');
            shell.tabIndex = -1;
            fixture.nativeElement.appendChild(shell);
            const destination = { id: '2', category_id: 5 };
            window.history.replaceState({ openStalkerItem: destination }, '');
            lastNavigation.set({
                trigger: 'imperative',
                finalUrl: { fragment: 'stalker-related-11' },
            });
            fixture.detectChanges();
            await fixture.whenStable();
            expect(selectedItem()).toEqual(destination);
            expect(document.activeElement).toBe(shell);

            const original = { id: '1', category_id: '5' };
            isStalkerCategoryLocked.mockReturnValue(relocked);
            window.history.replaceState(
                {
                    [STALKER_SIMILAR_ORIGIN]: {
                        playlistId: 'fixture-source',
                        catalog: 'vod',
                        item: original,
                        catalogReturnId: 11,
                    },
                },
                ''
            );
            lastNavigation.set({ trigger: 'popstate' });
            fixture.detectChanges();
            expect(
                window.history.state[STALKER_SIMILAR_ORIGIN]
            ).toBeUndefined();
            expect(selectedItem()).toEqual(relocked ? null : original);
            expect(catalog.restoreCatalogSimilarReturn.mock.calls).toEqual(
                relocked ? [] : [[11]]
            );
            expect(catalog.initialize).toHaveBeenCalledTimes(1);
        }
    );
});
