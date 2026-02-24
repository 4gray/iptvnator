export type DashboardWidgetType =
    | 'recent-sources'
    | 'source-stats'
    | 'continue-watching'
    | 'recently-watched'
    | 'global-favorites';

export type DashboardWidgetSize = 'one-third' | 'half' | 'two-thirds' | 'full';
export type DashboardWidgetProvider = 'm3u' | 'xtream' | 'stalker';

export interface DashboardWidgetScopeSettings {
    providers: DashboardWidgetProvider[];
    playlistIds: string[];
}

export interface DashboardWidgetSettings {
    scope?: DashboardWidgetScopeSettings;
}

export interface DashboardWidgetConfig {
    id: string;
    type: DashboardWidgetType;
    title: string;
    description: string;
    size: DashboardWidgetSize;
    enabled: boolean;
    order: number;
    settings?: DashboardWidgetSettings;
}

export interface DashboardLayoutState {
    version: number;
    widgets: DashboardWidgetConfig[];
}

export const DASHBOARD_LAYOUT_VERSION = 5;
export const DASHBOARD_WIDGET_SIZE_OPTIONS: DashboardWidgetSize[] = [
    'one-third',
    'half',
    'two-thirds',
    'full',
];
export const ALL_DASHBOARD_WIDGET_PROVIDERS: DashboardWidgetProvider[] = [
    'm3u',
    'xtream',
    'stalker',
];
export const DEFAULT_WIDGET_SCOPE: DashboardWidgetScopeSettings = {
    providers: [...ALL_DASHBOARD_WIDGET_PROVIDERS],
    playlistIds: [],
};

export function createDefaultWidgetScope(): DashboardWidgetScopeSettings {
    return {
        providers: [...ALL_DASHBOARD_WIDGET_PROVIDERS],
        playlistIds: [],
    };
}

export const DEFAULT_DASHBOARD_WIDGETS: DashboardWidgetConfig[] = [
    {
        id: 'recent-sources',
        type: 'recent-sources',
        title: 'Recent Sources',
        description: 'Latest added or refreshed playlists across providers.',
        size: 'half',
        enabled: true,
        order: 0,
    },
    {
        id: 'source-stats',
        type: 'source-stats',
        title: 'Source Statistics',
        description: 'Current source mix and total connected libraries.',
        size: 'one-third',
        enabled: true,
        order: 1,
    },
    {
        id: 'continue',
        type: 'continue-watching',
        title: 'Continue Watching',
        description: 'Jump back into the last active source.',
        size: 'half',
        enabled: true,
        order: 2,
    },
    {
        id: 'recently-watched',
        type: 'recently-watched',
        title: 'Recently Watched',
        description: 'Global watch history across channels, VOD and series.',
        size: 'one-third',
        enabled: true,
        order: 3,
        settings: {
            scope: createDefaultWidgetScope(),
        },
    },
    {
        id: 'global-favorites',
        type: 'global-favorites',
        title: 'Global Favorites',
        description: 'Pinned items across all connected providers.',
        size: 'two-thirds',
        enabled: true,
        order: 4,
        settings: {
            scope: createDefaultWidgetScope(),
        },
    },
];
