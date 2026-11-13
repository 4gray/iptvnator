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

/** Whether an M3U playlist holds films, episodes, or both. */
export interface M3uCatalogSections {
    readonly movies: boolean;
    readonly series: boolean;
}

interface BuildPortalRailLinksOptions {
    provider: PortalProvider;
    playlistId: string;
    supportsDownloads: boolean;
    workspace: boolean;
    /**
     * Which catalog links an M3U playlist's rail should offer.
     *
     * Per kind rather than one flag, because a playlist holding films but
     * no series is ordinary: offering both would put a permanently empty
     * section in the rail, and an empty section is worse than no rail
     * change at all. Absent means neither. Ignored for the portal
     * providers, which have their own catalog sections unconditionally.
     */
    m3uCatalogSections?: M3uCatalogSections;
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
        m3uCatalogSections,
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

        // The same section tokens the portals use, so the rail tooltips,
        // the search mode and the section-memory all recognise them without
        // a new vocabulary.
        if (m3uCatalogSections?.movies) {
            primary.push({
                icon: 'movie',
                tooltip: 'Movies (this playlist)',
                path: [...root, 'vod'],
                exact: true,
                section: 'vod',
            });
        }

        if (m3uCatalogSections?.series) {
            primary.push({
                icon: 'video_library',
                tooltip: 'Series (this playlist)',
                path: [...root, 'series'],
                exact: true,
                section: 'series',
            });
        }

        return {
            primary,
            secondary: [],
        };
    }

    return { primary: [], secondary: [] };
}
