import { Router } from '@angular/router';
import {
    PortalRailSection,
    WorkspaceCommandContribution,
    WorkspaceResolvedCommandItem,
} from '@iptvnator/portal/shared/util';
import {
    WorkspacePortalContext,
    WorkspaceShellRoute,
} from '@iptvnator/workspace/shell/util';
import { TranslateFn } from './workspace-shell-search-labels';

export interface CommandBuilderActions {
    openPlaylistSearch: (query: string) => void;
    refreshCurrentPlaylist: () => void;
    openPlaylistInfo: () => void;
    openAccountInfo: () => void;
    openGlobalSearch: (query: string) => void;
    navigateToGlobalFavorites: () => void;
    openGlobalRecent: () => void;
    openDownloadsShortcut: () => void;
    openAddPlaylistDialog: (kind?: 'url' | 'xtream' | 'stalker') => void;
}

export interface CommandBuilderContext {
    route: WorkspaceShellRoute;
    context: WorkspacePortalContext | null;
    section: PortalRailSection | null;
    hasActivePlaylist: boolean;
    hasXtreamPlaylists: boolean;
    canRefreshPlaylist: boolean;
    supportsDownloads: boolean;
    showDashboard: boolean;
    translate: TranslateFn;
    router: Router;
    actions: CommandBuilderActions;
}

export function buildCommandPaletteItems(
    ctx: CommandBuilderContext,
    viewCommands: readonly WorkspaceCommandContribution[]
): WorkspaceResolvedCommandItem[] {
    return [
        ...getViewCommandDefinitions(ctx),
        ...getPlaylistCommandDefinitions(ctx),
        ...getGlobalCommandDefinitions(ctx),
        ...viewCommands,
    ]
        .map((command) => resolveCommand(command, ctx.translate))
        .filter((command) => command.visible)
        .sort(comparePaletteCommands);
}

export function getViewCommandDefinitions(
    ctx: CommandBuilderContext
): WorkspaceCommandContribution[] {
    const { context, section } = ctx;

    if (!context || !section) {
        return [];
    }

    if (context.provider === 'playlists') {
        return getM3uNavigationCommands(ctx, context, section);
    }

    if (context.provider === 'xtreams' || context.provider === 'stalker') {
        return getPortalNavigationCommands(ctx, context, section);
    }

    return [];
}

export function getPlaylistCommandDefinitions(
    ctx: CommandBuilderContext
): WorkspaceCommandContribution[] {
    const { context } = ctx.route;

    if (
        !context ||
        (context.provider !== 'xtreams' &&
            context.provider !== 'stalker' &&
            context.provider !== 'playlists')
    ) {
        return [];
    }

    const canOpenPlaylistSearch =
        context.provider === 'xtreams' || context.provider === 'stalker';

    return [
        {
            id: 'playlist-search',
            group: 'playlist',
            icon: 'playlist_play',
            labelKey: 'WORKSPACE.SHELL.COMMANDS.PLAYLIST_SEARCH_LABEL',
            descriptionKey:
                'WORKSPACE.SHELL.COMMANDS.PLAYLIST_SEARCH_DESCRIPTION',
            priority: 10,
            visible: canOpenPlaylistSearch,
            run: ({ query }) => ctx.actions.openPlaylistSearch(query),
        },
        {
            id: 'refresh-playlist',
            group: 'playlist',
            icon: 'sync',
            labelKey: 'WORKSPACE.SHELL.COMMANDS.REFRESH_PLAYLIST_LABEL',
            descriptionKey:
                'WORKSPACE.SHELL.COMMANDS.REFRESH_PLAYLIST_DESCRIPTION',
            priority: 20,
            visible: ctx.canRefreshPlaylist,
            run: () => ctx.actions.refreshCurrentPlaylist(),
        },
        {
            id: 'playlist-info',
            group: 'playlist',
            icon: 'info',
            labelKey: 'WORKSPACE.SHELL.COMMANDS.PLAYLIST_INFO_LABEL',
            descriptionKey:
                'WORKSPACE.SHELL.COMMANDS.PLAYLIST_INFO_DESCRIPTION',
            priority: 30,
            visible: ctx.hasActivePlaylist,
            run: () => ctx.actions.openPlaylistInfo(),
        },
        {
            id: 'account-info',
            group: 'playlist',
            icon: 'account_circle',
            labelKey: 'WORKSPACE.SHELL.COMMANDS.ACCOUNT_INFO_LABEL',
            descriptionKey:
                'WORKSPACE.SHELL.COMMANDS.ACCOUNT_INFO_DESCRIPTION',
            priority: 40,
            visible: context.provider === 'xtreams',
            run: () => ctx.actions.openAccountInfo(),
        },
    ];
}

export function getGlobalCommandDefinitions(
    ctx: CommandBuilderContext
): WorkspaceCommandContribution[] {
    const {
        route,
        hasXtreamPlaylists,
        supportsDownloads,
        showDashboard,
        actions,
    } = ctx;

    return [
        {
            id: 'global-search',
            group: 'global',
            icon: 'search',
            labelKey: 'WORKSPACE.SHELL.COMMANDS.GLOBAL_SEARCH_LABEL',
            descriptionKey:
                'WORKSPACE.SHELL.COMMANDS.GLOBAL_SEARCH_DESCRIPTION',
            priority: 10,
            visible: hasXtreamPlaylists,
            keywords: ['xtream'],
            run: ({ query }) => actions.openGlobalSearch(query),
        },
        {
            id: 'open-global-favorites',
            group: 'global',
            icon: 'star',
            labelKey: 'WORKSPACE.SHELL.COMMANDS.OPEN_GLOBAL_FAVORITES_LABEL',
            descriptionKey:
                'WORKSPACE.SHELL.COMMANDS.OPEN_GLOBAL_FAVORITES_DESCRIPTION',
            priority: 20,
            visible: route.kind !== 'global-favorites',
            run: () => actions.navigateToGlobalFavorites(),
        },
        {
            id: 'open-global-recent',
            group: 'global',
            icon: 'history',
            labelKey: 'WORKSPACE.SHELL.COMMANDS.OPEN_GLOBAL_RECENT_LABEL',
            descriptionKey:
                'WORKSPACE.SHELL.COMMANDS.OPEN_GLOBAL_RECENT_DESCRIPTION',
            priority: 30,
            visible: route.kind !== 'global-recent',
            run: () => actions.openGlobalRecent(),
        },
        {
            id: 'open-downloads',
            group: 'global',
            icon: 'download',
            labelKey: 'WORKSPACE.SHELL.COMMANDS.OPEN_DOWNLOADS_LABEL',
            descriptionKey:
                'WORKSPACE.SHELL.COMMANDS.OPEN_DOWNLOADS_DESCRIPTION',
            priority: 40,
            visible: supportsDownloads && route.kind !== 'downloads',
            run: () => actions.openDownloadsShortcut(),
        },
        {
            id: 'open-settings',
            group: 'global',
            icon: 'settings',
            labelKey: 'WORKSPACE.SHELL.COMMANDS.OPEN_SETTINGS_LABEL',
            descriptionKey:
                'WORKSPACE.SHELL.COMMANDS.OPEN_SETTINGS_DESCRIPTION',
            priority: 50,
            visible: route.kind !== 'settings',
            run: () => {
                void ctx.router.navigate(['/workspace', 'settings']);
            },
        },
        {
            id: 'open-sources',
            group: 'global',
            icon: 'library_books',
            labelKey: 'WORKSPACE.SHELL.COMMANDS.OPEN_SOURCES_LABEL',
            descriptionKey:
                'WORKSPACE.SHELL.COMMANDS.OPEN_SOURCES_DESCRIPTION',
            priority: 60,
            visible: route.kind !== 'sources',
            run: () => {
                void ctx.router.navigate(['/workspace', 'sources']);
            },
        },
        {
            id: 'open-dashboard',
            group: 'global',
            icon: 'dashboard',
            labelKey: 'WORKSPACE.SHELL.COMMANDS.OPEN_DASHBOARD_LABEL',
            descriptionKey:
                'WORKSPACE.SHELL.COMMANDS.OPEN_DASHBOARD_DESCRIPTION',
            priority: 70,
            visible: showDashboard && route.kind !== 'dashboard',
            run: () => {
                void ctx.router.navigate(['/workspace', 'dashboard']);
            },
        },
        {
            id: 'add-playlist',
            group: 'global',
            icon: 'add_circle_outline',
            labelKey: 'WORKSPACE.SHELL.COMMANDS.ADD_PLAYLIST_LABEL',
            descriptionKey:
                'WORKSPACE.SHELL.COMMANDS.ADD_PLAYLIST_DESCRIPTION',
            priority: 80,
            run: () => actions.openAddPlaylistDialog(),
        },
        {
            id: 'add-playlist-m3u',
            group: 'global',
            icon: 'folder_open',
            labelKey: 'WORKSPACE.SHELL.COMMANDS.ADD_PLAYLIST_M3U_LABEL',
            descriptionKey:
                'WORKSPACE.SHELL.COMMANDS.ADD_PLAYLIST_M3U_DESCRIPTION',
            keywords: ['m3u', 'm3u8', 'file', 'url', 'add', 'import'],
            priority: 79,
            run: () => actions.openAddPlaylistDialog('url'),
        },
        {
            id: 'add-playlist-xtream',
            group: 'global',
            icon: 'cloud',
            labelKey: 'WORKSPACE.SHELL.COMMANDS.ADD_PLAYLIST_XTREAM_LABEL',
            descriptionKey:
                'WORKSPACE.SHELL.COMMANDS.ADD_PLAYLIST_XTREAM_DESCRIPTION',
            keywords: ['xtream', 'codes', 'iptv', 'add', 'import'],
            priority: 78,
            run: () => actions.openAddPlaylistDialog('xtream'),
        },
        {
            id: 'add-playlist-stalker',
            group: 'global',
            icon: 'cast',
            labelKey: 'WORKSPACE.SHELL.COMMANDS.ADD_PLAYLIST_STALKER_LABEL',
            descriptionKey:
                'WORKSPACE.SHELL.COMMANDS.ADD_PLAYLIST_STALKER_DESCRIPTION',
            keywords: ['stalker', 'portal', 'mac', 'ministra', 'add'],
            priority: 77,
            run: () => actions.openAddPlaylistDialog('stalker'),
        },
    ];
}

function getPortalNavigationCommands(
    ctx: CommandBuilderContext,
    context: WorkspacePortalContext,
    section: PortalRailSection
): WorkspaceCommandContribution[] {
    const liveSection = context.provider === 'stalker' ? 'itv' : 'live';
    const radioCommand =
        context.provider === 'stalker'
            ? createNavigationCommand(ctx, {
                  id: 'go-to-radio',
                  context,
                  targetSection: 'radio',
                  currentSection: section,
                  icon: 'radio',
                  labelKey: 'WORKSPACE.SHELL.RAIL_RADIO',
                  priority: 115,
              })
            : null;

    return [
        createNavigationCommand(ctx, {
            id: 'go-to-vod',
            context,
            targetSection: 'vod',
            currentSection: section,
            icon: 'movie',
            labelKey: 'WORKSPACE.SHELL.RAIL_MOVIES',
            priority: 100,
        }),
        createNavigationCommand(ctx, {
            id: 'go-to-live',
            context,
            targetSection: liveSection,
            currentSection: section,
            icon: 'live_tv',
            labelKey: 'WORKSPACE.SHELL.RAIL_LIVE',
            priority: 110,
        }),
        radioCommand,
        createNavigationCommand(ctx, {
            id: 'go-to-series',
            context,
            targetSection: 'series',
            currentSection: section,
            icon: 'video_library',
            labelKey: 'WORKSPACE.SHELL.RAIL_SERIES',
            priority: 120,
        }),
    ].filter(
        (command): command is WorkspaceCommandContribution => command !== null
    );
}

function getM3uNavigationCommands(
    ctx: CommandBuilderContext,
    context: WorkspacePortalContext,
    section: PortalRailSection
): WorkspaceCommandContribution[] {
    return [
        createNavigationCommand(ctx, {
            id: 'go-to-all',
            context,
            targetSection: 'all',
            currentSection: section,
            icon: 'format_list_bulleted',
            labelKey: 'WORKSPACE.SHELL.RAIL_ALL_CHANNELS',
            priority: 100,
        }),
        createNavigationCommand(ctx, {
            id: 'go-to-groups',
            context,
            targetSection: 'groups',
            currentSection: section,
            icon: 'folder_open',
            labelKey: 'WORKSPACE.SHELL.RAIL_GROUPS',
            priority: 110,
        }),
        createNavigationCommand(ctx, {
            id: 'go-to-favorites',
            context,
            targetSection: 'favorites',
            currentSection: section,
            icon: 'star',
            labelKey: 'WORKSPACE.SHELL.RAIL_FAVORITES',
            priority: 120,
        }),
        createNavigationCommand(ctx, {
            id: 'go-to-recent',
            context,
            targetSection: 'recent',
            currentSection: section,
            icon: 'history',
            labelKey: 'WORKSPACE.SHELL.RAIL_RECENT',
            priority: 130,
        }),
    ].filter(
        (command): command is WorkspaceCommandContribution => command !== null
    );
}

function createNavigationCommand(
    ctx: CommandBuilderContext,
    config: {
        id: string;
        context: WorkspacePortalContext;
        targetSection: string;
        currentSection: PortalRailSection;
        icon: string;
        labelKey: string;
        priority: number;
    }
): WorkspaceCommandContribution | null {
    if (config.currentSection === config.targetSection) {
        return null;
    }

    return {
        id: config.id,
        group: 'view',
        icon: config.icon,
        labelKey: config.labelKey,
        descriptionKey: 'WORKSPACE.SHELL.COMMANDS.OPEN_VIEW_DESCRIPTION',
        descriptionParams: () => ({
            view: ctx.translate(config.labelKey),
        }),
        priority: config.priority,
        run: () => {
            void ctx.router.navigate([
                '/workspace',
                config.context.provider,
                config.context.playlistId,
                config.targetSection,
            ]);
        },
    };
}

export function resolveCommand(
    command: WorkspaceCommandContribution,
    translate: TranslateFn
): WorkspaceResolvedCommandItem {
    const labelParams = resolveCommandValue(command.labelParams);
    const descriptionParams = resolveCommandValue(command.descriptionParams);

    return {
        id: command.id,
        group: command.group,
        icon: command.icon,
        label: translate(command.labelKey, labelParams),
        description: command.descriptionKey
            ? translate(command.descriptionKey, descriptionParams)
            : '',
        keywords: resolveCommandValue(command.keywords) ?? [],
        priority: command.priority ?? 100,
        visible: resolveCommandValue(command.visible) ?? true,
        enabled: resolveCommandValue(command.enabled) ?? true,
        run: command.run,
    };
}

export function comparePaletteCommands(
    left: WorkspaceResolvedCommandItem,
    right: WorkspaceResolvedCommandItem
): number {
    const groupOrder =
        getCommandGroupOrder(left.group) - getCommandGroupOrder(right.group);

    if (groupOrder !== 0) {
        return groupOrder;
    }

    if (left.priority !== right.priority) {
        return left.priority - right.priority;
    }

    return left.label.localeCompare(right.label);
}

export function getCommandGroupOrder(
    group: WorkspaceResolvedCommandItem['group']
): number {
    switch (group) {
        case 'view':
            return 0;
        case 'playlist':
            return 1;
        default:
            return 2;
    }
}

export function resolveCommandValue<T>(
    value: T | (() => T | undefined) | undefined
): T | undefined {
    if (typeof value === 'function') {
        return (value as () => T | undefined)();
    }

    return value;
}
