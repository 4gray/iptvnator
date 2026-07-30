import {
    ChangeDetectionStrategy,
    Component,
    inject,
    output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { DownloadItem } from '@iptvnator/services';
import { TranslatePipe } from '@ngx-translate/core';
import type {
    DownloadItemAction,
    DownloadItemActionType,
} from './download-actions';
import type { DownloadSeriesCardViewModel } from './download-library.viewmodel';

@Component({
    selector: 'app-downloaded-series-dialog',
    standalone: true,
    imports: [
        MatButtonModule,
        MatDialogModule,
        MatIconModule,
        MatTooltipModule,
        TranslatePipe,
    ],
    templateUrl: './downloaded-series-dialog.component.html',
    styleUrl: './downloaded-series-dialog.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DownloadedSeriesDialogComponent {
    readonly group = inject<DownloadSeriesCardViewModel>(MAT_DIALOG_DATA);
    readonly itemAction = output<DownloadItemAction>();

    protected emitAction(
        type: DownloadItemActionType,
        item: DownloadItem
    ): void {
        this.itemAction.emit({ type, item });
    }

    protected episodeLabel(item: DownloadItem): string {
        if (
            !Number.isSafeInteger(item.seasonNumber) ||
            (item.seasonNumber ?? -1) < 0 ||
            !Number.isSafeInteger(item.episodeNumber) ||
            (item.episodeNumber ?? -1) < 0
        ) {
            return '';
        }
        return `S${String(item.seasonNumber).padStart(2, '0')}E${String(
            item.episodeNumber
        ).padStart(2, '0')}`;
    }

    protected episodeIdentity(item: DownloadItem): string {
        const label = this.episodeLabel(item);
        return label ? `${label} — ${item.title}` : item.title;
    }

    protected formatBytes(bytes: number | undefined): string {
        if (!Number.isFinite(bytes) || (bytes ?? 0) <= 0) {
            return '0 B';
        }
        const value = bytes as number;
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const exponent = Math.min(
            Math.floor(Math.log(value) / Math.log(1024)),
            units.length - 1
        );
        const normalized = value / 1024 ** exponent;
        return `${normalized >= 10 ? normalized.toFixed(0) : normalized.toFixed(1)} ${units[exponent]}`;
    }
}
