import {
    EmbeddedMpvFrameSource,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { joinMpvHeaderFields } from '../util/mpv-string-list.util';
import type { NativeEmbeddedMpvSessionSnapshot } from './embedded-mpv-native.service';

/**
 * Wire protocol for the `iptvnator_mpv_helper` frame-copy process:
 * tab-separated commands over stdin, JSON events over stdout.
 *
 * Kept separate from the adapter so the encoding rules and the event contract
 * can be read (and tested) without the process-lifecycle machinery around them.
 */

/**
 * Percent-escape the protocol's structural characters so a title or URL can
 * never inject an extra field or line into a command.
 */
export function encodeProtocolValue(value: string): string {
    return value
        .replace(/%/g, '%25')
        .replace(/\t/g, '%09')
        .replace(/\n/g, '%0A')
        .replace(/\r/g, '%0D');
}

/**
 * The first line the adapter writes to a helper started with
 * `--mpv-options-stdin`: the session's libmpv options in application order.
 * They travel over stdin rather than argv so a credential-bearing option is
 * never visible to `ps`; zero-padded keys keep the order through the
 * helper's unordered field map.
 */
export function buildMpvOptionsPreamble(options: readonly string[]): string {
    return [
        'mpv-options',
        ...options.map(
            (option, index) =>
                `o${String(index).padStart(3, '0')}=${encodeProtocolValue(option)}`
        ),
    ].join('\t');
}

export function createInitialSnapshot(): NativeEmbeddedMpvSessionSnapshot {
    return {
        status: 'loading',
        positionSeconds: 0,
        durationSeconds: null,
        volume: 1,
        streamUrl: '',
        audioTracks: [],
        selectedAudioTrackId: null,
        subtitleTracks: [],
        selectedSubtitleTrackId: null,
        playbackSpeed: 1,
        aspectOverride: 'no',
        recording: { active: false },
    };
}

/** Build the `load` command line for a resolved playback target. */
export function buildLoadPlaybackCommand(
    playback: ResolvedPortalPlayback
): string {
    const fields: string[] = [`url=${encodeProtocolValue(playback.streamUrl)}`];
    if (playback.title) {
        fields.push(
            `opt.force-media-title=${encodeProtocolValue(playback.title)}`
        );
    }
    if (playback.userAgent) {
        fields.push(
            `opt.user-agent=${encodeProtocolValue(playback.userAgent)}`
        );
    }
    if (playback.referer) {
        fields.push(`opt.referrer=${encodeProtocolValue(playback.referer)}`);
    }
    if (
        typeof playback.startTime === 'number' &&
        Number.isFinite(playback.startTime) &&
        playback.startTime >= 0
    ) {
        fields.push(`opt.start=${playback.startTime}`);
    }
    if (playback.headers && Object.keys(playback.headers).length > 0) {
        // The helper %len%-quotes the value at the loadfile-options level, but
        // mpv still parses it as a comma-separated stringlist afterwards, so
        // commas inside header values must be mpv-escaped here.
        const headerFields = joinMpvHeaderFields(
            Object.entries(playback.headers).map(
                ([key, value]) => `${key}: ${value}`
            )
        );
        fields.push(
            `opt.http-header-fields=${encodeProtocolValue(headerFields)}`
        );
    }
    return `load\t${fields.join('\t')}`;
}

/** The mutable per-session state a helper event can act on. */
export interface HelperEventTarget {
    readonly id: string;
    snapshot: NativeEmbeddedMpvSessionSnapshot;
    frameSource: EmbeddedMpvFrameSource | null;
}

export interface HelperEventHandlers {
    resolveReaderPath: () => string;
    onFrameSourceChanged: (
        sessionId: string,
        source: EmbeddedMpvFrameSource
    ) => void;
}

/** Apply one decoded helper stdout event to the session. */
export function applyHelperEvent(
    session: HelperEventTarget,
    event: Record<string, unknown>,
    handlers: HelperEventHandlers
): void {
    switch (event.event) {
        case 'snapshot': {
            const { event: _ignored, ...snapshot } = event;
            session.snapshot = {
                ...session.snapshot,
                ...(snapshot as Partial<NativeEmbeddedMpvSessionSnapshot>),
            } as NativeEmbeddedMpvSessionSnapshot;
            break;
        }
        case 'shm': {
            const source: EmbeddedMpvFrameSource = {
                shmName: String(event.name ?? ''),
                width: Number(event.width ?? 0),
                height: Number(event.height ?? 0),
                generation: Number(event.generation ?? 0),
                readerPath: handlers.resolveReaderPath(),
            };
            session.frameSource = source;
            handlers.onFrameSourceChanged(session.id, source);
            break;
        }
        case 'fatal':
            session.snapshot.status = 'error';
            session.snapshot.error = String(
                event.error ?? 'Embedded MPV helper failed.'
            );
            session.snapshot.errorOrigin = 'engine';
            break;
        case 'log':
            if (event.level === 'error' || event.level === 'fatal') {
                console.error(
                    `[embedded-mpv-fc][${session.id}][mpv/${String(
                        event.prefix ?? ''
                    )}] ${String(event.text ?? '').trim()}`
                );
            } else if (event.level === 'warn' && event.prefix === 'iptvnator') {
                // The helper's own warnings (a session option libmpv
                // rejected) must reach the main-process log like the
                // native-view trace does; mpv's warn-level chatter stays
                // filtered.
                console.warn(
                    `[embedded-mpv-fc][${session.id}] ${String(
                        event.text ?? ''
                    ).trim()}`
                );
            }
            break;
        default:
            break;
    }
}
