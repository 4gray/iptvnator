import { Component, input, output } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIcon } from '@angular/material/icon';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { PlaylistErrorViewComponent } from '../../../xtream-tauri/playlist-error-view/playlist-error-view.component';

@Component({
    selector: 'app-grid-list',
    template: `<div class="grid">
            @if (isLoading()) {
                <div class="loading-overlay">
                    <mat-spinner diameter="50"></mat-spinner>
                </div>
            } @else {
                @for (item of items(); track $index) {
                    @let i = $any(item);
                    <mat-card (click)="itemClicked.emit(item)">
                        @let poster = i.poster_url ?? i.cover;
                        <img
                            class="stream-icon"
                            [src]="
                                poster || './assets/images/default-poster.png'
                            "
                            (error)="
                                $event.target.src =
                                    './assets/images/default-poster.png'
                            "
                            loading="lazy"
                            alt="logo"
                        />
                        @let rating = i.rating ?? i.rating_imdb;
                        @if (rating) {
                            <div
                                class="rating"
                                [matTooltip]="'XTREAM.IMDB_RATING' | translate"
                            >
                                <mat-icon>star</mat-icon>{{ rating }}
                            </div>
                        }
                        @let title = i.title ?? i.name;
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
        @if (items()?.length > 0) {
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
        MatProgressSpinner,
        MatTooltip,
        MatPaginatorModule,
    ],
})
export class GridListComponent {
    readonly items = input<any[]>();
    readonly isLoading = input<boolean>();
    readonly itemClicked = output<any>();
    readonly pageChange = output<any>();

    readonly pageIndex = input<number>();
    readonly totalPages = input<number>();
    readonly limit = input<number>();
    readonly pageSizeOptions = input<number[]>();
}
