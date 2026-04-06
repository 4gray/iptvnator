import {
    createEnvironmentInjector,
    EnvironmentInjector,
    runInInjectionContext,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import {
    extractPortalPlaylistId,
    extractPortalSection,
    isWorkspaceLayoutRoute,
    queryParamSignal,
    routeParamSignal,
    resolveCurrentPortalPlaylistId,
    resolveCurrentPortalSection,
} from './portal-route.utils';

describe('portal-route.utils', () => {
    it('detects workspace layout from route data', () => {
        const route = {
            snapshot: {
                data: {
                    layout: 'workspace',
                },
            },
        } as unknown as ActivatedRoute;

        expect(isWorkspaceLayoutRoute(route)).toBe(true);
    });

    it('detects workspace layout from ancestor route data', () => {
        const parentRoute = {
            snapshot: {
                data: {
                    layout: 'workspace',
                },
            },
        } as ActivatedRoute;
        const childRoute = {
            snapshot: {
                data: {},
            },
            pathFromRoot: [
                {
                    snapshot: {
                        data: {},
                    },
                },
                parentRoute,
                {
                    snapshot: {
                        data: {},
                    },
                },
            ],
        } as unknown as ActivatedRoute;

        expect(isWorkspaceLayoutRoute(childRoute)).toBe(true);
    });

    it('extracts Xtream sections from workspace and local URLs', () => {
        expect(extractPortalSection('/xtreams/123/search', 'xtreams')).toBe(
            'search'
        );
        expect(
            extractPortalSection('/workspace/xtreams/123/recent', 'xtreams')
        ).toBe('recent');
    });

    it('extracts Stalker sections from workspace and local URLs', () => {
        expect(extractPortalSection('/stalker/321/series', 'stalker')).toBe(
            'series'
        );
        expect(
            extractPortalSection('/workspace/stalker/321/favorites', 'stalker')
        ).toBe('favorites');
    });

    it('extracts playlist ids from workspace and local URLs', () => {
        expect(
            extractPortalPlaylistId('/workspace/xtreams/123/search', 'xtreams')
        ).toBe('123');
        expect(extractPortalPlaylistId('/stalker/321/series', 'stalker')).toBe(
            '321'
        );
    });

    it('resolves portal sections from the active descendant chain and falls back to URL parsing', () => {
        const routeWithDescendants = {
            snapshot: {
                url: [],
            },
            firstChild: {
                snapshot: {
                    url: [{ path: 'workspace' }],
                },
                firstChild: {
                    snapshot: {
                        url: [{ path: 'stalker' }],
                    },
                    firstChild: {
                        snapshot: {
                            url: [{ path: 'vod' }],
                        },
                        firstChild: null,
                    },
                },
            },
        } as unknown as ActivatedRoute;
        const routeWithoutChild = {
            snapshot: {
                url: [],
            },
            firstChild: null,
        } as unknown as ActivatedRoute;

        expect(
            resolveCurrentPortalSection(
                routeWithDescendants,
                '/workspace/stalker/123/search',
                'stalker'
            )
        ).toBe('vod');
        expect(
            resolveCurrentPortalSection(
                routeWithoutChild,
                '/workspace/stalker/123/search',
                'stalker'
            )
        ).toBe('search');
    });

    it('resolves playlist ids from ancestors and falls back to URL parsing', () => {
        const routeWithParent = {
            pathFromRoot: [
                {
                    snapshot: {
                        params: {},
                        paramMap: convertToParamMap({}),
                    },
                },
                {
                    snapshot: {
                        params: { id: 'playlist-1' },
                        paramMap: convertToParamMap({ id: 'playlist-1' }),
                    },
                },
                {
                    snapshot: {
                        params: {},
                        paramMap: convertToParamMap({}),
                    },
                },
            ],
        } as unknown as ActivatedRoute;
        const routeWithoutParent = {
            pathFromRoot: [
                {
                    snapshot: {
                        params: {},
                        paramMap: convertToParamMap({}),
                    },
                },
            ],
        } as unknown as ActivatedRoute;

        expect(
            resolveCurrentPortalPlaylistId(
                routeWithParent,
                '/workspace/xtreams/ignored/vod',
                'xtreams'
            )
        ).toBe('playlist-1');
        expect(
            resolveCurrentPortalPlaylistId(
                routeWithoutParent,
                '/workspace/stalker/playlist-2/vod',
                'stalker'
            )
        ).toBe('playlist-2');
    });

    it('creates normalized query-param signals', () => {
        TestBed.configureTestingModule({});

        const parentInjector = TestBed.inject(EnvironmentInjector);
        const childInjector = createEnvironmentInjector([], parentInjector);
        const queryParams$ = new BehaviorSubject(
            convertToParamMap({
                q: ' Matrix ',
                refresh: '42',
            })
        );
        const route = {
            snapshot: {
                data: {},
                queryParamMap: convertToParamMap({
                    q: ' Matrix ',
                    refresh: '42',
                }),
            },
            queryParamMap: queryParams$.asObservable(),
        } as unknown as ActivatedRoute;

        const searchTerm = runInInjectionContext(childInjector, () =>
            queryParamSignal(route, 'q', (value) =>
                (value ?? '').trim().toLowerCase()
            )
        );
        const refreshToken = runInInjectionContext(childInjector, () =>
            queryParamSignal(route, 'refresh', (value) => value ?? '')
        );

        expect(searchTerm()).toBe('matrix');
        expect(refreshToken()).toBe('42');

        queryParams$.next(
            convertToParamMap({
                q: 'Alien',
                refresh: '84',
            })
        );

        expect(searchTerm()).toBe('alien');
        expect(refreshToken()).toBe('84');

        childInjector.destroy();
    });

    it('creates route-param signals that react to current route param changes', () => {
        TestBed.configureTestingModule({});

        const parentInjector = TestBed.inject(EnvironmentInjector);
        const childInjector = createEnvironmentInjector([], parentInjector);
        const paramMap$ = new BehaviorSubject(
            convertToParamMap({
                id: 'playlist-1',
            })
        );
        const route = {
            snapshot: {
                data: {},
                paramMap: convertToParamMap({
                    id: 'playlist-1',
                }),
                params: {
                    id: 'playlist-1',
                },
            },
            paramMap: paramMap$.asObservable(),
        } as unknown as ActivatedRoute;

        const playlistId = runInInjectionContext(childInjector, () =>
            routeParamSignal(route, 'id', (value) => value ?? '')
        );

        expect(playlistId()).toBe('playlist-1');

        route.snapshot.paramMap = convertToParamMap({
            id: 'playlist-2',
        });
        route.snapshot.params = {
            id: 'playlist-2',
        };
        paramMap$.next(
            convertToParamMap({
                id: 'playlist-2',
            })
        );

        expect(playlistId()).toBe('playlist-2');

        childInjector.destroy();
    });

    it('creates route-param signals that react to ancestor route param changes', () => {
        TestBed.configureTestingModule({});

        const parentInjector = TestBed.inject(EnvironmentInjector);
        const childInjector = createEnvironmentInjector([], parentInjector);
        const parentParamMap$ = new BehaviorSubject(
            convertToParamMap({
                id: 'playlist-1',
            })
        );
        const childParamMap$ = new BehaviorSubject(convertToParamMap({}));
        const parentRoute = {
            snapshot: {
                data: {},
                paramMap: convertToParamMap({
                    id: 'playlist-1',
                }),
                params: {
                    id: 'playlist-1',
                },
            },
            paramMap: parentParamMap$.asObservable(),
        } as ActivatedRoute;
        const route = {
            snapshot: {
                data: {},
                paramMap: convertToParamMap({}),
                params: {},
            },
            paramMap: childParamMap$.asObservable(),
            pathFromRoot: [] as ActivatedRoute[],
        } as ActivatedRoute & {
            pathFromRoot: ActivatedRoute[];
        };
        route.pathFromRoot = [parentRoute, route];

        const playlistId = runInInjectionContext(childInjector, () =>
            routeParamSignal(route, 'id', (value) => value ?? '')
        );

        expect(playlistId()).toBe('playlist-1');

        (parentRoute.snapshot as ActivatedRoute['snapshot']).paramMap =
            convertToParamMap({
                id: 'playlist-2',
            });
        (parentRoute.snapshot as ActivatedRoute['snapshot']).params = {
            id: 'playlist-2',
        };
        parentParamMap$.next(
            convertToParamMap({
                id: 'playlist-2',
            })
        );

        expect(playlistId()).toBe('playlist-2');

        childInjector.destroy();
    });
});
