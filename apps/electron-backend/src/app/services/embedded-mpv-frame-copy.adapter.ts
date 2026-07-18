import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import path from 'path';
import {
    EmbeddedMpvBounds,
    EmbeddedMpvFrameSource,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { isFrameCopyPlatformSupported } from './embedded-mpv-frame-copy-platform.util';
import type {
    NativeEmbeddedMpvAddon,
    NativeEmbeddedMpvSessionSnapshot,
} from './embedded-mpv-native.service';

/**
 * Frame-copy engine adapter: implements the same surface as the native
 * embedded MPV addon, but backed by a per-session `iptvnator_mpv_helper`
 * process. The helper owns libmpv (decode, offscreen render at viewport
 * size, audio) and publishes BGRA frames into a shared-memory ring that the
 * preload frame pump uploads to a renderer canvas.
 *
 * Protocol: tab-separated commands over stdin, JSON events over stdout.
 * The helper's `snapshot` events already carry the
 * NativeEmbeddedMpvSessionSnapshot shape, so this adapter is mostly a
 * process-lifecycle wrapper plus a snapshot cache that the existing
 * EmbeddedMpvNativeService polling consumes unchanged.
 */

export interface EmbeddedMpvFrameCopyAdapterOptions {
    resolveHelperPath: () => string | null;
    getScaleFactor: () => number;
    onFrameSourceChanged: (
        sessionId: string,
        source: EmbeddedMpvFrameSource
    ) => void;
}

interface FrameCopyRuntimeSession {
    id: string;
    child: ChildProcessWithoutNullStreams;
    snapshot: NativeEmbeddedMpvSessionSnapshot;
    frameSource: EmbeddedMpvFrameSource | null;
    stdoutBuffer: string;
    disposed: boolean;
    killTimers: NodeJS.Timeout[];
}

const HELPER_QUIT_GRACE_MS = 500;
const HELPER_KILL_GRACE_MS = 2000;

function encodeProtocolValue(value: string): string {
    return value
        .replace(/%/g, '%25')
        .replace(/\t/g, '%09')
        .replace(/\n/g, '%0A')
        .replace(/\r/g, '%0D');
}

function createInitialSnapshot(): NativeEmbeddedMpvSessionSnapshot {
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

export class EmbeddedMpvFrameCopyAdapter implements NativeEmbeddedMpvAddon {
    private readonly sessions = new Map<string, FrameCopyRuntimeSession>();

    constructor(
        private readonly options: EmbeddedMpvFrameCopyAdapterOptions
    ) {}

    isSupported(): boolean {
        return (
            isFrameCopyPlatformSupported() &&
            this.options.resolveHelperPath() !== null
        );
    }

    createSession(
        _windowHandle: Buffer,
        bounds: EmbeddedMpvBounds,
        _title?: string,
        initialVolume?: number
    ): string {
        const helperPath = this.options.resolveHelperPath();
        if (!helperPath) {
            throw new Error(
                'The frame-copy embedded MPV helper binary was not found.'
            );
        }

        const sessionId = `impv-fc-${randomUUID().slice(0, 8)}`;
        const scale = this.options.getScaleFactor();
        const width = Math.max(16, Math.round(bounds.width * scale));
        const height = Math.max(16, Math.round(bounds.height * scale));

        const child = spawn(
            helperPath,
            [
                '--shm-base',
                `/${sessionId}`,
                '--width',
                String(width),
                '--height',
                String(height),
                '--volume',
                String(Math.min(Math.max(initialVolume ?? 1, 0), 1)),
                // Lip-sync compensation for the video path's added latency
                // (~10 ms measured on M1 Pro); tunable until calibration
                // lands, see the architecture doc.
                ...(process.env.IPTVNATOR_EMBEDDED_MPV_AUDIO_DELAY
                    ? [
                          '--audio-delay',
                          process.env.IPTVNATOR_EMBEDDED_MPV_AUDIO_DELAY,
                      ]
                    : []),
            ],
            { stdio: ['pipe', 'pipe', 'pipe'] }
        );

        console.log(
            `[embedded-mpv-fc][${sessionId}] spawn ${width}x${height} (pid pending)`
        );
        const session: FrameCopyRuntimeSession = {
            id: sessionId,
            child,
            snapshot: createInitialSnapshot(),
            frameSource: null,
            stdoutBuffer: '',
            disposed: false,
            killTimers: [],
        };
        this.sessions.set(sessionId, session);

        child.stdout.on('data', (chunk: Buffer) =>
            this.consumeStdout(session, chunk)
        );
        child.stderr.on('data', (chunk: Buffer) => {
            console.error(
                `[embedded-mpv-fc][${sessionId}] ${chunk.toString().trim()}`
            );
        });
        child.on('error', (error) => {
            session.snapshot.status = 'error';
            session.snapshot.error = `Helper process failed: ${error.message}`;
        });
        child.on('exit', (code, signal) => {
            console.log(
                `[embedded-mpv-fc][${sessionId}] exit code=${code} signal=${signal} disposed=${session.disposed}`
            );
            session.killTimers.forEach((timer) => clearTimeout(timer));
            session.killTimers = [];
            if (session.disposed) {
                session.snapshot.status = 'closed';
                return;
            }
            // An unexpected helper death must surface as a session error so
            // the renderer can fall back — never crash the main process.
            session.snapshot.status = 'error';
            session.snapshot.error = `The embedded MPV helper exited unexpectedly (${
                signal ?? code ?? 'unknown'
            }).`;
        });

        return sessionId;
    }

    loadPlayback(sessionId: string, playback: ResolvedPortalPlayback): void {
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
            fields.push(
                `opt.referrer=${encodeProtocolValue(playback.referer)}`
            );
        }
        if (
            typeof playback.startTime === 'number' &&
            Number.isFinite(playback.startTime) &&
            playback.startTime >= 0
        ) {
            fields.push(`opt.start=${playback.startTime}`);
        }
        if (playback.headers && Object.keys(playback.headers).length > 0) {
            const headerFields = Object.entries(playback.headers)
                .map(([key, value]) => `${key}: ${value}`)
                .join(',');
            fields.push(
                `opt.http-header-fields=${encodeProtocolValue(headerFields)}`
            );
        }
        this.send(sessionId, `load\t${fields.join('\t')}`);
    }

    setBounds(sessionId: string, bounds: EmbeddedMpvBounds): void {
        const scale = this.options.getScaleFactor();
        const width = Math.round(bounds.width * scale);
        const height = Math.round(bounds.height * scale);
        if (width < 16 || height < 16) {
            // Off-screen/hidden bounds are meaningless for a DOM canvas
            // engine; the video keeps rendering at its last real size.
            return;
        }
        this.send(sessionId, `size\twidth=${width}\theight=${height}`);
    }

    setPaused(sessionId: string, paused: boolean): void {
        this.send(sessionId, `pause\tvalue=${paused ? 1 : 0}`);
    }

    seek(sessionId: string, seconds: number): void {
        this.send(sessionId, `seek\tseconds=${seconds}`);
    }

    setVolume(sessionId: string, volume: number): void {
        this.send(sessionId, `volume\tvalue=${volume}`);
    }

    setAudioTrack(sessionId: string, trackId: number): void {
        this.send(sessionId, `aid\tvalue=${trackId}`);
    }

    setSubtitleTrack(sessionId: string, trackId: number): void {
        this.send(sessionId, `sid\tvalue=${trackId}`);
    }

    setSpeed(sessionId: string, speed: number): void {
        this.send(sessionId, `speed\tvalue=${speed}`);
    }

    setAspect(sessionId: string, aspect: string): void {
        this.send(sessionId, `aspect\tvalue=${encodeProtocolValue(aspect)}`);
    }

    startRecording(sessionId: string, targetPath: string): void {
        this.send(sessionId, `record\tpath=${encodeProtocolValue(targetPath)}`);
    }

    stopRecording(sessionId: string): void {
        this.send(sessionId, 'record\tpath=');
    }

    getSessionSnapshot(
        sessionId: string
    ): NativeEmbeddedMpvSessionSnapshot | null {
        const session = this.sessions.get(sessionId);
        return session ? { ...session.snapshot } : null;
    }

    getFrameSource(sessionId: string): EmbeddedMpvFrameSource | null {
        return this.sessions.get(sessionId)?.frameSource ?? null;
    }

    disposeSession(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return;
        }
        session.disposed = true;
        console.log(`[embedded-mpv-fc][${sessionId}] dispose`);
        this.send(sessionId, 'quit');
        const child = session.child;
        // Belt and braces: the helper also exits on stdin EOF, so closing
        // the pipe covers a helper that missed the quit line.
        try {
            child.stdin.end();
        } catch {
            // stdin may already be destroyed with the process
        }
        session.killTimers.push(
            setTimeout(() => {
                if (child.exitCode === null) child.kill('SIGTERM');
            }, HELPER_QUIT_GRACE_MS),
            setTimeout(() => {
                if (child.exitCode === null) child.kill('SIGKILL');
            }, HELPER_KILL_GRACE_MS)
        );
        this.sessions.delete(sessionId);
    }

    private send(sessionId: string, line: string): void {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(
                `Embedded MPV frame-copy session "${sessionId}" was not found.`
            );
        }
        if (session.child.exitCode !== null || !session.child.stdin.writable) {
            return;
        }
        session.child.stdin.write(`${line}\n`);
    }

    private consumeStdout(
        session: FrameCopyRuntimeSession,
        chunk: Buffer
    ): void {
        session.stdoutBuffer += chunk.toString('utf8');
        let newlineIndex = session.stdoutBuffer.indexOf('\n');
        while (newlineIndex >= 0) {
            const line = session.stdoutBuffer.slice(0, newlineIndex).trim();
            session.stdoutBuffer = session.stdoutBuffer.slice(newlineIndex + 1);
            newlineIndex = session.stdoutBuffer.indexOf('\n');
            if (!line) continue;
            try {
                this.handleEvent(session, JSON.parse(line));
            } catch {
                console.error(
                    `[embedded-mpv-fc][${session.id}] unparseable event: ${line}`
                );
            }
        }
    }

    private handleEvent(
        session: FrameCopyRuntimeSession,
        event: Record<string, unknown>
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
                    readerPath: this.resolveReaderPath(),
                };
                session.frameSource = source;
                this.options.onFrameSourceChanged(session.id, source);
                break;
            }
            case 'fatal':
                session.snapshot.status = 'error';
                session.snapshot.error = String(
                    event.error ?? 'Embedded MPV helper failed.'
                );
                break;
            case 'log':
                if (event.level === 'error' || event.level === 'fatal') {
                    console.error(
                        `[embedded-mpv-fc][${session.id}][mpv/${String(
                            event.prefix ?? ''
                        )}] ${String(event.text ?? '').trim()}`
                    );
                }
                break;
            default:
                break;
        }
    }

    private resolveReaderPath(): string {
        const helperPath = this.options.resolveHelperPath();
        return helperPath
            ? path.join(
                  path.dirname(helperPath),
                  'embedded_mpv_frame_reader.node'
              )
            : '';
    }
}
