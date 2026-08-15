import { DatePipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { TranslatePipe } from '@ngx-translate/core';
import type { RecordingItem } from '@iptvnator/services';
import { formatDownloadBytes } from './download-queue.component';
import { DownloadSourceMenuHeaderComponent } from './download-source-menu-header.component';
import type {
    RecordingItemAction,
    RecordingItemActionType,
} from './recording-actions';
import type { RecordingRowViewModel } from './recording-manager.viewmodel';

/**
 * "Recordings" library section: 16:9 channel-logo cards in the manager's
 * rail card language. Recordings keep their own section below "Ready to
 * watch" because their geometry (wide logo tile) cannot share a grid with
 * 2:3 posters.
 */
@Component({
    selector: 'app-recording-library',
    imports: [
        DatePipe,
        MatButtonModule,
        MatIcon,
        MatMenuModule,
        TranslatePipe,
        DownloadSourceMenuHeaderComponent,
    ],
    templateUrl: './recording-library.component.html',
    styleUrl: './recording-library.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordingLibraryComponent {
    readonly items = input.required<readonly RecordingRowViewModel[]>();
    readonly pendingIds = input<ReadonlySet<number>>(new Set());
    readonly itemAction = output<RecordingItemAction>();
    readonly openRequested = output<RecordingItem>();

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

    durationLabel(row: RecordingRowViewModel): string {
        const total = row.durationSeconds;
        if (total === null || total <= 0) {
            return '';
        }
        const hours = Math.floor(total / 3600);
        const minutes = Math.round((total % 3600) / 60);
        if (hours > 0) {
            return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
        }
        return `${Math.max(1, minutes)} min`;
    }

    formatBytes(bytes: number | undefined): string {
        return formatDownloadBytes(bytes);
    }
}
