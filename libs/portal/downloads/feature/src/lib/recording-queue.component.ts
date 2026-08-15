import { DatePipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    input,
    output,
    signal,
    untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import type { RecordingItem } from '@iptvnator/services';
import { formatDownloadBytes } from './download-queue.component';
import { DownloadSourceMenuHeaderComponent } from './download-source-menu-header.component';
import type {
    RecordingItemAction,
    RecordingItemActionType,
} from './recording-actions';
import type { RecordingRowViewModel } from './recording-manager.viewmodel';

interface RecordingQueueSection {
    readonly headingId: string;
    readonly headingKey: string;
    readonly items: readonly RecordingRowViewModel[];
    readonly testId: string;
}

/**
 * Queue-area sections for live-TV recordings: "Recording now" (pulsing REC,
 * elapsed time, live file size — never a percentage, the length is unknown)
 * and a recordings-only "Needs attention" list (no re-download: a broadcast
 * cannot be re-recorded, so Remove is the only affordance).
 */
@Component({
    selector: 'app-recording-queue',
    imports: [
        DatePipe,
        MatButtonModule,
        MatIcon,
        MatMenuModule,
        MatTooltip,
        TranslatePipe,
        DownloadSourceMenuHeaderComponent,
    ],
    templateUrl: './recording-queue.component.html',
    styleUrl: './recording-queue.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordingQueueComponent {
    readonly activeItems = input.required<readonly RecordingRowViewModel[]>();
    readonly attentionItems =
        input.required<readonly RecordingRowViewModel[]>();
    readonly pendingIds = input<ReadonlySet<number>>(new Set());
    readonly itemAction = output<RecordingItemAction>();
    readonly openRequested = output<RecordingItem>();

    private readonly elapsedTick = signal(Date.now());

    readonly sections = computed<readonly RecordingQueueSection[]>(() => {
        const sections: RecordingQueueSection[] = [
            {
                headingId: 'recordings-active-heading',
                headingKey: 'DOWNLOADS.RECORDING_NOW',
                items: this.activeItems(),
                testId: 'recordings-active-section',
            },
            {
                headingId: 'recordings-attention-heading',
                headingKey: 'DOWNLOADS.NEEDS_ATTENTION',
                items: this.attentionItems(),
                testId: 'recordings-attention-section',
            },
        ];
        return sections.filter(({ items }) => items.length > 0);
    });

    constructor() {
        effect((onCleanup) => {
            if (this.activeItems().length === 0) {
                return;
            }
            untracked(() => this.elapsedTick.set(Date.now()));
            const intervalId = window.setInterval(
                () => this.elapsedTick.set(Date.now()),
                1000
            );
            onCleanup(() => window.clearInterval(intervalId));
        });
    }

    emitAction(type: RecordingItemActionType, item: RecordingItem): void {
        if (!this.isPending(item.id)) {
            this.itemAction.emit({ type, item });
        }
    }

    requestOpen(item: RecordingItem): void {
        if (!this.isPending(item.id)) {
            this.openRequested.emit(item);
        }
    }

    isPending(id: number): boolean {
        return this.pendingIds().has(id);
    }

    /** Elapsed REC time from started_at against wall clock — no accumulator. */
    elapsedLabel(item: RecordingItem): string {
        this.elapsedTick();
        const startedMs = Date.parse(item.startedAt);
        if (!Number.isFinite(startedMs)) {
            return '00:00';
        }
        const total = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const seconds = total % 60;
        const mmss = `${String(minutes).padStart(2, '0')}:${String(
            seconds
        ).padStart(2, '0')}`;
        return hours > 0 ? `${hours}:${mmss}` : mmss;
    }

    attentionStatusKey(row: RecordingRowViewModel): string {
        return row.attentionReason === 'file-missing'
            ? 'DOWNLOADS.STATUS.FILE_MISSING'
            : 'DOWNLOADS.STATUS.FAILED';
    }

    formatBytes(bytes: number | undefined): string {
        return formatDownloadBytes(bytes);
    }
}
