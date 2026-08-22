/**
 * Metadata captured for a live-TV recording.
 *
 * EPG is time-sensitive: what is airing on a channel cannot be reconstructed
 * after the fact (Xtream/Stalker EPG never reaches SQLite), so the renderer
 * snapshots everything it knows at recording START and hands it down with the
 * start IPC. When the recording stops cleanly, the renderer additionally
 * filters its in-memory program list to the programs overlapping the recorded
 * interval — that is how a recording spanning a program boundary lists every
 * covered program. An implicit stop (session dispose, crash) keeps the start
 * snapshot as-is.
 */

export interface RecordingProgramSnapshot {
    title: string;
    description?: string;
    /** ISO datetime string, same convention as `epg_programs.start`. */
    start: string;
    /** ISO datetime string, same convention as `epg_programs.stop`. */
    stop: string;
}

export type RecordingSourceType = 'm3u' | 'xtream' | 'stalker';

export interface RecordingStartMetadata {
    channelName: string;
    channelLogoUrl?: string;
    playlistId?: string;
    /** Display label snapshot — recordings outlive playlist deletion. */
    playlistName?: string;
    sourceType?: RecordingSourceType;
    /** Resolved EPG lookup/mapping key, when the host knows one. */
    epgChannelId?: string;
    /** The program airing when the recording started, if EPG knew it. */
    currentProgram?: RecordingProgramSnapshot;
}

/**
 * Emitted by the player layer when a recording stopped cleanly. The host
 * component answers it with the programs overlapping [startedAt, endedAt]
 * from its in-memory EPG state (stop enrichment). Implicit stops (session
 * dispose, crash) never emit — the start snapshot stands.
 */
export interface RecordingStoppedEvent {
    targetPath: string;
    /** Recording start (ISO); null when the snapshot never carried it. */
    startedAt: string | null;
    /** Observation time of the stop (ISO). */
    endedAt: string;
    /**
     * EPG key of the channel that was being recorded, captured when the
     * recording went active. Switching channels auto-stops the recording, and
     * by the time the host handles the stop its own state already describes
     * the NEW channel — the host compares this key before enriching, so a
     * recording is never given another channel's schedule.
     */
    epgChannelId?: string | null;
}

export const RECORDING_STATUSES = [
    'recording',
    'completed',
    'interrupted',
    'failed',
] as const;

export type RecordingStatus = (typeof RECORDING_STATUSES)[number];
