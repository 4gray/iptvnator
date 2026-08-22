import type { PlayerTrack } from '../player-controls/player-controls.model';
import { clampSubtitleDelay } from '../player-controls/subtitle-style';
import {
    type ExternalSubtitleFile,
    type ParsedSubtitleCue,
    WEB_SUBTITLE_FILE_EXTENSIONS,
    decodeExternalSubtitleBytes,
    detectExternalSubtitleFormat,
    parseExternalSubtitleCues,
} from './external-subtitle-cues.util';

/**
 * External track IDs live far above every engine ID space (hls.js/Shaka list
 * indices, native enumeration counters), so merged listings cannot collide.
 */
export const EXTERNAL_SUBTITLE_TRACK_ID_BASE = 100000;

interface ExternalSubtitleEntry {
    id: number;
    label: string;
    cues: ParsedSubtitleCue[];
    track: TextTrack | null;
    /** Same order as `cues`; kept so delay changes can re-time exactly. */
    trackCues: VTTCue[];
}

export interface WebVideoExternalSubtitlesConfig {
    getVideo: () => HTMLVideoElement | null;
    /** Turns the engine-owned subtitle selection off when an external track is chosen. */
    deselectEngineSubtitles: () => void;
    refresh: () => void;
}

/**
 * Owns user-loaded subtitle files for a web video engine. Each file becomes a
 * native `TextTrack` on the video element, so the browser renders the cues
 * (and `::cue` styling applies) regardless of which source engine is active.
 *
 * The subtitle delay applies to these tracks only: their cues are fully owned
 * here, so re-timing is exact. Engine/stream tracks arrive incrementally and
 * are left untouched.
 */
export class WebVideoExternalSubtitles {
    private entries: ExternalSubtitleEntry[] = [];
    private delaySeconds = 0;
    private nextId = EXTERNAL_SUBTITLE_TRACK_ID_BASE;
    /**
     * Every TextTrack this session ever created. `addTextTrack` tracks cannot
     * be removed from the element, so ownership must outlive `clear()` — a
     * dropped-per-source set would let stale (or attach-failed) tracks
     * reappear in the native enumeration as ghost engine tracks.
     */
    private readonly createdTracks = new Set<TextTrack>();

    constructor(private readonly config: WebVideoExternalSubtitlesConfig) {}

    hasTracks(): boolean {
        return this.entries.length > 0;
    }

    /** True while an external track is the one actually rendering. */
    hasSelectedTrack(): boolean {
        return this.entries.some((entry) => entry.track?.mode === 'showing');
    }

    ownsTrack(track: TextTrack): boolean {
        return this.createdTracks.has(track);
    }

    ownsTrackId(id: number): boolean {
        return this.entries.some((entry) => entry.id === id);
    }

    /** Parses and attaches the file; returns false when no cue was usable. */
    addFromFile(file: ExternalSubtitleFile): boolean {
        const cues = parseExternalSubtitleCues(file);
        if (cues.length === 0) {
            return false;
        }

        const entry: ExternalSubtitleEntry = {
            id: this.nextId,
            label: file.name,
            cues,
            track: null,
            trackCues: [],
        };
        if (!this.attachEntry(entry)) {
            return false;
        }

        this.nextId += 1;
        this.entries.push(entry);
        this.select(entry.id);
        return true;
    }

    getTracks(): PlayerTrack[] {
        return this.entries.map((entry) => ({
            id: entry.id,
            label: entry.label,
            selected: entry.track?.mode === 'showing',
        }));
    }

    select(id: number): void {
        if (!this.ownsTrackId(id)) {
            return;
        }
        // Deselect the engine FIRST: hls.js reacts to `subtitleTrack = -1` by
        // disabling every subtitle-kind TextTrack on the element, which would
        // immediately undo a mode we had already set.
        this.config.deselectEngineSubtitles();
        for (const entry of this.entries) {
            if (entry.track) {
                entry.track.mode = entry.id === id ? 'showing' : 'hidden';
            }
        }
        this.config.refresh();
    }

    deselectAll(): void {
        for (const entry of this.entries) {
            if (entry.track) {
                entry.track.mode = 'hidden';
            }
        }
    }

    getDelay(): number {
        return this.delaySeconds;
    }

    setDelay(seconds: number): void {
        this.delaySeconds = clampSubtitleDelay(seconds);
        for (const entry of this.entries) {
            this.applyDelayToEntry(entry);
        }
        this.config.refresh();
    }

    /** Per-source teardown: external files correct one specific stream. */
    clear(): void {
        for (const entry of this.entries) {
            this.detachEntry(entry);
        }
        this.entries = [];
        this.delaySeconds = 0;
    }

    private attachEntry(entry: ExternalSubtitleEntry): boolean {
        const video = this.config.getVideo();
        const CueCtor = (
            globalThis as { VTTCue?: new (
                start: number,
                end: number,
                text: string
            ) => VTTCue }
        ).VTTCue;
        if (
            !video ||
            typeof video.addTextTrack !== 'function' ||
            typeof CueCtor !== 'function'
        ) {
            return false;
        }

        try {
            const track = video.addTextTrack('subtitles', entry.label);
            this.createdTracks.add(track);
            entry.track = track;
            // Push incrementally so the catch below can remove exactly the
            // cues that made it onto the track before a mid-loop failure.
            for (const cue of entry.cues) {
                const shifted = this.shiftCueTimes(cue);
                const vttCue = new CueCtor(
                    shifted.startSeconds,
                    shifted.endSeconds,
                    cue.text
                );
                track.addCue(vttCue);
                entry.trackCues.push(vttCue);
            }
            return true;
        } catch {
            // A mid-loop failure leaves an unremovable track on the element:
            // silence it so the half-populated cue set can never render. It
            // stays in `createdTracks`, so the enumeration keeps excluding it.
            this.detachEntry(entry);
            return false;
        }
    }

    private detachEntry(entry: ExternalSubtitleEntry): void {
        const track = entry.track;
        entry.track = null;
        if (!track) {
            return;
        }
        try {
            for (const cue of entry.trackCues) {
                track.removeCue(cue);
            }
        } catch {
            // Removing cues is best-effort; disabling the track hides them.
        }
        entry.trackCues = [];
        track.mode = 'disabled';
    }

    private applyDelayToEntry(entry: ExternalSubtitleEntry): void {
        for (let index = 0; index < entry.trackCues.length; index += 1) {
            const shifted = this.shiftCueTimes(entry.cues[index]);
            entry.trackCues[index].startTime = shifted.startSeconds;
            entry.trackCues[index].endTime = shifted.endSeconds;
        }
    }

    private shiftCueTimes(cue: ParsedSubtitleCue): {
        startSeconds: number;
        endSeconds: number;
    } {
        // No clamping: negative cue times are valid VTTCue values that are
        // simply never active. Clamping early cues to [0, ~0] would stack
        // every pre-roll cue simultaneously at t=0 under a negative delay.
        return {
            startSeconds: cue.startSeconds + this.delaySeconds,
            endSeconds: cue.endSeconds + this.delaySeconds,
        };
    }
}

/**
 * Opens a one-shot subtitle file picker. Runs entirely in the renderer (works
 * in the PWA and Electron alike) and hands back the file's name and content —
 * no filesystem path ever enters the app, so nothing sensitive can be logged.
 */
export function pickExternalSubtitleFile(
    doc: Document,
    onPicked: (file: ExternalSubtitleFile) => void
): void {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = WEB_SUBTITLE_FILE_EXTENSIONS.join(',');
    input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) {
            return;
        }
        const format = detectExternalSubtitleFormat(file.name);
        if (!format) {
            return;
        }
        // Raw bytes, not file.text(): legacy encodings (CP1251/1252, UTF-16)
        // are still common for downloaded subtitles and need detection.
        void file.arrayBuffer().then(
            (buffer) =>
                onPicked({
                    name: file.name,
                    format,
                    content: decodeExternalSubtitleBytes(buffer),
                }),
            () => undefined
        );
    });
    input.click();
}
