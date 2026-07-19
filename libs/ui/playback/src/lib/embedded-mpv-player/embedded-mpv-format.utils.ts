import {
    EmbeddedMpvAudioTrack,
    EmbeddedMpvBounds,
} from '@iptvnator/shared/interfaces';

export const HIDDEN_BOUNDS: EmbeddedMpvBounds = Object.freeze({
    x: -100000,
    y: -100000,
    width: 1,
    height: 1,
}) as EmbeddedMpvBounds;

export const SPEED_PRESETS: ReadonlyArray<{ value: number; label: string }> = [
    { value: 0.5, label: '0.5×' },
    { value: 0.75, label: '0.75×' },
    { value: 1, label: '1×' },
    { value: 1.25, label: '1.25×' },
    { value: 1.5, label: '1.5×' },
    { value: 2, label: '2×' },
];

export const ASPECT_PRESETS: ReadonlyArray<{ value: string; label: string }> = [
    { value: 'no', label: 'Default' },
    { value: '16:9', label: '16:9' },
    { value: '4:3', label: '4:3' },
    { value: '21:9', label: '21:9' },
    { value: '2.35:1', label: '2.35:1' },
];

export function formatTime(value: number | null | undefined): string {
    const safeValue = Math.max(0, Math.floor(value ?? 0));
    const hours = Math.floor(safeValue / 3600);
    const minutes = Math.floor((safeValue % 3600) / 60);
    const seconds = safeValue % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(
            seconds
        ).padStart(2, '0')}`;
    }

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

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
        track.title ||
        track.language ||
        (texts.fallback ?? `Audio ${index + 1}`);
    return track.defaultTrack
        ? `${label} · ${texts.defaultLabel ?? 'Default'}`
        : label;
}

export function subtitleTrackLabel(
    track: EmbeddedMpvAudioTrack,
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

export function speedLabel(speed: number): string {
    const value = Math.round(speed * 100) / 100;
    return `${value}×`;
}

export function aspectLabel(aspect: string): string {
    const preset = ASPECT_PRESETS.find((p) => p.value === aspect);
    return preset?.label ?? aspect;
}

export function volumeIcon(value: number): string {
    if (value <= 0) {
        return 'volume_off';
    }
    return value < 0.5 ? 'volume_down' : 'volume_up';
}

export function volumeLabel(value: number): string {
    return `Volume ${Math.round(value * 100)}%`;
}

export function readStoredVolume(): number {
    const rawValue = Number(localStorage.getItem('volume') ?? '1');
    if (Number.isNaN(rawValue)) {
        return 1;
    }
    return Math.max(0, Math.min(1, rawValue));
}

export function persistVolume(value: number): void {
    localStorage.setItem('volume', String(value));
}

export function measureBounds(host: HTMLElement): EmbeddedMpvBounds {
    const rect = host.getBoundingClientRect();
    return {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
    };
}
