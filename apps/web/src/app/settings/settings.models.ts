import {
    CoverSize,
    StartupBehavior,
    Theme,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';

export interface SettingsSection {
    id: string;
    label: string;
    icon: string;
    visible: boolean;
}

export interface ObservedSettingsSection {
    id: string;
    element: HTMLElement;
}

export interface ThemeOption {
    value: Theme;
    icon: string;
    labelKey: string;
}

export interface StartupBehaviorOption {
    value: StartupBehavior;
    labelKey: string;
}

export interface CoverSizeOption {
    value: CoverSize;
    icon: string;
    labelKey: string;
}

export interface SettingsPlayerOption {
    id: VideoPlayer;
    labelKey: string;
}

export interface SettingsPlaylistDeleteSummary {
    total: number;
    m3u: number;
    xtream: number;
    stalker: number;
}
