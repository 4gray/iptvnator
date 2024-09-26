import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { XtreamCategory } from '../../../../shared/xtream-category.interface';
import { FilterPipe } from '../../shared/pipes/filter.pipe';
import { PlaylistErrorViewComponent } from '../playlist-error-view/playlist-error-view.component';
import { PortalStore } from '../portal.store';

@Component({
    selector: 'app-category-view',
    standalone: true,
    template: `
        @if (items?.length > 0) {
            @for (
                item of items | filterBy: searchPhrase() : 'category_name';
                track $index
            ) {
                <mat-card
                    appearance="outlined"
                    class="category-item"
                    (click)="categoryClicked.emit(item)"
                >
                    <mat-card-content>
                        {{
                            item.category_name ||
                                item.name ||
                                'No category name'
                        }}
                    </mat-card-content>
                </mat-card>
            }
            @if (
                !(items | filterBy: searchPhrase() : 'category_name')?.length
            ) {
                <app-playlist-error-view
                    title="No results"
                    [description]="
                        'PORTALS.EMPTY_LIST_VIEW.NO_SEARCH_RESULTS' | translate
                    "
                    [showActionButtons]="false"
                    [viewType]="'NO_SEARCH_RESULTS'"
                />
            }
        } @else {
            <app-playlist-error-view
                [title]="'PORTALS.ERROR_VIEW.EMPTY_CATEGORY.TITLE' | translate"
                [description]="
                    'PORTALS.ERROR_VIEW.EMPTY_CATEGORY.DESCRIPTION' | translate
                "
                [showActionButtons]="false"
                [viewType]="'EMPTY_CATEGORY'"
            />
        }
    `,
    styleUrl: './category-view.component.scss',
    imports: [
        FilterPipe,
        MatCardModule,
        MatIconModule,
        PlaylistErrorViewComponent,
        TranslateModule,
    ],
})
export class CategoryViewComponent {
    @Input({ required: true }) items: XtreamCategory[];

    @Output() categoryClicked = new EventEmitter<XtreamCategory>();

    portalStore = inject(PortalStore);
    searchPhrase = this.portalStore.searchPhrase;
}
