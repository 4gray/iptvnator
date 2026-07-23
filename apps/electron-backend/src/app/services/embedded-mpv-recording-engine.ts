import type {
    PersistedRecordingItem,
    RecordingSupport,
} from '@iptvnator/shared/interfaces';
import {
    EmbeddedMpvNativeService,
    embeddedMpvNativeService,
} from './embedded-mpv-native.service';
import type {
    RecordingEngine,
    RecordingEngineResult,
} from './recording-engine';
import { recordingResultForPath } from './recording-file';

type ActiveRecordingSession = {
    sessionId: string;
    filePath: string;
};

const HIDDEN_RECORDING_BOUNDS = {
    x: -10_000,
    y: -10_000,
    width: 1,
    height: 1,
};

export class EmbeddedMpvRecordingEngine implements RecordingEngine {
    private readonly activeSessions = new Map<string, ActiveRecordingSession>();

    constructor(
        private readonly mpv: EmbeddedMpvNativeService = embeddedMpvNativeService
    ) {}

    getSupport(): RecordingSupport {
        const support = this.mpv.prepareAddon();
        if (!support.supported || !support.capabilities?.recording) {
            return {
                supported: false,
                reason:
                    support.reason || 'Embedded MPV recording is not available',
            };
        }
        return { supported: true };
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

        const session = this.mpv.createMainProcessSession(
            HIDDEN_RECORDING_BOUNDS,
            recording.title,
            0
        );

        try {
            this.mpv.loadPlayback(session.id, {
                streamUrl: recording.streamUrl,
                title: recording.title,
                thumbnail: recording.posterUrl,
                isLive: true,
                headers: recording.requestHeaders ?? undefined,
            });
            const updated = this.mpv.startRecording(session.id, {
                directory: recording.recordingDirectory ?? undefined,
                title: recording.title,
            });
            const filePath = updated?.recording?.targetPath;
            if (!filePath || updated?.recording?.error) {
                throw new Error(
                    updated?.recording?.error ||
                        'Embedded MPV did not return a recording path'
                );
            }

            this.activeSessions.set(recording.id, {
                sessionId: session.id,
                filePath,
            });
            return recordingResultForPath(filePath);
        } catch (error) {
            this.mpv.disposeSession(session.id);
            throw error;
        }
    }

    async stop(recordingId: string): Promise<RecordingEngineResult> {
        const active = this.activeSessions.get(recordingId);
        if (!active) {
            throw new Error('Active recording session was not found');
        }

        try {
            const updated = this.mpv.stopRecording(active.sessionId);
            if (updated?.recording?.error) {
                throw new Error(updated.recording.error);
            }
            const result = recordingResultForPath(
                updated?.recording?.targetPath || active.filePath
            );
            if (!result.bytesRecorded) {
                throw new Error(
                    'Embedded MPV recording produced an empty output file'
                );
            }
            return result;
        } finally {
            this.activeSessions.delete(recordingId);
            this.mpv.disposeSession(active.sessionId);
        }
    }

    hasActiveSession(recordingId: string): boolean {
        return this.activeSessions.has(recordingId);
    }

    shutdown(): void {
        for (const active of this.activeSessions.values()) {
            try {
                this.mpv.stopRecording(active.sessionId);
            } catch {
                // Startup recovery marks unfinished rows as interrupted.
            }
            this.mpv.disposeSession(active.sessionId);
        }
        this.activeSessions.clear();
    }
}
