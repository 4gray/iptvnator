export type PortalProvider = 'xtreams' | 'stalker' | 'playlists';
export type PortalRailSection =
    | 'all'
    | 'downloads'
    | 'favorites'
    | 'groups'
    | 'itv'
    | 'library'
    | 'live'
    | 'recent'
    | 'recently-added'
    | 'radio'
    | 'search'
    | 'series'
    | 'vod';

export interface PortalRailLink {
    icon: string;
    tooltip: string;
    path: (string | number)[];
    exact?: boolean;
    section?: PortalRailSection;
}

interface BuildPortalRailLinksOptions {
    provider: PortalProvider;
    playlistId: string;
    supportsDownloads: boolean;
    workspace: boolean;
    /**
     * Adds the Movies and Series links for an M3U playlist.
     *
     * Off unless the caller has established that this playlist actually
     * holds films or episodes: most M3U playlists are live-only, and a rail
     * that offers two permanently empty sections is worse than no rail
     * change at all. Ignored for the portal providers, which have their own
     * catalog sections unconditionally.
     */
    m3uCatalogSections?: boolean;
}

interface PortalRailLinkGroups {
    primary: PortalRailLink[];
    secondary: PortalRailLink[];
}

export function buildPortalRailLinks(
    options: BuildPortalRailLinksOptions
): PortalRailLinkGroups {
    const {
        provider,
        playlistId,
        supportsDownloads,
        workspace,
        m3uCatalogSections = false,
    } = options;
    const root = workspace
        ? ['/workspace', provider, playlistId]
        : [`/${provider}`, playlistId];

    if (provider === 'xtreams') {
        const primary: PortalRailLink[] = [];
        const secondary: PortalRailLink[] = [];

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
            }
        );

        if (supportsDownloads) {
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
                icon: 'radio',
                tooltip: 'Radio (this playlist)',
                path: [...root, 'radio'],
                section: 'radio',
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
        ];

        if (supportsDownloads) {
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
                icon: 'tv',
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
        ];

        if (m3uCatalogSections) {
            // The same section tokens the portals use, so the rail tooltips,
            // the search mode and the section-memory all recognise them
            // without a new vocabulary.
            primary.push(
                {
                    icon: 'movie',
                    tooltip: 'Movies (this playlist)',
                    path: [...root, 'vod'],
                    exact: true,
                    section: 'vod',
                },
                {
                    icon: 'video_library',
                    tooltip: 'Series (this playlist)',
                    path: [...root, 'series'],
                    exact: true,
                    section: 'series',
                }
            );
        }

        return {
            primary,
            secondary: [],
        };
    }

    return { primary: [], secondary: [] };
}
