export type VideoPlayerType = 'html5' | 'videojs';

/**
 * Describes all available settings options of the application
 */
export interface Settings {
    player: VideoPlayerType;
}
