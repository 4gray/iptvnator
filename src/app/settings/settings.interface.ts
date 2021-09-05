import { Language } from './language.enum';
import { Theme } from './theme.enum';

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
