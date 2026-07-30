import { NgTemplateOutlet } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import type { DownloadItem } from '@iptvnator/services';
import type {
    DownloadItemAction,
    DownloadItemActionType,
} from './download-actions';
import type { DownloadListItemViewModel } from './download-manager.viewmodel';

type DownloadProgressMode = 'determinate' | 'indeterminate';

interface DownloadQueueSection {
    readonly headingId: string;
    readonly headingKey: string;
    readonly items: readonly DownloadListItemViewModel[];
    readonly testId: string;
}

interface DownloadItemWithKnownTotal extends DownloadItem {
    readonly totalBytes: number;
}

const STATUS_ICONS: Readonly<Record<DownloadItem['status'], string>> = {
    queued: 'schedule',
    downloading: 'downloading',
    paused: 'pause_circle',
    completed: 'check_circle',
    failed: 'error',
    canceled: 'cancel',
};

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatDownloadBytes(bytes: number | undefined): string {
    if (!Number.isFinite(bytes) || bytes === undefined || bytes <= 0) {
        return '0 B';
    }

    const unitIndex = Math.max(
        0,
        Math.min(
            Math.floor(Math.log(bytes) / Math.log(1024)),
            BYTE_UNITS.length - 1
        )
    );
    const value = bytes / 1024 ** unitIndex;
    const rounded = Math.round(value * 10) / 10;
    return `${rounded} ${BYTE_UNITS[unitIndex]}`;
}

@Component({
    selector: 'app-download-queue',
    imports: [
        MatButtonModule,
        MatIcon,
        MatMenuModule,
        MatProgressBarModule,
        MatTooltip,
        NgTemplateOutlet,
        TranslatePipe,
    ],
    templateUrl: './download-queue.component.html',
    styleUrl: './download-queue.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DownloadQueueComponent {
    readonly activeItems =
        input.required<readonly DownloadListItemViewModel[]>();
    readonly attentionItems =
        input.required<readonly DownloadListItemViewModel[]>();
    readonly pendingIds = input<ReadonlySet<number>>(new Set());
    readonly itemAction = output<DownloadItemAction>();
    readonly openRequested = output<DownloadItem>();

    private readonly failedPosterIds = signal<ReadonlySet<number>>(new Set());

    readonly sections = computed<readonly DownloadQueueSection[]>(() => {
        const sections: DownloadQueueSection[] = [
            {
                headingId: 'downloads-active-heading',
                headingKey: 'DOWNLOADS.DOWNLOADING_NOW',
                items: this.activeItems(),
                testId: 'downloads-active-section',
            },
            {
                headingId: 'downloads-attention-heading',
                headingKey: 'DOWNLOADS.NEEDS_ATTENTION',
                items: this.attentionItems(),
                testId: 'downloads-attention-section',
            },
        ];
        return sections.filter(({ items }) => items.length > 0);
    });

    emitAction(type: DownloadItemActionType, item: DownloadItem): void {
        if (!this.isPending(item.id)) {
            this.itemAction.emit({ type, item });
        }
    }

    requestOpen(item: DownloadItem): void {
        if (!this.isPending(item.id)) {
            this.openRequested.emit(item);
        }
    }

    isPending(id: number): boolean {
        return this.pendingIds().has(id);
    }

    statusIcon(item: DownloadItem): string {
        return STATUS_ICONS[item.status];
    }

    hasPoster(item: DownloadItem): boolean {
        return (
            (item.posterUrl?.trim().length ?? 0) > 0 &&
            !this.failedPosterIds().has(item.id)
        );
    }

    markPosterFailed(item: DownloadItem): void {
        this.failedPosterIds.update((ids) => {
            if (ids.has(item.id)) {
                return ids;
            }
            const next = new Set(ids);
            next.add(item.id);
            return next;
        });
    }

    hasKnownTotal(item: DownloadItem): item is DownloadItemWithKnownTotal {
        return (
            item.totalBytes !== undefined &&
            Number.isFinite(item.totalBytes) &&
            item.totalBytes > 0
        );
    }

    progressMode(item: DownloadItem): DownloadProgressMode | null {
        if (item.status === 'paused') {
            return this.hasKnownTotal(item) ? 'determinate' : null;
        }
        if (item.status === 'queued' || item.status === 'downloading') {
            return this.hasKnownTotal(item) ? 'determinate' : 'indeterminate';
        }
        return null;
    }

    progressValue(item: DownloadItem): number {
        if (!this.hasKnownTotal(item)) {
            return 0;
        }
        const downloaded =
            item.bytesDownloaded !== undefined &&
            Number.isFinite(item.bytesDownloaded)
                ? Math.max(0, item.bytesDownloaded)
                : 0;
        return Math.min(100, (downloaded / item.totalBytes) * 100);
    }

    formatBytes(bytes: number | undefined): string {
        return formatDownloadBytes(bytes);
    }
}
