export type PortalProvider = 'xtreams' | 'stalker' | 'playlists';

export interface PortalRailLink {
    icon: string;
    tooltip: string;
    path: (string | number)[];
    exact?: boolean;
    section?: string;
}

interface BuildPortalRailLinksOptions {
    provider: PortalProvider;
    playlistId: string;
    isElectron: boolean;
    workspace: boolean;
}

interface PortalRailLinkGroups {
    primary: PortalRailLink[];
    secondary: PortalRailLink[];
}

export function buildPortalRailLinks(
    options: BuildPortalRailLinksOptions
): PortalRailLinkGroups {
    const { provider, playlistId, isElectron, workspace } = options;
    const root = workspace
        ? ['/workspace', provider, playlistId]
        : [`/${provider}`, playlistId];

    if (provider === 'xtreams') {
        const primary: PortalRailLink[] = [];
        const secondary: PortalRailLink[] = [];

        if (workspace && !isElectron) {
            primary.push({
                icon: 'movie',
                tooltip: 'Xtream library (this playlist)',
                path: root,
                exact: true,
                section: 'library',
            });
            return { primary, secondary };
        }

        primary.push(
            {
                icon: 'movie',
                tooltip: 'Movies (this playlist)',
                path: [...root, 'vod'],
                section: 'vod',
            },
            {
                icon: 'live_tv',
                tooltip: 'Live TV (this playlist)',
                path: [...root, 'live'],
                section: 'live',
            },
            {
                icon: 'tv',
                tooltip: 'Series (this playlist)',
                path: [...root, 'series'],
                section: 'series',
            }
        );

        secondary.push(
            {
                icon: 'new_releases',
                tooltip: 'Recently added (this playlist)',
                path: [...root, 'recently-added'],
                section: 'recently-added',
            },
            {
                icon: 'search',
                tooltip: 'Search (this playlist)',
                path: [...root, 'search'],
                section: 'search',
            },
            {
                icon: 'history',
                tooltip: 'Recently viewed (this playlist)',
                path: [...root, 'recent'],
                section: 'recent',
            },
            {
                icon: 'favorite',
                tooltip: 'Favorites (this playlist)',
                path: [...root, 'favorites'],
                section: 'favorites',
            }
        );

        if (isElectron) {
            secondary.push({
                icon: 'download',
                tooltip: 'Downloads (this playlist)',
                path: [...root, 'downloads'],
                section: 'downloads',
            });
        }

        return { primary, secondary };
    }

    if (provider === 'stalker') {
        const primary: PortalRailLink[] = [
            {
                icon: 'movie',
                tooltip: 'Movies (this playlist)',
                path: [...root, 'vod'],
                section: 'vod',
            },
            {
                icon: 'live_tv',
                tooltip: 'Live TV (this playlist)',
                path: [...root, 'itv'],
                section: 'itv',
            },
            {
                icon: 'tv',
                tooltip: 'Series (this playlist)',
                path: [...root, 'series'],
                section: 'series',
            },
        ];

        const secondary: PortalRailLink[] = [
            {
                icon: 'search',
                tooltip: 'Search (this playlist)',
                path: [...root, 'search'],
                section: 'search',
            },
            {
                icon: 'history',
                tooltip: 'Recently viewed (this playlist)',
                path: [...root, 'recent'],
                section: 'recent',
            },
            {
                icon: 'favorite',
                tooltip: 'Favorites (this playlist)',
                path: [...root, 'favorites'],
                section: 'favorites',
            },
        ];

        if (isElectron) {
            secondary.push({
                icon: 'download',
                tooltip: 'Downloads (this playlist)',
                path: [...root, 'downloads'],
                section: 'downloads',
            });
        }

        return { primary, secondary };
    }

    if (provider === 'playlists') {
        const primary: PortalRailLink[] = [
            {
                icon: 'list',
                tooltip: 'All channels (this playlist)',
                path: [...root, 'all'],
                exact: true,
                section: 'all',
            },
            {
                icon: 'folder',
                tooltip: 'Groups (this playlist)',
                path: [...root, 'groups'],
                exact: true,
                section: 'groups',
            },
            {
                icon: 'star',
                tooltip: 'Favorites (this playlist)',
                path: [...root, 'favorites'],
                exact: true,
                section: 'favorites',
            },
        ];

        return {
            primary,
            secondary: [],
        };
    }

    return { primary: [], secondary: [] };
}
