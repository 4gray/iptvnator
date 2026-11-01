import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { clearCategoryScope } from './workspace-context-panel-route.utils';

describe('clearCategoryScope', () => {
    let router: Router;
    const xtreamStore = {
        setSelectedCategory: jest.fn(),
        setSelectedItem: jest.fn(),
    };
    const stalkerStore = {
        setSelectedCategory: jest.fn(),
        setPage: jest.fn(),
        clearSelectedItem: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        TestBed.configureTestingModule({ providers: [provideRouter([])] });
        router = TestBed.inject(Router);
        jest.spyOn(router, 'navigate').mockResolvedValue(true);
    });

    it.each([
        ['xtreams', 'live'],
        ['xtreams', 'vod'],
        ['xtreams', 'series'],
        ['stalker', 'itv'],
        ['stalker', 'radio'],
        ['stalker', 'vod'],
        ['stalker', 'series'],
    ] as const)(
        'clears %s %s without resetting the other provider',
        (provider, section) => {
            const options = {
                router,
                playlistId: 'playlist-1',
                section,
                searchQuery: 'pending query',
            };
            const closesDetails = section === 'vod' || section === 'series';

            if (provider === 'xtreams') {
                clearCategoryScope({
                    ...options,
                    provider,
                    store: xtreamStore,
                });

                expect(xtreamStore.setSelectedCategory).toHaveBeenCalledWith(
                    null
                );
                expect(xtreamStore.setSelectedItem).toHaveBeenCalledTimes(
                    closesDetails ? 1 : 0
                );
                if (closesDetails) {
                    expect(xtreamStore.setSelectedItem).toHaveBeenCalledWith(
                        null
                    );
                }
                expect(stalkerStore.setSelectedCategory).not.toHaveBeenCalled();
                expect(stalkerStore.setPage).not.toHaveBeenCalled();
                expect(stalkerStore.clearSelectedItem).not.toHaveBeenCalled();
            } else {
                clearCategoryScope({
                    ...options,
                    provider,
                    store: stalkerStore,
                });

                expect(stalkerStore.setSelectedCategory).toHaveBeenCalledWith(
                    '*'
                );
                expect(stalkerStore.setPage).toHaveBeenCalledWith(0);
                expect(stalkerStore.clearSelectedItem).toHaveBeenCalledTimes(
                    closesDetails ? 1 : 0
                );
                expect(xtreamStore.setSelectedCategory).not.toHaveBeenCalled();
                expect(xtreamStore.setSelectedItem).not.toHaveBeenCalled();
            }

            if (closesDetails) {
                expect(router.navigate).toHaveBeenCalledWith(
                    ['/workspace', provider, 'playlist-1', section],
                    {
                        queryParamsHandling: 'merge',
                        queryParams: { q: 'pending query' },
                    }
                );
            } else {
                expect(router.navigate).not.toHaveBeenCalled();
            }
        }
    );

    it.each([
        ['  pending query  ', 'pending query'],
        ['', null],
        ['   ', null],
    ] as const)(
        'merges the current input %p into the destination query',
        (searchQuery, expectedQuery) => {
            clearCategoryScope({
                router,
                provider: 'xtreams',
                store: xtreamStore,
                playlistId: 'playlist-1',
                section: 'vod',
                searchQuery,
            });

            expect(router.navigate).toHaveBeenCalledWith(
                ['/workspace', 'xtreams', 'playlist-1', 'vod'],
                {
                    queryParamsHandling: 'merge',
                    queryParams: { q: expectedQuery },
                }
            );
        }
    );
});
