import {
    CoverSize,
    StartupBehavior,
    Theme,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import {
    CoverSizeOption,
    SettingsPlayerOption,
    SettingsSection,
    StartupBehaviorOption,
    ThemeOption,
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

export function buildSettingsSectionNavItems(
    isDesktop: boolean
): SettingsSection[] {
    return [
        {
            id: 'general',
            label: 'SETTINGS.NAV_GENERAL',
            icon: 'tune',
            visible: true,
        },
        {
            id: 'playback',
            label: 'SETTINGS.NAV_PLAYBACK',
            icon: 'play_circle',
            visible: true,
        },
        {
            id: 'epg',
            label: 'SETTINGS.NAV_EPG',
            icon: 'calendar_month',
            visible: isDesktop,
        },
        {
            id: '@iptvnator/ui/remote-control',
            label: 'SETTINGS.NAV_REMOTE',
            icon: 'smartphone',
            visible: isDesktop,
        },
        {
            id: 'backup',
            label: 'SETTINGS.NAV_BACKUP',
            icon: 'backup',
            visible: true,
        },
        {
            id: 'reset',
            label: 'SETTINGS.NAV_RESET',
            icon: 'delete_sweep',
            visible: true,
        },
        {
            id: 'about',
            label: 'SETTINGS.NAV_ABOUT',
            icon: 'info',
            visible: true,
        },
    ];
}
