import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { DownloadItem } from '@iptvnator/services';
import { TranslatePipe } from '@ngx-translate/core';
import type {
    DownloadItemAction,
    DownloadItemActionType,
} from './download-actions';
import type {
    DownloadLibraryEntity,
    DownloadSeriesCardViewModel,
} from './download-library.viewmodel';
import { DownloadSourceMenuHeaderComponent } from './download-source-menu-header.component';

@Component({
    selector: 'app-download-library',
    standalone: true,
    imports: [
        MatButtonModule,
        MatIconModule,
        MatMenuModule,
        MatTooltipModule,
        TranslatePipe,
        DownloadSourceMenuHeaderComponent,
    ],
    templateUrl: './download-library.component.html',
    styleUrl: './download-library.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DownloadLibraryComponent {
    readonly entities = input.required<readonly DownloadLibraryEntity[]>();
    readonly availablePlaylistIds = input.required<ReadonlySet<string>>();
    readonly pendingIds = input<ReadonlySet<number>>(new Set());
    readonly itemAction = output<DownloadItemAction>();
    readonly openRequested = output<DownloadItem>();
    readonly episodesOpened = output<DownloadSeriesCardViewModel>();
    readonly failedArtwork = signal<ReadonlySet<string>>(new Set());

    protected libraryTestId(entity: DownloadLibraryEntity): string {
        switch (entity.kind) {
            case 'movie':
                return `download-library-movie-${entity.item.id}`;
            case 'episode':
                return `download-library-episode-${entity.item.id}`;
            case 'series':
                return `download-library-series-${entity.representative.playlistId}-${entity.seriesXtreamId}`;
        }
    }

    protected artworkUrl(entity: DownloadLibraryEntity): string | undefined {
        const raw =
            entity.kind === 'series' ? entity.posterUrl : entity.item.posterUrl;
        return raw?.trim() && !this.failedArtwork().has(entity.key)
            ? raw
            : undefined;
    }

    protected markArtworkFailed(
        entity: DownloadLibraryEntity,
        event: Event
    ): void {
        if (this.failedArtwork().has(entity.key)) {
            return;
        }
        this.failedArtwork.update((failed) => {
            const next = new Set(failed);
            next.add(entity.key);
            return next;
        });
        (event.target as HTMLImageElement | null)?.removeAttribute('src');
    }

    protected isPending(item: DownloadItem): boolean {
        return this.pendingIds().has(item.id);
    }

    protected canOpen(item: DownloadItem): boolean {
        return this.availablePlaylistIds().has(item.playlistId);
    }

    protected emitAction(
        type: DownloadItemActionType,
        item: DownloadItem
    ): void {
        if (!this.isPending(item)) {
            this.itemAction.emit({ type, item });
        }
    }

    protected openDetails(item: DownloadItem): void {
        if (!this.isPending(item) && this.canOpen(item)) {
            this.openRequested.emit(item);
        }
    }

    protected openEpisodes(group: DownloadSeriesCardViewModel): void {
        this.episodesOpened.emit(group);
    }

    protected episodeCountKey(count: number): string {
        return count === 1
            ? 'DOWNLOADS.EPISODE_COUNT_ONE'
            : 'DOWNLOADS.EPISODE_COUNT_OTHER';
    }

    protected formatBytes(bytes: number): string {
        if (!Number.isFinite(bytes) || bytes <= 0) {
            return '0 B';
        }
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const exponent = Math.min(
            Math.floor(Math.log(bytes) / Math.log(1024)),
            units.length - 1
        );
        const value = bytes / 1024 ** exponent;
        const formatted =
            value >= 10 || Number.isInteger(value)
                ? value.toFixed(0)
                : value.toFixed(1);
        return `${formatted} ${units[exponent]}`;
    }
}
