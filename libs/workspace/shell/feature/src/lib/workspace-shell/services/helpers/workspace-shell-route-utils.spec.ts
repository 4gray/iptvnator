import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { syncSearchQueryParam } from './workspace-shell-route-utils';

describe('collection search history', () => {
    let router: Router;
    let navigate: jest.SpyInstance;

    beforeEach(() => {
        TestBed.configureTestingModule({ providers: [provideRouter([])] });
        router = TestBed.inject(Router);
        navigate = jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    });

    afterEach(() => window.history.replaceState({}, document.title));

    it.each([
        [
            '/workspace/global-favorites',
            'Synthetic',
            '/workspace/global-favorites?q=Synthetic',
        ],
        [
            '/workspace/global-recent?q=Synthetic',
            '',
            '/workspace/global-recent',
        ],
    ])('keeps the collection view when replacing %s', (url, query, target) => {
        window.history.replaceState(
            {
                navigationId: 17,
                '\u0275routerPageId': 9,
                openCollectionDetailItem: { oneShot: true },
                collectionViewState: {
                    selectedContentType: 'series',
                    scope: 'all',
                },
            },
            document.title
        );

        expect(syncSearchQueryParam(router, url, query)).toBe(true);

        expect(navigate).toHaveBeenCalledWith(target, {
            replaceUrl: true,
            state: {
                collectionViewState: {
                    selectedContentType: 'series',
                    scope: 'all',
                },
            },
        });
    });

    it('does not carry unrelated history keys into a catalog query', () => {
        window.history.replaceState(
            { navigationId: 17, openStalkerItem: { id: 'synthetic' } },
            document.title
        );
        syncSearchQueryParam(
            router,
            '/workspace/xtreams/synthetic/vod',
            'Synthetic'
        );
        expect(navigate).toHaveBeenCalledWith(
            '/workspace/xtreams/synthetic/vod?q=Synthetic',
            { replaceUrl: true }
        );
    });
});
