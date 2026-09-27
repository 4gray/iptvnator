import {
    CoverSize,
    EpgViewMode,
    StartupBehavior,
    Theme,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import {
    meetsSettingsRequirements,
    SETTINGS_SECTION_DEFINITIONS,
} from '@iptvnator/workspace/shell/util/settings-search';
import {
    CoverSizeOption,
    EpgViewModeOption,
    SettingsPlayerOption,
    SettingsSection,
    StartupBehaviorOption,
    StartupWindowModeOption,
    ThemeOption,
    UpdateChannelOption,
} from './settings.models';

export const SETTINGS_THEME_OPTIONS: ThemeOption[] = [
    {
        value: Theme.LightTheme,
        icon: 'light_mode',
        labelKey: 'THEMES.LIGHT_THEME',
    },
    {
        value: Theme.DarkTheme,
        icon: 'dark_mode',
        labelKey: 'THEMES.DARK_THEME',
    },
    {
        value: Theme.SystemTheme,
        icon: 'desktop_windows',
        labelKey: 'THEMES.SYSTEM_THEME',
    },
];

export const SETTINGS_COVER_SIZE_OPTIONS: CoverSizeOption[] = [
    {
        value: 'small' satisfies CoverSize,
        icon: 'view_module',
        labelKey: 'SETTINGS.COVER_SIZE_SMALL',
    },
    {
        value: 'medium' satisfies CoverSize,
        icon: 'view_comfy',
        labelKey: 'SETTINGS.COVER_SIZE_MEDIUM',
    },
    {
        value: 'large' satisfies CoverSize,
        icon: 'view_quilt',
        labelKey: 'SETTINGS.COVER_SIZE_LARGE',
    },
];

export const SETTINGS_EPG_VIEW_MODE_OPTIONS: EpgViewModeOption[] = [
    {
        value: 'timeline' satisfies EpgViewMode,
        icon: 'view_timeline',
        labelKey: 'SETTINGS.EPG_VIEW_MODE_TIMELINE',
    },
    {
        value: 'list' satisfies EpgViewMode,
        icon: 'view_list',
        labelKey: 'SETTINGS.EPG_VIEW_MODE_LIST',
    },
];

export const SETTINGS_STARTUP_BEHAVIOR_OPTIONS: StartupBehaviorOption[] = [
    {
        value: StartupBehavior.FirstView,
        labelKey: 'SETTINGS.STARTUP_BEHAVIOR_FIRST_VIEW',
    },
    {
        value: StartupBehavior.RestoreLastView,
        labelKey: 'SETTINGS.STARTUP_BEHAVIOR_RESTORE_LAST_VIEW',
    },
];

export const SETTINGS_STARTUP_WINDOW_MODE_OPTIONS: StartupWindowModeOption[] = [
    {
        value: 'normal',
        labelKey: 'SETTINGS.STARTUP_WINDOW_MODE_NORMAL',
    },
    {
        value: 'maximized',
        labelKey: 'SETTINGS.STARTUP_WINDOW_MODE_MAXIMIZED',
    },
    {
        value: 'fullscreen',
        labelKey: 'SETTINGS.STARTUP_WINDOW_MODE_FULLSCREEN',
    },
];

export const SETTINGS_UPDATE_CHANNEL_OPTIONS: UpdateChannelOption[] = [
    {
        value: 'stable',
        labelKey: 'SETTINGS.APP_UPDATE_CHANNEL_STABLE',
    },
    {
        value: 'nightly',
        labelKey: 'SETTINGS.APP_UPDATE_CHANNEL_NIGHTLY',
    },
];

export const SETTINGS_OS_PLAYER_OPTIONS: SettingsPlayerOption[] = [
    {
        id: VideoPlayer.MPV,
        labelKey: 'SETTINGS.PLAYER_MPV',
    },
    {
        id: VideoPlayer.VLC,
        labelKey: 'SETTINGS.PLAYER_VLC',
    },
];

export const SETTINGS_EMBEDDED_PLAYER_OPTIONS: SettingsPlayerOption[] = [
    {
        id: VideoPlayer.Html5Player,
        labelKey: 'SETTINGS.PLAYER_HTML5',
    },
    {
        id: VideoPlayer.VideoJs,
        labelKey: 'SETTINGS.PLAYER_VIDEOJS',
    },
    {
        id: VideoPlayer.ArtPlayer,
        labelKey: 'SETTINGS.PLAYER_ARTPLAYER',
    },
];

export interface SettingsPlayerAvailability {
    supportsEmbeddedMpv: boolean;
    supportsManagedExternalPlayers: boolean;
}

/**
 * Built-in web players are always offered; the OS-backed ones only show up
 * when the current runtime can actually launch them.
 */
export function buildSettingsPlayerOptions({
    supportsEmbeddedMpv,
    supportsManagedExternalPlayers,
}: SettingsPlayerAvailability): SettingsPlayerOption[] {
    return [
        ...SETTINGS_EMBEDDED_PLAYER_OPTIONS,
        ...(supportsEmbeddedMpv
            ? [
                  {
                      id: VideoPlayer.EmbeddedMpv,
                      labelKey: 'SETTINGS.PLAYER_EMBEDDED_MPV',
                  },
              ]
            : []),
        ...(supportsManagedExternalPlayers ? SETTINGS_OS_PLAYER_OPTIONS : []),
    ];
}

export interface SettingsSectionVisibility {
    supportsEpg: boolean;
    supportsRemoteControl: boolean;
}

export function buildSettingsSectionNavItems({
    supportsEpg,
    supportsRemoteControl,
}: SettingsSectionVisibility): SettingsSection[] {
    const capabilities = {
        epg: supportsEpg,
        'remote-control': supportsRemoteControl,
    };
    return SETTINGS_SECTION_DEFINITIONS.map((section) => ({
        id: section.id,
        label: section.navLabelKey,
        icon: section.icon,
        visible: meetsSettingsRequirements(section.requires, capabilities),
    }));
}
