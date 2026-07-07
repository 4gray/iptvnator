import {
    EmbeddedMpvAudioTrack,
    EmbeddedMpvSubtitleTrack,
} from '@iptvnator/shared/interfaces';

export interface TrackLabelTexts {
    /** Used when the track carries neither title nor language. */
    fallback?: string;
    /** Suffix marker for the stream's default track. */
    defaultLabel?: string;
}

export function audioTrackLabel(
    track: EmbeddedMpvAudioTrack,
    index: number,
    texts: TrackLabelTexts = {}
): string {
    const label =
        track.title || track.language || (texts.fallback ?? `Audio ${index + 1}`);
    return track.defaultTrack
        ? `${label} · ${texts.defaultLabel ?? 'Default'}`
        : label;
}

export function subtitleTrackLabel(
    track: EmbeddedMpvSubtitleTrack,
    index: number,
    texts: TrackLabelTexts = {}
): string {
    const label =
        track.title ||
        track.language ||
        (texts.fallback ?? `Subtitle ${index + 1}`);
    return track.defaultTrack
        ? `${label} · ${texts.defaultLabel ?? 'Default'}`
        : label;
}
