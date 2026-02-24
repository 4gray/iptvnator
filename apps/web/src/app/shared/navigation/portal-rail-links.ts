import { GLOBAL_FAVORITES_PLAYLIST_ID } from 'shared-interfaces';

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
                tooltip: 'Xtream library',
                path: root,
                exact: true,
                section: 'library',
            });
            return { primary, secondary };
        }

        primary.push(
            {
                icon: 'movie',
                tooltip: 'Movies',
                path: [...root, 'vod'],
                section: 'vod',
            },
            {
                icon: 'live_tv',
                tooltip: 'Live TV',
                path: [...root, 'live'],
                section: 'live',
            },
            {
                icon: 'tv',
                tooltip: 'Series',
                path: [...root, 'series'],
                section: 'series',
            }
        );

        secondary.push(
            {
                icon: 'new_releases',
                tooltip: 'Recently added',
                path: [...root, 'recently-added'],
                section: 'recently-added',
            },
            {
                icon: 'search',
                tooltip: 'Search',
                path: [...root, 'search'],
                section: 'search',
            },
            {
                icon: 'history',
                tooltip: 'Recently viewed',
                path: [...root, 'recent'],
                section: 'recent',
            },
            {
                icon: 'favorite',
                tooltip: 'Favorites',
                path: [...root, 'favorites'],
                section: 'favorites',
            }
        );

        if (isElectron) {
            secondary.push({
                icon: 'download',
                tooltip: 'Downloads',
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
                tooltip: 'Movies',
                path: [...root, 'vod'],
                section: 'vod',
            },
            {
                icon: 'live_tv',
                tooltip: 'Live TV',
                path: [...root, 'itv'],
                section: 'itv',
            },
            {
                icon: 'tv',
                tooltip: 'Series',
                path: [...root, 'series'],
                section: 'series',
            },
        ];

        const secondary: PortalRailLink[] = [
            {
                icon: 'search',
                tooltip: 'Search',
                path: [...root, 'search'],
                section: 'search',
            },
            {
                icon: 'history',
                tooltip: 'Recently viewed',
                path: [...root, 'recent'],
                section: 'recent',
            },
            {
                icon: 'favorite',
                tooltip: 'Favorites',
                path: [...root, 'favorites'],
                section: 'favorites',
            },
        ];

        if (isElectron) {
            secondary.push({
                icon: 'download',
                tooltip: 'Downloads',
                path: [...root, 'downloads'],
                section: 'downloads',
            });
        }

        return { primary, secondary };
    }

    return {
        primary: [
            {
                icon: 'play_circle',
                tooltip: 'Player',
                path: root,
                exact: true,
                section: 'player',
            },
        ],
        secondary: workspace
            ? [
                  {
                      icon: 'favorite',
                      tooltip: 'Global favorites',
                      path: [
                          '/workspace',
                          'playlists',
                          GLOBAL_FAVORITES_PLAYLIST_ID,
                      ],
                      section: 'favorites',
                  },
              ]
            : [],
    };
}
