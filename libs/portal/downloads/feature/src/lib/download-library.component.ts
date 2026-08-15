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

    protected representativeOf(entity: DownloadLibraryEntity): DownloadItem {
        return entity.kind === 'series' ? entity.representative : entity.item;
    }

    protected entityTitle(entity: DownloadLibraryEntity): string {
        return entity.kind === 'series' ? entity.title : entity.item.title;
    }

    protected typeKey(entity: DownloadLibraryEntity): string {
        switch (entity.kind) {
            case 'movie':
                return 'DOWNLOADS.MOVIE';
            case 'episode':
                return 'DOWNLOADS.EPISODE';
            case 'series':
                return 'DOWNLOADS.SERIES';
        }
    }

    protected placeholderIcon(entity: DownloadLibraryEntity): string {
        switch (entity.kind) {
            case 'movie':
                return 'movie';
            case 'episode':
                return 'live_tv';
            case 'series':
                return 'tv';
        }
    }

    // A pending series representative blocks navigation but must not lock
    // the overflow menu: "Open downloaded episodes" is a local dialog.
    protected moreDisabled(entity: DownloadLibraryEntity): boolean {
        return entity.kind !== 'series' && this.isPending(entity.item);
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

    protected emitAction(
        type: DownloadItemActionType,
        item: DownloadItem
    ): void {
        if (!this.isPending(item)) {
            this.itemAction.emit({ type, item });
        }
    }

    protected openDetails(item: DownloadItem): void {
        if (!this.isPending(item)) {
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
}
