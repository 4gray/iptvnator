import type {
    PlayerControlsCapabilities,
    PlayerControlsState,
} from './player-controls.model';

/** The groups of the settings panel, in the order they are rendered. */
export const SETTINGS_GROUPS = [
    'audio',
    'subtitles',
    'quality',
    'speed',
    'aspect',
] as const;

export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];
export type SettingsGroupAvailability = Readonly<
    Record<SettingsGroup, boolean>
>;

/**
 * Which settings groups the current engine and stream offer. A group with
 * nothing to choose from is not rendered, exactly like the popover buttons
 * it replaces were not.
 */
export function getSettingsGroupAvailability(
    capabilities: PlayerControlsCapabilities,
    state: PlayerControlsState
): SettingsGroupAvailability {
    return {
        audio: capabilities.audioTracks && state.audioTracks.length > 1,
        // External subtitle loading keeps the group reachable with an empty
        // track list — the "Load subtitle file…" action is how the first
        // track appears.
        subtitles:
            (capabilities.subtitles && state.subtitleTracks.length > 0) ||
            capabilities.externalSubtitles,
        quality: capabilities.qualityLevels && state.qualityLevels.length > 1,
        speed: capabilities.playbackSpeed,
        aspect: capabilities.aspectRatio,
    };
}

export function anySettingsGroupAvailable(
    availability: SettingsGroupAvailability
): boolean {
    return SETTINGS_GROUPS.some((group) => availability[group]);
}
