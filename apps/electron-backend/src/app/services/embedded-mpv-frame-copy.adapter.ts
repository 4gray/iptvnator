import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import path from 'path';
import {
    EmbeddedMpvBounds,
    EmbeddedMpvFrameSource,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { isFrameCopyPlatformSupported } from './embedded-mpv-frame-copy-platform.util';
import {
    applyHelperEvent,
    buildMpvOptionsPreamble,
    buildLoadPlaybackCommand,
    createInitialSnapshot,
    encodeProtocolValue,
} from './embedded-mpv-frame-copy-protocol';
import { resolveFrameCopyHelperSpawn } from './embedded-mpv-frame-copy-spawn';
import { EmbeddedMpvSessionGoneError } from './embedded-mpv-session-errors';
import type {
    EmbeddedMpvFrameCopyRuntimeMode,
    LinuxFrameCopyHelperLaunchFileSystem,
} from './embedded-mpv-frame-copy-runtime';
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
 * The wire protocol lives in `embedded-mpv-frame-copy-protocol.ts` and the
 * launch/environment rules in `embedded-mpv-frame-copy-spawn.ts`, so this
 * class is mostly a process-lifecycle wrapper plus a snapshot cache that the
 * existing EmbeddedMpvNativeService polling consumes unchanged.
 */

export interface EmbeddedMpvFrameCopyAdapterOptions {
    resolveHelperPath: () => string | null;
    resolveRuntimeMode: () => EmbeddedMpvFrameCopyRuntimeMode | null;
    environment?: NodeJS.ProcessEnv;
    helperLaunchFileSystem?: LinuxFrameCopyHelperLaunchFileSystem;
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

export class EmbeddedMpvFrameCopyAdapter implements NativeEmbeddedMpvAddon {
    private readonly sessions = new Map<string, FrameCopyRuntimeSession>();

    constructor(private readonly options: EmbeddedMpvFrameCopyAdapterOptions) {}

    isSupported(): boolean {
        if (
            !isFrameCopyPlatformSupported() ||
            this.options.resolveHelperPath() === null
        ) {
            return false;
        }
        return (
            process.platform !== 'linux' ||
            this.options.resolveRuntimeMode() !== null
        );
    }

    createSession(
        _windowHandle: Buffer,
        bounds: EmbeddedMpvBounds,
        _title?: string,
        initialVolume?: number,
        extraOptions?: string[]
    ): string {
        const helperPath = this.options.resolveHelperPath();
        if (!helperPath) {
            throw new Error(
                'The frame-copy embedded MPV helper binary was not found.'
            );
        }

        const sessionId = `impv-fc-${randomUUID().slice(0, 8)}`;
        const plan = resolveFrameCopyHelperSpawn({
            bounds,
            environment: this.options.environment,
            helperLaunchFileSystem: this.options.helperLaunchFileSystem,
            helperPath,
            initialVolume,
            resolveRuntimeMode: this.options.resolveRuntimeMode,
            scale: this.options.getScaleFactor(),
            sessionId,
        });

        const child = spawn(plan.command, plan.args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            ...(plan.env ? { env: plan.env } : {}),
        });

        console.log(
            `[embedded-mpv-fc][${sessionId}] spawn ${plan.width}x${plan.height} (pid pending)`
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
        // The helper blocks on this line before initialising libmpv; it is
        // the private channel for options that may carry credentials.
        if (child.stdin.writable) {
            child.stdin.write(
                `${buildMpvOptionsPreamble(extraOptions ?? [])}\n`
            );
        }

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
        const session = this.sessions.get(sessionId);
        if (session && !session.disposed) {
            if (
                session.child.exitCode !== null ||
                session.child.signalCode !== null ||
                !session.child.stdin.writable
            ) {
                // A dead helper (exit code, signal death, or a closed stdin)
                // cannot take a load: `send()` would drop the command
                // silently and a reconnect would wait forever on a
                // `loading` that nothing can ever advance.
                throw new EmbeddedMpvSessionGoneError(
                    sessionId,
                    'the frame-copy helper process has exited'
                );
            }
            // The native addons flip to `loading` synchronously; mirror that
            // so the reconnect coordinator always observes loading → loss
            // for a failed attempt, even when the helper folds START_FILE
            // and the END_FILE error into one snapshot.
            const snapshot = {
                ...session.snapshot,
                status: 'loading' as const,
            };
            delete snapshot.error;
            session.snapshot = snapshot;
        }
        this.send(sessionId, buildLoadPlaybackCommand(playback));
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

    addSubtitle(sessionId: string, filePath: string): void {
        this.send(sessionId, `sub-add\tpath=${encodeProtocolValue(filePath)}`);
    }

    setSubtitleDelay(sessionId: string, seconds: number): void {
        this.send(sessionId, `sub-delay\tvalue=${seconds}`);
    }

    setSubtitleStyle(
        sessionId: string,
        style: { sizePercent: number; color: string | null }
    ): void {
        this.send(sessionId, `sub-scale\tvalue=${style.sizePercent / 100}`);
        // mpv's default sub-color; an explicit reset keeps a previous pick
        // from lingering after the user returns to "default".
        this.send(
            sessionId,
            `sub-color\tvalue=${encodeProtocolValue(style.color ?? '#FFFFFF')}`
        );
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
        if (
            session.child.exitCode !== null ||
            session.child.signalCode !== null ||
            !session.child.stdin.writable
        ) {
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
                applyHelperEvent(session, JSON.parse(line), {
                    resolveReaderPath: () => this.resolveReaderPath(),
                    // Call through `this.options` so a callback that relies on
                    // its own receiver keeps working, as it did inline.
                    onFrameSourceChanged: (id, source) =>
                        this.options.onFrameSourceChanged(id, source),
                });
            } catch {
                console.error(
                    `[embedded-mpv-fc][${session.id}] unparseable event: ${line}`
                );
            }
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
