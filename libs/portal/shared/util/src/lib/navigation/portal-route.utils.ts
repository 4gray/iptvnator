import { Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { combineLatest, map, of } from 'rxjs';
import {
    PortalProvider,
    PortalRailSection,
} from './portal-rail-links';

type QueryParamNormalizer<T> = (value: string | null) => T;
type RouteParamNormalizer<T> = (value: string | null) => T;

const PORTAL_SECTIONS = new Set<PortalRailSection>([
    'all',
    'downloads',
    'favorites',
    'groups',
    'itv',
    'library',
    'live',
    'recent',
    'recently-added',
    'search',
    'series',
    'vod',
]);

export function isWorkspaceLayoutRoute(route: ActivatedRoute): boolean {
    const routeChain =
        Array.isArray(route.pathFromRoot) && route.pathFromRoot.length > 0
            ? route.pathFromRoot
            : [route];

    return routeChain.some(
        (currentRoute) => currentRoute.snapshot.data['layout'] === 'workspace'
    );
}

export function queryParamSignal<T = string>(
    route: ActivatedRoute,
    key: string,
    normalizer?: QueryParamNormalizer<T>
): Signal<T> {
    const normalize =
        normalizer ??
        (((
            value: string | null
        ) => (value ?? '') as T) as QueryParamNormalizer<T>);

    return toSignal(
        route.queryParamMap.pipe(map((params) => normalize(params.get(key)))),
        {
            initialValue: normalize(route.snapshot.queryParamMap.get(key)),
        }
    );
}

export function routeParamSignal<T = string>(
    route: ActivatedRoute,
    key: string,
    normalizer?: RouteParamNormalizer<T>
): Signal<T> {
    const normalize =
        normalizer ??
        (((
            value: string | null
        ) => (value ?? '') as T) as RouteParamNormalizer<T>);
    const routeChain =
        Array.isArray(route.pathFromRoot) && route.pathFromRoot.length > 0
            ? route.pathFromRoot
            : [route];

    return toSignal(
        combineLatest(
            routeChain.map((currentRoute) =>
                currentRoute.paramMap ??
                of(
                    currentRoute.snapshot.paramMap ??
                        convertToParamMap(currentRoute.snapshot.params ?? {})
                )
            )
        ).pipe(map(() => normalize(resolveCurrentRouteParam(route, key)))),
        {
            initialValue: normalize(resolveCurrentRouteParam(route, key)),
        }
    );
}

export function extractPortalSection(
    url: string,
    provider: PortalProvider
): PortalRailSection | null {
    const match = url.match(
        new RegExp(`^/(?:workspace/)?${provider}/[^/?]+/([^/?]+)`)
    );
    return (match?.[1] as PortalRailSection | undefined) ?? null;
}

export function extractPortalPlaylistId(
    url: string,
    provider: PortalProvider
): string | null {
    const match = url.match(new RegExp(`^/(?:workspace/)?${provider}/([^/?]+)`));
    return match?.[1] ?? null;
}

export function resolveCurrentPortalPlaylistId(
    route: ActivatedRoute,
    routerUrl: string,
    provider: PortalProvider
): string | null {
    const resolved = resolveCurrentRouteParam(route, 'id');
    if (resolved) {
        return resolved;
    }

    return extractPortalPlaylistId(routerUrl, provider);
}

function resolveCurrentRouteParam(
    route: ActivatedRoute,
    key: string
): string | null {
    const routeChain =
        Array.isArray(route.pathFromRoot) && route.pathFromRoot.length > 0
            ? route.pathFromRoot
            : [route];

    for (let index = routeChain.length - 1; index >= 0; index -= 1) {
        const currentRoute = routeChain[index];
        const value =
            currentRoute.snapshot.paramMap?.get(key) ??
            currentRoute.snapshot.params?.[key];
        if (value) {
            return value;
        }
    }

    return null;
}

export function resolveCurrentPortalSection(
    route: ActivatedRoute,
    routerUrl: string,
    provider: PortalProvider
): PortalRailSection | null {
    let currentRoute: ActivatedRoute | null = route;
    while (currentRoute) {
        const currentSegment = currentRoute.snapshot.url?.[0]?.path;
        if (
            currentSegment &&
            PORTAL_SECTIONS.has(currentSegment as PortalRailSection)
        ) {
            return currentSegment as PortalRailSection;
        }

        currentRoute = currentRoute.firstChild;
    }

    return extractPortalSection(routerUrl, provider);
}
