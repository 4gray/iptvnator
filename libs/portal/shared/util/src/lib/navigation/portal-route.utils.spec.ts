import {
    createEnvironmentInjector,
    EnvironmentInjector,
    runInInjectionContext,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import {
    extractPortalSection,
    isWorkspaceLayoutRoute,
    queryParamSignal,
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

    it('prefers the child snapshot section and falls back to URL parsing', () => {
        const routeWithChild = {
            firstChild: {
                snapshot: {
                    url: [{ path: 'vod' }],
                },
            },
        } as unknown as ActivatedRoute;
        const routeWithoutChild = {
            firstChild: null,
        } as unknown as ActivatedRoute;

        expect(
            resolveCurrentPortalSection(
                routeWithChild,
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
});
