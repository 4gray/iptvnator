import { Language } from './language.enum';
import { Theme } from './theme.enum';

export type VideoPlayerType = 'html5' | 'videojs';

/**
 * Describes all available settings options of the application
 */
export interface Settings {
    player: VideoPlayerType;
    epgUrl: string;
    language: Language;
    theme: Theme;
}
