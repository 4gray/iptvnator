import { Component, OnDestroy, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    ActivatedRouteSnapshot,
    provideRouter,
    Router,
    RouterOutlet,
    UrlSegment,
    UrlSegmentGroup,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { createXtreamRoutes } from './xtream-feature.routes';

@Component({ template: '<router-outlet />', imports: [RouterOutlet] })
class ContentGateStubComponent {}

@Component({ template: '' })
class LiveLayoutStubComponent implements OnDestroy {
    readonly activePlayback = signal<string | null>(null);
    destroyed = false;

    ngOnDestroy(): void {
        this.destroyed = true;
    }
}

describe('createXtreamRoutes', () => {
    it('keeps import-driven routes behind the content gate and leaves collections outside it', () => {
        const [xtreamRoute] = createXtreamRoutes();
        const gateRoute = xtreamRoute.children?.find(
            (route) =>
                route.path === '' && typeof route.loadComponent === 'function'
        );

        expect(gateRoute?.children?.map((route) => route.path)).toEqual(
            expect.arrayContaining([
                'vod',
                'series',
                'search',
                'actor/:personId',
                'discover',
                'recently-added',
            ])
        );
        expect(
            gateRoute?.children?.filter((route) => route.matcher)
        ).toHaveLength(1);

        expect(
            xtreamRoute.children?.find((route) => route.path === 'favorites')
        ).toMatchObject({ path: 'favorites' });
        expect(
            xtreamRoute.children?.find((route) => route.path === 'recent')
        ).toMatchObject({ path: 'recent' });
        expect(
            xtreamRoute.children?.find((route) => route.path === 'downloads')
        ).toMatchObject({ path: 'downloads' });
    });

    it.each([
        [[], null],
        [['vod'], null],
        [['live', '42', 'extra'], null],
        [['live'], undefined],
        [['live', '42'], '42'],
    ])(
        'matches only live URLs with an optional category: %j',
        (paths, categoryId) => {
            const gate = createXtreamRoutes()[0].children?.find(
                (route) => route.path === '' && route.loadComponent
            );
            const liveRoute = gate?.children?.find((route) => route.matcher);
            if (!liveRoute?.matcher)
                throw new Error('Shared live route is missing.');
            const segments = paths.map((path) => new UrlSegment(path, {}));
            const result = liveRoute.matcher(
                segments,
                new UrlSegmentGroup(segments, {}),
                liveRoute
            );
            if (categoryId === null) {
                expect(result).toBeNull();
            } else {
                expect(result?.consumed).toEqual(segments);
                expect(result?.posParams?.['categoryId']?.path).toBe(
                    categoryId
                );
            }
        }
    );

    describe('Xtream live route lifecycle', () => {
        let router: Router;
        const guard = jest.fn((route: ActivatedRouteSnapshot) =>
            route.paramMap.get('categoryId') === '99'
                ? router.createUrlTree(['/workspace/xtreams/playlist-1/live'])
                : true
        );

        beforeEach(() => {
            guard.mockClear();
            const routes = createXtreamRoutes();
            const xtreamRoute = routes[0];
            xtreamRoute.providers = [];
            const gate = xtreamRoute.children?.find(
                (route) => route.path === '' && route.loadComponent
            );
            if (!gate) throw new Error('Xtream content gate is missing.');
            gate.loadComponent = async () => ContentGateStubComponent;
            for (const route of gate.children ?? []) {
                if (route.path?.startsWith('live') || route.matcher) {
                    route.loadComponent = async () => LiveLayoutStubComponent;
                    route.canActivate = [guard];
                }
            }
            TestBed.configureTestingModule({
                providers: [
                    provideRouter([{ path: 'workspace', children: routes }]),
                ],
            });
            router = TestBed.inject(Router);
        });

        async function openLive(harness: RouterTestingHarness, url: string) {
            await harness.navigateByUrl(url);
            const live = harness.routeDebugElement?.query(
                (element) =>
                    element.componentInstance instanceof LiveLayoutStubComponent
            )?.componentInstance;
            if (!(live instanceof LiveLayoutStubComponent)) {
                throw new Error('Live layout is not mounted.');
            }
            return live;
        }

        it('keeps playback mounted when clearing a category URL and preserves the query', async () => {
            const harness = await RouterTestingHarness.create();
            const original = await openLive(
                harness,
                '/workspace/xtreams/playlist-1/live/42?q=news&sort=name'
            );
            original.activePlayback.set('playing-channel');

            await router.navigate(['/workspace/xtreams/playlist-1/live'], {
                queryParamsHandling: 'merge',
                replaceUrl: true,
            });

            expect(original.destroyed).toBe(false);
            expect(await openLive(harness, router.url)).toBe(original);
            expect(original.activePlayback()).toBe('playing-channel');
            expect(router.url).toBe(
                '/workspace/xtreams/playlist-1/live?q=news&sort=name'
            );
        });

        it('reuses the layout and reruns the category guard when adding or changing a category', async () => {
            const harness = await RouterTestingHarness.create();
            const original = await openLive(
                harness,
                '/workspace/xtreams/playlist-1/live'
            );
            original.activePlayback.set('playing-channel');
            guard.mockClear();

            for (const categoryId of ['42', '43']) {
                expect(
                    await openLive(
                        harness,
                        `/workspace/xtreams/playlist-1/live/${categoryId}`
                    )
                ).toBe(original);
                expect(
                    guard.mock.calls.at(-1)?.[0].paramMap.get('categoryId')
                ).toBe(categoryId);
            }

            expect(guard).toHaveBeenCalledTimes(2);
            expect(original.destroyed).toBe(false);
            expect(original.activePlayback()).toBe('playing-channel');
        });

        it('retains playback when a refused category navigation redirects to the live root', async () => {
            const harness = await RouterTestingHarness.create();
            const original = await openLive(
                harness,
                '/workspace/xtreams/playlist-1/live/42'
            );
            original.activePlayback.set('playing-channel');

            expect(
                await openLive(harness, '/workspace/xtreams/playlist-1/live/99')
            ).toBe(original);
            expect(router.url).toBe('/workspace/xtreams/playlist-1/live');
            expect(original.destroyed).toBe(false);
            expect(original.activePlayback()).toBe('playing-channel');
        });
    });
});
