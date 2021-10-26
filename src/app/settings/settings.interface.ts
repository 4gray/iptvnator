import { Language } from './language.enum';
import { Theme } from './theme.enum';

/** Settings key in storage */
export const SETTINGS_STORE_KEY = 'settings';

/**
 * Contains all types of supported video players
 */
export enum VideoPlayer {
    VideoJs = 'videojs',
    Html5Player = 'html5',
}

/**
 * Describes all available settings options of the application
 */
export interface Settings {
    player: VideoPlayer;
    epgUrl: string;
    language: Language;
    showCaptions: boolean;
    theme: Theme;
}
