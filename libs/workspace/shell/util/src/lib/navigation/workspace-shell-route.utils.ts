import {
    PortalProvider,
    PortalRailSection,
} from '@iptvnator/portal/shared/util';

export type WorkspaceShellPageKind =
    | 'dashboard'
    | 'downloads'
    | 'global-favorites'
    | 'portal'
    | 'settings'
    | 'sources'
    | 'unknown';

export type WorkspaceShellContextPanel =
    | 'none'
    | 'sources'
    | 'settings'
    | 'category'
    | 'collection';

export interface WorkspacePortalContext {
    provider: PortalProvider;
    playlistId: string;
}

export type WorkspaceShellSearchMode =
    | 'none'
    | 'local-filter'
    | 'remote-search'
    | 'advanced-only';

export interface WorkspaceShellRoute {
    kind: WorkspaceShellPageKind;
    context: WorkspacePortalContext | null;
    section: PortalRailSection | null;
    isPortalFavoritesAllScope: boolean;
    searchMode: WorkspaceShellSearchMode;
    usesQuerySearch: boolean;
    contextPanel: WorkspaceShellContextPanel;
}

const PORTAL_PROVIDERS: readonly PortalProvider[] = [
    'xtreams',
    'stalker',
    'playlists',
];

const PORTAL_SECTIONS: readonly PortalRailSection[] = [
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
];

const XTREAM_ROUTE_QUERY_SEARCH_SECTIONS = new Set<PortalRailSection>([
    'favorites',
    'downloads',
    'recent',
    'recently-added',
]);

const STALKER_ROUTE_QUERY_SEARCH_SECTIONS = new Set<PortalRailSection>([
    'favorites',
    'recent',
]);

const XTREAM_CATEGORY_CONTEXT_SECTIONS = new Set<PortalRailSection>([
    'vod',
    'series',
    'live',
]);

const STALKER_CATEGORY_CONTEXT_SECTIONS = new Set<PortalRailSection>([
    'vod',
    'series',
    'itv',
]);

function normalizePath(url: string): {
    segments: string[];
    queryParams: URLSearchParams;
} {
    const [path, query = ''] = url.split('?');
    return {
        segments: path.split('/').filter(Boolean),
        queryParams: new URLSearchParams(query),
    };
}

function asPortalProvider(value?: string): PortalProvider | null {
    if (!value) {
        return null;
    }

    return PORTAL_PROVIDERS.includes(value as PortalProvider)
        ? (value as PortalProvider)
        : null;
}

function asPortalRailSection(value?: string): PortalRailSection | null {
    if (!value) {
        return null;
    }

    return PORTAL_SECTIONS.includes(value as PortalRailSection)
        ? (value as PortalRailSection)
        : null;
}

export function usesWorkspaceRouteQuerySearch(
    context: WorkspacePortalContext | null,
    section: PortalRailSection | null
): boolean {
    return resolvePortalSearchMode(context, section) !== 'none';
}

function resolvePortalSearchMode(
    context: WorkspacePortalContext | null,
    section: PortalRailSection | null
): Exclude<WorkspaceShellSearchMode, 'advanced-only'> {
    if (!context || !section) {
        return 'none';
    }

    if (context.provider === 'playlists') {
        return section === 'all' ||
            section === 'groups' ||
            section === 'favorites' ||
            section === 'recent'
            ? 'local-filter'
            : 'none';
    }

    if (context.provider === 'xtreams') {
        if (section === 'search') {
            return 'remote-search';
        }

        return section === 'vod' ||
            section === 'series' ||
            section === 'live' ||
            XTREAM_ROUTE_QUERY_SEARCH_SECTIONS.has(section)
            ? 'local-filter'
            : 'none';
    }

    if (context.provider === 'stalker') {
        if (
            section === 'vod' ||
            section === 'series' ||
            section === 'itv' ||
            section === 'search'
        ) {
            return 'remote-search';
        }

        return STALKER_ROUTE_QUERY_SEARCH_SECTIONS.has(section) ||
            section === 'downloads'
            ? 'local-filter'
            : 'none';
    }

    return 'none';
}

function resolveRouteSearchMode(
    kind: WorkspaceShellPageKind,
    context: WorkspacePortalContext | null,
    section: PortalRailSection | null
): WorkspaceShellSearchMode {
    if (kind === 'dashboard') {
        return 'advanced-only';
    }

    if (
        kind === 'sources' ||
        kind === 'downloads' ||
        kind === 'global-favorites'
    ) {
        return 'local-filter';
    }

    if (kind === 'portal') {
        return resolvePortalSearchMode(context, section);
    }

    return 'none';
}

function resolveContextPanel(
    kind: WorkspaceShellPageKind,
    context: WorkspacePortalContext | null,
    section: PortalRailSection | null
): WorkspaceShellContextPanel {
    if (kind === 'sources') {
        return 'sources';
    }

    if (kind === 'settings') {
        return 'settings';
    }

    if (!context || !section) {
        return 'none';
    }

    if (
        (context.provider === 'xtreams' &&
            XTREAM_CATEGORY_CONTEXT_SECTIONS.has(section)) ||
        (context.provider === 'stalker' &&
            STALKER_CATEGORY_CONTEXT_SECTIONS.has(section))
    ) {
        return 'category';
    }

    if (
        (context.provider === 'xtreams' || context.provider === 'stalker') &&
        section === 'downloads'
    ) {
        return 'collection';
    }

    return 'none';
}

export function parseWorkspaceShellRoute(url: string): WorkspaceShellRoute {
    const { segments, queryParams } = normalizePath(url);

    if (segments[0] !== 'workspace') {
        return {
            kind: 'unknown',
            context: null,
            section: null,
            isPortalFavoritesAllScope: false,
            searchMode: 'none',
            usesQuerySearch: false,
            contextPanel: 'none',
        };
    }

    const sectionSegment = segments[3];
    const provider = asPortalProvider(segments[1]);

    if (provider && segments[2]) {
        const context: WorkspacePortalContext = {
            provider,
            playlistId: segments[2],
        };
        const section = asPortalRailSection(sectionSegment);

        return {
            kind: 'portal',
            context,
            section,
            isPortalFavoritesAllScope:
                section === 'favorites' &&
                (provider === 'xtreams' || provider === 'stalker') &&
                queryParams.get('scope') === 'all',
            searchMode: resolveRouteSearchMode('portal', context, section),
            usesQuerySearch: usesWorkspaceRouteQuerySearch(context, section),
            contextPanel: resolveContextPanel('portal', context, section),
        };
    }

    const page = segments[1];
    const kind: WorkspaceShellPageKind =
        !page || page === 'dashboard'
            ? 'dashboard'
            : page === 'sources'
              ? 'sources'
              : page === 'settings'
                ? 'settings'
                : page === 'global-favorites'
                  ? 'global-favorites'
                  : page === 'downloads'
                    ? 'downloads'
                    : 'unknown';
    const searchMode = resolveRouteSearchMode(kind, null, null);

    return {
        kind,
        context: null,
        section: null,
        isPortalFavoritesAllScope: false,
        searchMode,
        usesQuerySearch:
            searchMode === 'local-filter' || searchMode === 'remote-search',
        contextPanel: resolveContextPanel(kind, null, null),
    };
}
