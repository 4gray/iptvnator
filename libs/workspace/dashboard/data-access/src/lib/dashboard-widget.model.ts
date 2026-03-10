export type DashboardWidgetType =
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

export const DASHBOARD_LAYOUT_VERSION = 12;
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
        id: 'source-stats',
        type: 'source-stats',
        title: 'WORKSPACE.DASHBOARD.SOURCE_STATS',
        description: 'WORKSPACE.DASHBOARD.SOURCE_STATS_DESC',
        size: 'one-third',
        enabled: false,
        order: 1,
    },
    {
        id: 'continue',
        type: 'continue-watching',
        title: 'WORKSPACE.DASHBOARD.CONTINUE_WATCHING',
        description: 'WORKSPACE.DASHBOARD.CONTINUE_WATCHING_DESC',
        size: 'full',
        enabled: true,
        order: 2,
    },
    {
        id: 'recently-watched',
        type: 'recently-watched',
        title: 'WORKSPACE.DASHBOARD.RECENTLY_WATCHED',
        description: 'WORKSPACE.DASHBOARD.RECENTLY_WATCHED_DESC',
        size: 'two-thirds',
        enabled: true,
        order: 4,
        settings: {
            scope: createDefaultWidgetScope(),
        },
    },
    {
        id: 'global-favorites',
        type: 'global-favorites',
        title: 'WORKSPACE.DASHBOARD.GLOBAL_FAVORITES',
        description: 'WORKSPACE.DASHBOARD.GLOBAL_FAVORITES_DESC',
        size: 'one-third',
        enabled: true,
        order: 5,
        settings: {
            scope: createDefaultWidgetScope(),
        },
    },
];
