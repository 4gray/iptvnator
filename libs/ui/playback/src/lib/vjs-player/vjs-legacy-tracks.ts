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
 * without them nothing kept the `showCaptions` preference applied to the
 * player's text tracks, so provider defaults stayed on screen (#1155). There
 * is no controls UI to notify here, hence the no-op refresh.
 */
export class VjsLegacyTracks {
    private readonly audioTracks: VjsAudioTracks;
    private readonly textTracks: VjsTextTracks;

    constructor(config: VjsLegacyTracksConfig) {
        const refresh = () => undefined;
        this.audioTracks = new VjsAudioTracks({
            player: config.player,
            refresh,
        });
        this.textTracks = new VjsTextTracks({
            player: config.player,
            showCaptions: config.showCaptions,
            refresh,
        });
    }

    bind(): void {
        this.audioTracks.bind();
        this.textTracks.bind();
    }

    refreshInputs(): void {
        this.textTracks.refreshInputs();
    }

    clear(): void {
        this.audioTracks.clear();
        this.textTracks.clear();
    }
}
