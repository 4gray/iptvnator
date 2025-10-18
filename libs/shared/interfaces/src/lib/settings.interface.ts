import { Language } from './language.enum';
import { StreamFormat } from './stream-format.enum';
import { Theme } from './theme.enum';

/**
 * Contains all types of supported video players
 */
export enum VideoPlayer {
    VideoJs = 'videojs',
    Html5Player = 'html5',
    MPV = 'mpv',
    VLC = 'vlc',
    ArtPlayer = 'artplayer',
}

/**
 * Describes all available settings options of the application
 */
export interface Settings {
    player: VideoPlayer;
    epgUrl: string[];
    streamFormat: StreamFormat;
    language: Language;
    showCaptions: boolean;
    theme: Theme;
    mpvPlayerPath: string;
    mpvReuseInstance: boolean;
    vlcPlayerPath: string;
    remoteControl: boolean;
    remoteControlPort: number;
}
