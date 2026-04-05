import { createXtreamRoutes } from './xtream-feature.routes';

describe('createXtreamRoutes', () => {
    it('keeps import-driven routes behind the content gate and leaves collections outside it', () => {
        const [xtreamRoute] = createXtreamRoutes();
        const gateRoute = xtreamRoute.children?.find(
            (route) => route.path === '' && typeof route.loadComponent === 'function'
        );

        expect(gateRoute?.children?.map((route) => route.path)).toEqual(
            expect.arrayContaining([
                'live',
                'live/:categoryId',
                'vod',
                'series',
                'search',
                'recently-added',
            ])
        );

        expect(xtreamRoute.children?.find((route) => route.path === 'favorites'))
            .toMatchObject({ path: 'favorites' });
        expect(xtreamRoute.children?.find((route) => route.path === 'recent'))
            .toMatchObject({ path: 'recent' });
        expect(xtreamRoute.children?.find((route) => route.path === 'downloads'))
            .toMatchObject({ path: 'downloads' });
    });
});
