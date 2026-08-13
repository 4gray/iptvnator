import { Router } from '@angular/router';
import { WorkspacePortalContext } from '@iptvnator/workspace/shell/util';

export function toQueryString(queryParams: Record<string, unknown>): string {
    const urlSearchParams = new URLSearchParams();

    Object.entries(queryParams).forEach(([key, value]) => {
        if (value == null) {
            return;
        }

        if (Array.isArray(value)) {
            value.forEach((item) => urlSearchParams.append(key, String(item)));
            return;
        }

        urlSearchParams.set(key, String(value));
    });

    return urlSearchParams.toString();
}

export function getRouteQueryParam(
    router: Router,
    currentUrl: string,
    name: string
): string {
    const value = router.parseUrl(currentUrl).queryParams[name];
    return typeof value === 'string' ? value : '';
}

/**
 * The page part of a router URL, without query params or fragment — i.e. the
 * identity of "which page am I on", as opposed to how it is parameterised.
 */
export function getRoutePath(url: string): string {
    return url.split('?')[0].split('#')[0];
}

export function syncSearchQueryParam(
    router: Router,
    currentUrl: string,
    term: string
): boolean {
    const nextTerm = term.trim();
    const currentTerm = getRouteQueryParam(router, currentUrl, 'q');
    if (nextTerm === currentTerm) {
        return false;
    }

    const routePath = getRoutePath(currentUrl);
    const queryParams = {
        ...router.parseUrl(currentUrl).queryParams,
    };

    if (nextTerm.length > 0) {
        queryParams['q'] = nextTerm;
    } else {
        delete queryParams['q'];
    }

    const queryString = toQueryString(queryParams);
    const nextUrl = queryString ? `${routePath}?${queryString}` : routePath;
    void router.navigateByUrl(nextUrl, { replaceUrl: true });
    return true;
}

export function bumpRefreshQueryParam(router: Router, currentUrl: string): void {
    const routePath = getRoutePath(currentUrl);
    const queryParams = {
        ...router.parseUrl(currentUrl).queryParams,
        refresh: Date.now().toString(),
    };

    const queryString = toQueryString(queryParams);
    const nextUrl = queryString ? `${routePath}?${queryString}` : routePath;
    void router.navigateByUrl(nextUrl, { replaceUrl: true });
}

export function getProviderFromPlaylist(playlist: {
    serverUrl?: string;
    macAddress?: string;
}): WorkspacePortalContext['provider'] {
    if (playlist.serverUrl) {
        return 'xtreams';
    }
    if (playlist.macAddress) {
        return 'stalker';
    }
    return 'playlists';
}
