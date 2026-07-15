import { DatePipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { normalizeDateLocale } from '@iptvnator/pipes';
import { RecordingService } from '@iptvnator/recording/data-access';
import {
    isTerminalRecordingStatus,
    RecordingItem,
    RecordingStatus,
} from '@iptvnator/shared/interfaces';
import { startWith } from 'rxjs';

type RecordingFilter = 'all' | 'upcoming' | 'library';
const RTL_LANGUAGES = new Set(['ar', 'ary', 'fa', 'he', 'ur']);

@Component({
    selector: 'lib-recording-library',
    imports: [DatePipe, MatButtonModule, MatIcon, MatTooltip, TranslatePipe],
    templateUrl: './recording-library.component.html',
    styleUrl: './recording-library.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordingLibraryComponent {
    private readonly snackBar = inject(MatSnackBar);
    private readonly translate = inject(TranslateService);
    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );
    readonly recordingService = inject(RecordingService);
    readonly selectedFilter = signal<RecordingFilter>('all');
    private readonly pendingRecordingIds = signal<ReadonlySet<string>>(
        new Set()
    );
    readonly currentLocale = computed(() => {
        this.languageTick();
        return normalizeDateLocale(
            this.translate.currentLang || this.translate.defaultLang
        );
    });
    readonly textDirection = computed<'ltr' | 'rtl'>(() => {
        this.languageTick();
        const language = (
            this.translate.currentLang ||
            this.translate.defaultLang ||
            'en'
        )
            .split('-')[0]
            .toLowerCase();
        return RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr';
    });
    readonly filters: Array<{ id: RecordingFilter; label: string }> = [
        { id: 'all', label: 'RECORDINGS.FILTERS.ALL' },
        { id: 'upcoming', label: 'RECORDINGS.FILTERS.UPCOMING' },
        { id: 'library', label: 'RECORDINGS.FILTERS.LIBRARY' },
    ];

    readonly visibleRecordings = computed(() => {
        const filter = this.selectedFilter();
        return [...this.recordingService.recordings()]
            .filter((item) => {
                if (filter === 'upcoming') {
                    return ['scheduled', 'recording'].includes(item.status);
                }
                if (filter === 'library') {
                    return (
                        isTerminalRecordingStatus(item.status) &&
                        item.fileAvailable
                    );
                }
                return true;
            })
            .sort((left, right) => {
                if (filter === 'upcoming') {
                    return left.scheduledStartAt.localeCompare(
                        right.scheduledStartAt
                    );
                }
                if (
                    this.isActive(left.status) !== this.isActive(right.status)
                ) {
                    return this.isActive(left.status) ? -1 : 1;
                }
                return right.scheduledStartAt.localeCompare(
                    left.scheduledStartAt
                );
            });
    });

    async cancel(item: RecordingItem): Promise<void> {
        await this.runAction(item.id, () =>
            this.recordingService.cancel(item.id)
        );
    }

    async remove(item: RecordingItem): Promise<void> {
        await this.runAction(item.id, () =>
            this.recordingService.remove(item.id)
        );
    }

    async play(item: RecordingItem): Promise<void> {
        await this.runAction(
            item.id,
            () => this.recordingService.play(item.id),
            false
        );
    }

    async reveal(item: RecordingItem): Promise<void> {
        await this.runAction(
            item.id,
            () => this.recordingService.reveal(item.id),
            false
        );
    }

    isActionPending(recordingId: string): boolean {
        return this.pendingRecordingIds().has(recordingId);
    }

    isActive(status: RecordingStatus): boolean {
        return status === 'scheduled' || status === 'recording';
    }

    statusIcon(status: RecordingStatus): string {
        const icons: Record<RecordingStatus, string> = {
            scheduled: 'schedule',
            recording: 'fiber_manual_record',
            completed: 'check_circle',
            failed: 'error',
            canceled: 'cancel',
            missed: 'event_busy',
            interrupted: 'power_settings_new',
        };
        return icons[status];
    }

    statusLabel(status: RecordingStatus): string {
        return `RECORDINGS.STATUS.${status.toUpperCase()}`;
    }

    formatBytes(bytes?: number | null): string {
        if (!bytes || bytes <= 0) return '';
        const units = ['B', 'KB', 'MB', 'GB'];
        const index = Math.min(
            Math.floor(Math.log(bytes) / Math.log(1024)),
            units.length - 1
        );
        const value = bytes / 1024 ** index;
        return `${new Intl.NumberFormat(this.currentLocale(), {
            maximumFractionDigits: index ? 1 : 0,
        }).format(value)} ${units[index]}`;
    }

    private showResult(
        result: { success: boolean; error?: string },
        showSuccess = true
    ): void {
        const message = result.success
            ? this.translate.instant('RECORDINGS.ACTION_COMPLETE')
            : this.translate.instant('RECORDINGS.ACTION_FAILED');
        if (!result.success || showSuccess) {
            this.snackBar.open(message, undefined, { duration: 3000 });
        }
    }

    private async runAction(
        recordingId: string,
        action: () => Promise<{ success: boolean; error?: string }>,
        showSuccess = true
    ): Promise<void> {
        if (this.isActionPending(recordingId)) return;
        this.pendingRecordingIds.update((pending) =>
            new Set(pending).add(recordingId)
        );
        try {
            this.showResult(await action(), showSuccess);
        } finally {
            this.pendingRecordingIds.update((pending) => {
                const updated = new Set(pending);
                updated.delete(recordingId);
                return updated;
            });
        }
    }
}
