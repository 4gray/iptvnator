import type Hls from 'hls.js';
import { positiveOrNull } from '../player-controls/positive-number.util';
import type { WebVideoEngineStats } from '../player-controls/web-video-stream-stats';
import type { ShakaPlayerLike } from '../shaka-engine/shaka-module.types';
import type { WebVideoControlsSource } from './web-video-source-tracks';

/**
 * Reads the active rendition's bitrate, codecs and container from whichever
 * engine is driving the current source.
 *
 * Deliberately separate from {@link WebVideoSourceTracks}: nothing here selects
 * anything, it only describes what is playing, and the info popover is the one
 * caller. Everything the `<video>` element already knows (resolution, frame
 * rate, buffer, dropped frames) is read by the sampler instead.
 */
export class WebVideoSourceStats {
    private source: WebVideoControlsSource | null = null;

    setSource(source: WebVideoControlsSource | null): void {
        this.source = source;
    }

    read(): WebVideoEngineStats | null {
        if (!this.source) {
            return null;
        }
        switch (this.source.kind) {
            case 'hls':
                return readHlsStats(this.source.hls);
            case 'shaka':
                return readShakaStats(this.source.session.getPlayer());
            case 'mpegts':
                return { container: 'MPEG-TS' };
            case 'native':
                return null;
        }
    }
}

function readHlsStats(hls: Hls): WebVideoEngineStats | null {
    // `currentLevel` is -1 while ABR has not settled; `loadLevel` is the one
    // being fetched and is the best available answer in that window.
    const index = hls.currentLevel >= 0 ? hls.currentLevel : hls.loadLevel;
    const level = index >= 0 ? hls.levels?.[index] : undefined;
    if (!level) {
        return { container: 'HLS' };
    }

    // The audio rendition carries the details the video level cannot: its own
    // declared bitrate, the codec actually selected, and the channel count.
    const audioTrack = hls.audioTracks?.[hls.audioTrack];

    return {
        // BANDWIDTH describes the entire variant. Fragment realBitrate can
        // include muxed audio or omit alternate audio, so it is not a reliable
        // separate video bitrate or an aggregate rendition bitrate.
        streamBitrateBps: positiveOrNull(level.bitrate),
        videoBitrateBps: null,
        audioBitrateBps: positiveOrNull(audioTrack?.bitrate),
        videoCodec: level.videoCodec ?? null,
        audioCodec: audioTrack?.audioCodec ?? level.audioCodec ?? null,
        audioChannels: audioTrack?.channels ?? null,
        container: 'HLS',
        nominalFps: positiveOrNull(level.frameRate),
        width: positiveOrNull(level.width),
        height: positiveOrNull(level.height),
    };
}

function readShakaStats(
    player: ShakaPlayerLike | null
): WebVideoEngineStats | null {
    if (!player) {
        return null;
    }

    const variant = player.getVariantTracks().find((track) => track.active);
    if (!variant) {
        return null;
    }

    return {
        // getStats().streamBandwidth also includes playback rate; use the
        // manifest's rendition rate and keep unknown component rates unknown.
        streamBitrateBps: positiveOrNull(variant.bandwidth),
        videoBitrateBps: positiveOrNull(variant.videoBandwidth),
        audioBitrateBps: positiveOrNull(variant.audioBandwidth),
        videoCodec: variant.videoCodec ?? null,
        audioCodec: variant.audioCodec ?? null,
        audioChannels: positiveOrNull(variant.channelsCount),
        audioSampleRateHz: positiveOrNull(variant.audioSamplingRate),
        container: variant.mimeType ?? null,
        nominalFps: positiveOrNull(variant.frameRate),
        width: positiveOrNull(variant.width),
        height: positiveOrNull(variant.height),
    };
}
