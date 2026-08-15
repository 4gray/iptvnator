import { computed, inject, Injectable, OnDestroy, signal } from '@angular/core';
import type {
    ElectronBridgeErrorResult,
    RecordingProgramSnapshot,
} from '@iptvnator/shared/interfaces';
import { DownloadListLoadState } from './download-list-load-state';
import type { RecordingItem } from './recordings.models';
import { RuntimeCapabilitiesService } from './runtime-capabilities.service';

export type { RecordingItem } from './recordings.models';

/**
 * Global store for live-TV recordings, mirroring DownloadsService: one
 * authoritative list refreshed on RECORDINGS_UPDATE_EVENT pings, with
 * overlapping loads coalesced behind one serialized trailing refresh.
 */
@Injectable({ providedIn: 'root' })
export class RecordingsService implements OnDestroy {
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private unsubscribe?: () => void;
    private readonly listLoadState = new DownloadListLoadState();

    readonly recordings = signal<RecordingItem[]>([]);
    readonly isLoadingRecordings = this.listLoadState.isLoading;
    readonly hasLoadedRecordings = this.listLoadState.hasLoaded;
    readonly hasAuthoritativeRecordingList =
        this.listLoadState.hasAuthoritativeList;

    /** Whether the recordings feature is available (Electron only). */
    readonly isAvailable = computed(() => this.runtime.supportsRecordings);

    readonly hasRecordings = computed(() => this.recordings().length > 0);

    /** The recording currently in progress, if any. */
    readonly activeRecording = computed(
        () => this.recordings().find((r) => r.status === 'recording') ?? null
    );

    constructor() {
        this.init();
    }

    private async init() {
        if (!this.isAvailable()) {
            return;
        }

        await this.loadRecordings();
        this.unsubscribe = window.electron.onRecordingsUpdate?.(() => {
            this.loadRecordings();
        });
    }

    ngOnDestroy() {
        this.unsubscribe?.();
    }

    async loadRecordings(): Promise<void> {
        if (!this.isAvailable()) return;

        return this.listLoadState.run(async () => {
            try {
                const list = await window.electron.recordingsGetList?.();
                this.recordings.set(list ?? []);
                this.listLoadState.markSucceeded();
            } catch (error) {
                console.error(
                    '[RecordingsService] Error loading recordings:',
                    error
                );
                this.listLoadState.markFailed();
            }
        });
    }

    async getRecording(recordingId: number): Promise<RecordingItem | null> {
        if (!this.isAvailable()) return null;
        try {
            return (await window.electron.recordingsGet?.(recordingId)) ?? null;
        } catch (error) {
            console.error(
                '[RecordingsService] Error getting recording:',
                error
            );
            return null;
        }
    }

    async stopRecording(
        recordingId: number
    ): Promise<ElectronBridgeErrorResult> {
        return this.runAction('stop', () =>
            window.electron.recordingsStop?.(recordingId)
        );
    }

    async removeRecording(
        recordingId: number
    ): Promise<ElectronBridgeErrorResult> {
        return this.runAction(
            'remove',
            () => window.electron.recordingsRemove?.(recordingId),
            // The ping fires from the backend too, but refreshing directly
            // keeps the UI honest if the broadcast is missed.
            true
        );
    }

    async updatePrograms(
        targetPath: string,
        programs: RecordingProgramSnapshot[]
    ): Promise<ElectronBridgeErrorResult> {
        return this.runAction('update programs', () =>
            window.electron.recordingsUpdatePrograms?.(targetPath, programs)
        );
    }

    async revealFile(filePath: string): Promise<ElectronBridgeErrorResult> {
        return this.runAction('reveal', () =>
            window.electron.recordingsRevealFile?.(filePath)
        );
    }

    async playFile(filePath: string): Promise<ElectronBridgeErrorResult> {
        return this.runAction('play', () =>
            window.electron.recordingsPlayFile?.(filePath)
        );
    }

    private async runAction(
        label: string,
        action: () => Promise<ElectronBridgeErrorResult> | undefined,
        refreshAfter = false
    ): Promise<ElectronBridgeErrorResult> {
        if (!this.isAvailable()) {
            return { error: 'Recordings are not available', success: false };
        }
        try {
            const result = (await action()) ?? {
                error: 'Recordings bridge unavailable',
                success: false,
            };
            if (refreshAfter && result.success) {
                await this.loadRecordings();
            }
            return result;
        } catch (error) {
            console.error(`[RecordingsService] Error (${label}):`, error);
            return {
                error: error instanceof Error ? error.message : String(error),
                success: false,
            };
        }
    }
}
