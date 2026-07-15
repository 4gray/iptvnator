import {
    spawn,
    spawnSync,
    type ChildProcess,
    type SpawnSyncReturns,
} from 'node:child_process';
import type {
    PersistedRecordingItem,
    RecordingSupport,
    ScheduleRecordingRequest,
} from '@iptvnator/shared/interfaces';
import {
    buildExternalPlayerSpawnSpec,
    type ExternalPlayerLaunchContext,
} from '../events/external-player-launch-context';
import { embeddedMpvNativeService } from './embedded-mpv-native.service';
import type {
    RecordingEngine,
    RecordingEngineFailureHandler,
    RecordingEngineResult,
} from './recording-engine';
import {
    recordingResultForPath,
    releaseReservedRecordingTargetPath,
    reserveRecordingTargetPath,
} from './recording-file';
import {
    cleanupStaleVlcRecordingInputs,
    prepareVlcRecordingCommand,
    validateVlcRecordingHeaders,
} from './vlc-recording-command';
import {
    formatProcessExitReason,
    stopVlcProcess,
    trackVlcProcess,
    untrackVlcProcess,
    waitForProcessSpawn,
} from './vlc-process-control';
import { resolveDefaultVlcLaunchContext } from './vlc-recording-launch-context';
import { buildRecordingRequestHeaders } from './recording-http-headers';

type SpawnRecordingProcess = typeof spawn;
type ProbeRecordingProcess = (
    command: string,
    args: string[],
    options: {
        shell: false;
        stdio: 'ignore';
        timeout: number;
        windowsHide: true;
    }
) => SpawnSyncReturns<Buffer>;

interface ActiveVlcRecording {
    process: ChildProcess;
    filePath: string;
    exited: boolean;
    exitCode: number | null;
    stopping: boolean;
    cleanupInput(): void;
}

export interface VlcRecordingEngineOptions {
    resolveLaunchContext?: () => ExternalPlayerLaunchContext;
    spawnProcess?: SpawnRecordingProcess;
    probeProcess?: ProbeRecordingProcess;
    defaultRecordingDirectory?: () => string;
    stopTimeoutMs?: number;
}

export class VlcRecordingEngine implements RecordingEngine {
    private readonly activeSessions = new Map<string, ActiveVlcRecording>();
    private readonly resolveLaunchContext: () => ExternalPlayerLaunchContext;
    private readonly spawnProcess: SpawnRecordingProcess;
    private readonly probeProcess: ProbeRecordingProcess;
    private readonly defaultRecordingDirectory: () => string;
    private readonly stopTimeoutMs: number;
    private failureHandler: RecordingEngineFailureHandler | null = null;
    private supportCache:
        | { launchKey: string; support: RecordingSupport }
        | undefined;

    constructor(options: VlcRecordingEngineOptions = {}) {
        cleanupStaleVlcRecordingInputs();
        this.resolveLaunchContext =
            options.resolveLaunchContext ?? resolveDefaultVlcLaunchContext;
        this.spawnProcess = options.spawnProcess ?? spawn;
        this.probeProcess = options.probeProcess ?? spawnSync;
        this.defaultRecordingDirectory =
            options.defaultRecordingDirectory ??
            (() => embeddedMpvNativeService.getDefaultRecordingFolder());
        this.stopTimeoutMs = options.stopTimeoutMs ?? 5_000;
    }

    getSupport(): RecordingSupport {
        const launchContext = this.resolveLaunchContext();
        const launchKey = JSON.stringify(launchContext);
        if (this.supportCache?.launchKey === launchKey) {
            return this.supportCache.support;
        }
        if (launchContext.mode === 'flatpak-host') {
            return this.cacheSupport(launchKey, {
                supported: false,
                reason: 'VLC recording through Flatpak is not supported yet',
            });
        }

        let probe: SpawnSyncReturns<Buffer>;
        try {
            probe = this.probeProcess(
                launchContext.command,
                [...launchContext.argsPrefix, '--version'],
                {
                    shell: false,
                    stdio: 'ignore',
                    timeout: 2_000,
                    windowsHide: true,
                }
            );
        } catch {
            return this.cacheSupport(launchKey, {
                supported: false,
                reason: `VLC could not be started at ${launchContext.playerPath}`,
            });
        }
        if (probe.error || probe.status !== 0) {
            return this.cacheSupport(launchKey, {
                supported: false,
                reason: `VLC could not be started at ${launchContext.playerPath}`,
            });
        }

        return this.cacheSupport(launchKey, { supported: true });
    }

    setFailureHandler(handler: RecordingEngineFailureHandler): void {
        this.failureHandler = handler;
    }
    getSupportFor(request: ScheduleRecordingRequest): RecordingSupport {
        const support = this.getSupport();
        if (!support.supported) {
            return support;
        }
        try {
            validateVlcRecordingHeaders(buildRecordingRequestHeaders(request));
            return support;
        } catch (error) {
            return {
                supported: false,
                reason: error instanceof Error ? error.message : String(error),
            };
        }
    }

    async start(
        recording: PersistedRecordingItem
    ): Promise<RecordingEngineResult> {
        if (this.activeSessions.has(recording.id)) {
            throw new Error('Recording is already active');
        }
        if (!recording.streamUrl) {
            throw new Error('Recording playback URL is no longer available');
        }

        const support = this.getSupport();
        if (!support.supported) {
            throw new Error(support.reason);
        }

        const directory =
            recording.recordingDirectory?.trim() ||
            this.defaultRecordingDirectory();
        const filePath = reserveRecordingTargetPath(directory, recording.title);
        let cleanupInput: (() => void) | undefined;
        let spawnedProcess: ChildProcess | undefined;
        try {
            const prepared = prepareVlcRecordingCommand(recording, filePath);
            cleanupInput = prepared.cleanup;
            const launchContext = this.resolveLaunchContext();
            const spawnSpec = buildExternalPlayerSpawnSpec(
                launchContext,
                prepared.args
            );
            const process = this.spawnProcess(
                spawnSpec.command,
                spawnSpec.args,
                {
                    shell: false,
                    detached: false,
                    stdio: ['pipe', 'ignore', 'ignore'],
                }
            );
            spawnedProcess = process;
            const active: ActiveVlcRecording = {
                process,
                filePath,
                exited: false,
                exitCode: null,
                stopping: false,
                cleanupInput: prepared.cleanup,
            };
            trackVlcProcess(process);
            process.once('exit', (code, signal) => {
                untrackVlcProcess(process);
                active.exited = true;
                active.exitCode = code;
                active.cleanupInput();
                if (!active.stopping) {
                    queueMicrotask(() => {
                        if (this.activeSessions.get(recording.id) === active) {
                            this.failureHandler?.(
                                recording.id,
                                new Error(
                                    `VLC recording process exited unexpectedly (${formatProcessExitReason(
                                        code,
                                        signal
                                    )})`
                                )
                            );
                        }
                    });
                }
            });

            await waitForProcessSpawn(process);
            if (active.exited || process.exitCode !== null) {
                throw new Error(
                    `VLC exited before recording could start (code ${
                        active.exitCode ?? process.exitCode ?? 'unknown'
                    })`
                );
            }

            this.activeSessions.set(recording.id, active);
            return recordingResultForPath(filePath);
        } catch (error) {
            if (spawnedProcess) {
                untrackVlcProcess(spawnedProcess);
            }
            cleanupInput?.();
            releaseReservedRecordingTargetPath(filePath);
            throw error;
        }
    }

    async stop(recordingId: string): Promise<RecordingEngineResult> {
        const active = this.activeSessions.get(recordingId);
        if (!active) {
            throw new Error('Active VLC recording session was not found');
        }

        try {
            active.stopping = true;
            if (!active.exited && active.process.exitCode === null) {
                await stopVlcProcess(active.process, this.stopTimeoutMs);
            }
            const exitCode = active.exitCode ?? active.process.exitCode;
            if (exitCode !== null && exitCode !== 0) {
                throw new Error(
                    `VLC recording process exited with code ${exitCode}`
                );
            }
            const result = recordingResultForPath(active.filePath);
            if (!result.bytesRecorded) {
                throw new Error('VLC recording produced an empty output file');
            }
            return result;
        } finally {
            // Keep sessions whose process is still alive. The scheduler uses
            // hasActiveSession() to retry cancellation instead of marking a
            // still-running VLC capture as terminal and orphaning the process.
            if (active.exited || active.process.exitCode !== null) {
                this.activeSessions.delete(recordingId);
                active.cleanupInput();
                untrackVlcProcess(active.process);
            }
        }
    }

    async shutdown(): Promise<void> {
        await Promise.allSettled(
            [...this.activeSessions.keys()].map((recordingId) =>
                this.stop(recordingId)
            )
        );
    }
    hasActiveSession(recordingId: string): boolean {
        return this.activeSessions.has(recordingId);
    }
    private cacheSupport(
        launchKey: string,
        support: RecordingSupport
    ): RecordingSupport {
        if (support.supported) {
            this.supportCache = { launchKey, support };
        }
        return support;
    }
}
