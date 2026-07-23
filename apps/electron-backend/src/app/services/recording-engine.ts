import type {
    PersistedRecordingItem,
    RecordingSupport,
    ScheduleRecordingRequest,
} from '@iptvnator/shared/interfaces';
import { powerSaveBlocker } from 'electron';
import { EmbeddedMpvRecordingEngine } from './embedded-mpv-recording-engine';
import { VlcRecordingEngine } from './vlc-recording-engine';

export { EmbeddedMpvRecordingEngine } from './embedded-mpv-recording-engine';

export interface RecordingEngineResult {
    fileName: string;
    filePath: string;
    bytesRecorded: number | null;
}

export type RecordingEngineFailureHandler = (
    recordingId: string,
    error: Error
) => void;

export interface RecordingEngine {
    getSupport(): RecordingSupport;
    getSupportFor?(request: ScheduleRecordingRequest): RecordingSupport;
    setFailureHandler?(handler: RecordingEngineFailureHandler): void;
    hasActiveSession?(recordingId: string): boolean;
    start(recording: PersistedRecordingItem): Promise<RecordingEngineResult>;
    stop(recordingId: string): Promise<RecordingEngineResult>;
    shutdown(): Promise<void> | void;
}

interface RecordingPowerSaveBlocker {
    start(type: 'prevent-app-suspension'): number;
    stop(id: number): void;
    isStarted(id: number): boolean;
}

export class DesktopRecordingEngine implements RecordingEngine {
    private readonly activeEngines = new Map<string, RecordingEngine>();
    private powerSaveBlockerId: number | null = null;

    constructor(
        private readonly embeddedMpv: RecordingEngine = new EmbeddedMpvRecordingEngine(),
        private readonly vlc: RecordingEngine = new VlcRecordingEngine(),
        private readonly recordingPowerSaveBlocker: RecordingPowerSaveBlocker = powerSaveBlocker
    ) {}

    getSupport(): RecordingSupport {
        const mpvSupport = this.embeddedMpv.getSupport();
        if (mpvSupport.supported) {
            return mpvSupport;
        }

        const vlcSupport = this.vlc.getSupport();
        if (vlcSupport.supported) {
            return vlcSupport;
        }

        return {
            supported: false,
            reason: [mpvSupport.reason, vlcSupport.reason]
                .filter(Boolean)
                .join('; '),
        };
    }

    setFailureHandler(handler: RecordingEngineFailureHandler): void {
        this.embeddedMpv.setFailureHandler?.(handler);
        this.vlc.setFailureHandler?.(handler);
    }

    getSupportFor(request: ScheduleRecordingRequest): RecordingSupport {
        const mpvSupport = this.embeddedMpv.getSupport();
        if (mpvSupport.supported) {
            return mpvSupport;
        }
        return this.vlc.getSupportFor?.(request) ?? this.vlc.getSupport();
    }

    async start(
        recording: PersistedRecordingItem
    ): Promise<RecordingEngineResult> {
        if (this.activeEngines.has(recording.id)) {
            throw new Error('Recording is already active');
        }

        const engine = this.selectAvailableEngine();
        this.activeEngines.set(recording.id, engine);
        try {
            const result = await engine.start(recording);
            this.acquirePowerSaveBlocker();
            return result;
        } catch (error) {
            this.activeEngines.delete(recording.id);
            this.releasePowerSaveBlockerIfIdle();
            throw error;
        }
    }

    async stop(recordingId: string): Promise<RecordingEngineResult> {
        const engine = this.activeEngines.get(recordingId);
        if (!engine) {
            throw new Error('Active recording engine was not found');
        }

        try {
            const result = await engine.stop(recordingId);
            this.activeEngines.delete(recordingId);
            this.releasePowerSaveBlockerIfIdle();
            return result;
        } catch (error) {
            if (!engine.hasActiveSession?.(recordingId)) {
                this.activeEngines.delete(recordingId);
                this.releasePowerSaveBlockerIfIdle();
            }
            throw error;
        }
    }

    hasActiveSession(recordingId: string): boolean {
        return this.activeEngines.has(recordingId);
    }

    async shutdown(): Promise<void> {
        await Promise.allSettled([
            Promise.resolve().then(() => this.embeddedMpv.shutdown()),
            Promise.resolve().then(() => this.vlc.shutdown()),
        ]);
        this.activeEngines.clear();
        this.releasePowerSaveBlockerIfIdle();
    }

    private selectAvailableEngine(): RecordingEngine {
        const mpvSupport = this.embeddedMpv.getSupport();
        if (mpvSupport.supported) {
            return this.embeddedMpv;
        }

        const vlcSupport = this.vlc.getSupport();
        if (vlcSupport.supported) {
            return this.vlc;
        }

        throw new Error(
            [mpvSupport.reason, vlcSupport.reason].filter(Boolean).join('; ') ||
                'No recording engine is available'
        );
    }

    private acquirePowerSaveBlocker(): void {
        try {
            if (
                this.powerSaveBlockerId === null ||
                !this.recordingPowerSaveBlocker.isStarted(
                    this.powerSaveBlockerId
                )
            ) {
                this.powerSaveBlockerId = this.recordingPowerSaveBlocker.start(
                    'prevent-app-suspension'
                );
            }
        } catch {
            this.powerSaveBlockerId = null;
        }
    }

    private releasePowerSaveBlockerIfIdle(): void {
        if (this.activeEngines.size > 0 || this.powerSaveBlockerId === null) {
            return;
        }
        try {
            if (
                this.recordingPowerSaveBlocker.isStarted(
                    this.powerSaveBlockerId
                )
            ) {
                this.recordingPowerSaveBlocker.stop(this.powerSaveBlockerId);
            }
        } catch {
            // Power management must never block recording cleanup.
        }
        this.powerSaveBlockerId = null;
    }
}
