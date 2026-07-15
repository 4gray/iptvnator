import { computed, inject, Injectable, OnDestroy, signal } from '@angular/core';
import {
    RecordingActionResult,
    RecordingItem,
    RecordingSupport,
    ScheduleRecordingRequest,
    ScheduleRecordingResult,
} from '@iptvnator/shared/interfaces';
import { RuntimeCapabilitiesService } from '@iptvnator/services';

@Injectable({ providedIn: 'root' })
export class RecordingService implements OnDestroy {
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly itemsState = signal<RecordingItem[]>([]);
    private readonly loadingState = signal(false);
    private readonly loadedState = signal(false);
    private readonly supportState = signal<RecordingSupport | null>(null);
    private readonly errorState = signal<string | null>(null);
    private unsubscribe?: () => void;
    private loadRequestId = 0;
    private refreshPromise: Promise<void> | null = null;

    readonly recordings = this.itemsState.asReadonly();
    readonly isLoading = this.loadingState.asReadonly();
    readonly hasLoaded = this.loadedState.asReadonly();
    readonly support = this.supportState.asReadonly();
    readonly error = this.errorState.asReadonly();
    readonly hasDesktopBridge = computed(() => this.runtime.supportsRecordings);
    readonly isAvailable = computed(
        () =>
            this.runtime.supportsRecordings &&
            this.supportState()?.supported === true
    );
    readonly activeCount = computed(
        () =>
            this.recordings().filter(
                (item) =>
                    item.status === 'scheduled' || item.status === 'recording'
            ).length
    );

    constructor() {
        if (!this.runtime.supportsRecordings) {
            return;
        }
        this.unsubscribe = window.electron.onRecordingsUpdate(() => {
            void this.load();
        });
        void this.refresh();
    }

    ngOnDestroy(): void {
        this.unsubscribe?.();
    }

    async load(): Promise<void> {
        if (!this.hasDesktopBridge()) return;
        const requestId = ++this.loadRequestId;
        this.loadingState.set(true);
        try {
            const recordings = await window.electron.recordingsGetList();
            if (requestId === this.loadRequestId) {
                this.itemsState.set(recordings);
                this.errorState.set(null);
                this.loadedState.set(true);
            }
        } catch {
            if (requestId === this.loadRequestId) {
                this.errorState.set('load');
            }
        } finally {
            if (requestId === this.loadRequestId) {
                this.loadingState.set(false);
                this.loadedState.set(true);
            }
        }
    }

    async schedule(
        request: ScheduleRecordingRequest
    ): Promise<ScheduleRecordingResult> {
        if (!this.isAvailable()) {
            return { success: false, error: 'Recordings are not available' };
        }
        try {
            const result = await window.electron.recordingsSchedule(request);
            if (result.success) await this.load();
            return result;
        } catch (error) {
            return { success: false, error: this.errorMessage(error) };
        }
    }

    cancel(recordingId: string): Promise<RecordingActionResult> {
        return this.runAction(() =>
            window.electron.recordingsCancel(recordingId)
        );
    }

    remove(recordingId: string): Promise<RecordingActionResult> {
        return this.runAction(() =>
            window.electron.recordingsRemove(recordingId)
        );
    }

    play(recordingId: string): Promise<RecordingActionResult> {
        return this.runAction(
            () => window.electron.recordingsPlayFile(recordingId),
            false
        );
    }

    reveal(recordingId: string): Promise<RecordingActionResult> {
        return this.runAction(
            () => window.electron.recordingsRevealFile(recordingId),
            false
        );
    }

    refresh(): Promise<void> {
        if (!this.hasDesktopBridge()) return Promise.resolve();
        if (this.refreshPromise) return this.refreshPromise;
        this.supportState.set(null);
        this.loadingState.set(true);
        const attempt = this.refreshSupportAndLoad().finally(() => {
            if (this.refreshPromise === attempt) {
                this.refreshPromise = null;
            }
        });
        this.refreshPromise = attempt;
        return attempt;
    }

    private async runAction(
        action: () => Promise<RecordingActionResult>,
        reload = true
    ): Promise<RecordingActionResult> {
        if (!this.hasDesktopBridge()) {
            return { success: false, error: 'Recordings are not available' };
        }
        try {
            const result = await action();
            if (result.success && reload) await this.load();
            return result;
        } catch (error) {
            return { success: false, error: this.errorMessage(error) };
        }
    }

    private async refreshSupportAndLoad(): Promise<void> {
        try {
            const support = await window.electron.recordingsGetSupport();
            this.supportState.set(support);
        } catch (error) {
            this.supportState.set({
                supported: false,
                reason: this.errorMessage(error),
            });
        }
        await this.load();
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
