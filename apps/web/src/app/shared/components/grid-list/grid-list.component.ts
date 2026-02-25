import { Component, computed, input, output } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIcon } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { PlaylistErrorViewComponent } from '../../../xtream-electron/playlist-error-view/playlist-error-view.component';
import { ProgressCapsuleComponent } from '../../../xtream-electron/shared/progress-capsule/progress-capsule.component';
import { WatchedBadgeComponent } from '../../../xtream-electron/shared/watched-badge/watched-badge.component';

interface GridListItem {
    id?: number | string;
    is_series?: number | string | boolean;
    xtream_id?: number | string;
    series_id?: number | string;
    stream_id?: number | string;
    category_id?: number | string;
    poster_url?: string;
    cover?: string;
    title?: string;
    o_name?: string;
    name?: string;
    rating?: string | number;
    rating_imdb?: string | number;
    progress?: number;
    isWatched?: boolean;
    hasSeriesProgress?: boolean;
    [key: string]: unknown;
}

@Component({
    selector: 'app-grid-list',
    template: `<div
            class="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-4"
        >
            @if (isLoading()) {
                @for (row of skeletonRows(); track row) {
                    <div class="grid-skeleton-card" aria-hidden="true">
                        <div class="grid-skeleton-thumb">
                            <span class="grid-skeleton-badge"></span>
                        </div>
                        <div class="grid-skeleton-title">
                            <span
                                class="grid-skeleton-line grid-skeleton-line--primary"
                            ></span>
                            <span
                                class="grid-skeleton-line grid-skeleton-line--secondary"
                            ></span>
                        </div>
                    </div>
                }
            } @else {
                @for (item of items(); track $index) {
                    @let i = $any(item);
                    <mat-card (click)="itemClicked.emit(item)">
                        @let poster = i.poster_url ?? i.cover;
                        <div class="card-thumbnail-container">
                            <img
                                class="stream-icon"
                                [src]="
                                    poster ||
                                    './assets/images/default-poster.png'
                                "
                                (error)="
                                    $event.target.src =
                                        './assets/images/default-poster.png'
                                "
                                loading="lazy"
                                alt="logo"
                            />
                            @if (i.progress && i.progress > 0) {
                                <app-progress-capsule [progress]="i.progress" />
                            }
                            @if (i.isWatched) {
                                <app-watched-badge
                                    [isWatched]="true"
                                    icon="check_circle"
                                />
                            } @else if (i.hasSeriesProgress) {
                                <app-watched-badge
                                    [isWatched]="true"
                                    icon="remove_red_eye"
                                />
                            }
                        </div>
                        @let rating = i.rating ?? i.rating_imdb;
                        @if (rating) {
                            <div
                                class="rating"
                                [matTooltip]="'XTREAM.IMDB_RATING' | translate"
                            >
                                <mat-icon>star</mat-icon>{{ rating }}
                            </div>
                        }
                        @let title = i.title ?? i.o_name ?? i.name;
                        <mat-card-actions>
                            <div class="title">
                                {{ title || 'No name' }}
                            </div>
                        </mat-card-actions>
                    </mat-card>
                } @empty {
                    <app-playlist-error-view
                        [title]="
                            'PORTALS.ERROR_VIEW.EMPTY_CATEGORY.TITLE'
                                | translate
                        "
                        [description]="
                            'PORTALS.ERROR_VIEW.EMPTY_CATEGORY.DESCRIPTION'
                                | translate
                        "
                        [showActionButtons]="false"
                        [viewType]="'EMPTY_CATEGORY'"
                    />
                }
            }
        </div>
        @if (showPaginator() && items()?.length > 0) {
            <mat-paginator
                [pageIndex]="pageIndex()"
                [length]="totalPages() * limit()"
                [pageSize]="limit()"
                [pageSizeOptions]="pageSizeOptions()"
                (page)="pageChange.emit($event)"
                aria-label="Select page"
            />
        } `,
    styleUrl: './grid-list.component.scss',
    imports: [
        TranslatePipe,
        PlaylistErrorViewComponent,
        MatCardModule,
        MatIcon,
        MatTooltip,
        MatPaginatorModule,
        ProgressCapsuleComponent,
        WatchedBadgeComponent,
    ],
})
export class GridListComponent {
    readonly items = input<GridListItem[]>();
    readonly isLoading = input<boolean>();
    readonly showPaginator = input(true);
    readonly itemClicked = output<GridListItem>();
    readonly pageChange = output<PageEvent>();

    readonly pageIndex = input<number>();
    readonly totalPages = input<number>();
    readonly limit = input<number>();
    readonly pageSizeOptions = input<number[]>();

    readonly skeletonRows = computed(() => {
        const preferredCount = this.limit() ?? 12;
        const count = Math.max(8, Math.min(18, preferredCount));
        return Array.from({ length: count }, (_, index) => index);
    });
}
