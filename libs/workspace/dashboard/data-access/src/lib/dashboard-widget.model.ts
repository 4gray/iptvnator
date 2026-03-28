export type DashboardWidgetType =
    | 'source-stats'
    | 'continue-watching'
    | 'recently-watched'
    | 'recently-added'
    | 'global-favorites';

export type DashboardWidgetSize = 'one-third' | 'half' | 'two-thirds' | 'full';

export interface DashboardWidgetConfig {
    id: string;
    type: DashboardWidgetType;
    title: string;
    description: string;
    size: DashboardWidgetSize;
    enabled: boolean;
    order: number;
}

export interface DashboardLayoutState {
    version: number;
    widgets: DashboardWidgetConfig[];
}

export const DASHBOARD_LAYOUT_VERSION = 14;
export const DASHBOARD_WIDGET_SIZE_OPTIONS: DashboardWidgetSize[] = [
    'one-third',
    'half',
    'two-thirds',
    'full',
];

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
    },
    {
        id: 'recently-added',
        type: 'recently-added',
        title: 'WORKSPACE.DASHBOARD.RECENTLY_ADDED',
        description: 'WORKSPACE.DASHBOARD.RECENTLY_ADDED_DESC',
        size: 'half',
        enabled: false,
        order: 5,
    },
    {
        id: 'global-favorites',
        type: 'global-favorites',
        title: 'WORKSPACE.DASHBOARD.GLOBAL_FAVORITES',
        description: 'WORKSPACE.DASHBOARD.GLOBAL_FAVORITES_DESC',
        size: 'one-third',
        enabled: true,
        order: 6,
    },
];
