import { Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import {
    PortalProvider,
    PortalRailSection,
} from './portal-rail-links';

type QueryParamNormalizer<T> = (value: string | null) => T;

export function isWorkspaceLayoutRoute(route: ActivatedRoute): boolean {
    return route.snapshot.data['layout'] === 'workspace';
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

export function extractPortalSection(
    url: string,
    provider: PortalProvider
): PortalRailSection | null {
    const match = url.match(
        new RegExp(`^/(?:workspace/)?${provider}/[^/?]+/([^/?]+)`)
    );
    return (match?.[1] as PortalRailSection | undefined) ?? null;
}

export function resolveCurrentPortalSection(
    route: ActivatedRoute,
    routerUrl: string,
    provider: PortalProvider
): PortalRailSection | null {
    const sectionFromSnapshot =
        route.firstChild?.snapshot?.url?.[0]?.path ?? null;

    return (
        (sectionFromSnapshot as PortalRailSection | null) ??
        extractPortalSection(routerUrl, provider)
    );
}
