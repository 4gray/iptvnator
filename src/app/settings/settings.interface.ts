import { Language } from './language.enum';
import { Theme } from './theme.enum';

/**
 * Contains all types of supported video players
 * TODO: extract to separate file
 */
export enum VideoPlayer {
    VideoJs = 'videojs',
    Html5Player = 'html5',
    MPV = 'mpv',
    VLC = 'vlc',
}

/**
 * Describes all available settings options of the application
 */
export interface Settings {
    player: VideoPlayer;
    epgUrl: string[];
    language: Language;
    showCaptions: boolean;
    theme: Theme;
    mpvPlayerPath: string;
    vlcPlayerPath: string;
}
