import { Language } from './language.enum';
import { Theme } from './theme.enum';

/**
 * Contains all types of supported video players
 */
export enum VideoPlayer {
    VideoJs = 'videojs',
    Html5Player = 'html5',
    MPV = 'mpv',
    VLC = 'vlc',
    DPlayer = 'dplayer',
    ArtPlayer = 'artplayer',
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
    remoteControl: boolean;
    remoteControlPort: number;
}
