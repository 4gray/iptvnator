import { VjsAudioTracks } from './vjs-audio-tracks';
import type { VideoJsPlayer } from './vjs-player.types';
import { VjsTextTracks } from './vjs-text-tracks';

export interface VjsLegacyTracksConfig {
    player: VideoJsPlayer;
    showCaptions: () => boolean;
}

/**
 * Audio and text track ownership for the legacy Video.js chrome.
 *
 * Shared controls route the same helpers through `VjsPlayerControlsBridge`;
 * without them nothing applied the `showCaptions` preference to the player's
 * text tracks, so provider defaults stayed on screen (#1155).
 *
 * Here the preference is a per-source default rather than an authoritative
 * state: Video.js still renders its own captions menu, so enforcing the
 * preference for the whole session would make that menu inert. The preference
 * is applied while the source starts up and released once playback begins.
 * There is no controls UI to notify, hence the no-op refresh.
 */
export class VjsLegacyTracks {
    private readonly audioTracks: VjsAudioTracks;
    private readonly textTracks: VjsTextTracks;
    private readonly handlePlaying = () => {
        this.playbackStarted = true;
    };
    private playbackStarted = false;

    constructor(private readonly config: VjsLegacyTracksConfig) {
        const refresh = () => undefined;
        this.audioTracks = new VjsAudioTracks({
            player: config.player,
            refresh,
        });
        this.textTracks = new VjsTextTracks({
            player: config.player,
            showCaptions: config.showCaptions,
            refresh,
            playbackStarted: () => this.playbackStarted,
        });
        config.player.on('playing', this.handlePlaying);
    }

    bind(): void {
        this.audioTracks.bind();
        this.textTracks.bind();
    }

    refreshInputs(): void {
        this.textTracks.refreshInputs();
    }

    clear(): void {
        // Every source starts unsettled so its own defaults are seeded again.
        this.playbackStarted = false;
        this.audioTracks.clear();
        this.textTracks.clear();
    }

    destroy(): void {
        this.clear();
        this.config.player.off('playing', this.handlePlaying);
    }
}
