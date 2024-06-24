import { NgFor, NgIf } from '@angular/common';
import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
            <div class="grid">
                <mat-card
                    appearance="outlined"
                    class="category-item"
                    *ngFor="
                        let item of items
                            | filterBy: searchText() : 'category_name';
                        trackBy: trackByFn
                    "
                    (click)="categoryClicked.emit(item)"
                >
                    <mat-card-content>
                        {{ item.category_name || item.name || 'no name' }}
                    </mat-card-content>
                </mat-card>
                <div
                    class="no-content"
                    *ngIf="
                        !(items | filterBy: searchText() : 'category_name')
                            ?.length
                    "
                >
                    <mat-icon class="icon">search</mat-icon>
                    <div>
                        {{
                            'PORTALS.EMPTY_LIST_VIEW.NO_SEARCH_RESULTS'
                                | translate
                        }}
                    </div>
                </div>
            </div>
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
        PlaylistErrorViewComponent,
        FilterPipe,
        FormsModule,
        MatCardModule,
        MatIconModule,
        NgFor,
        NgIf,
        TranslateModule,
    ],
})
export class CategoryViewComponent {
    @Input({ required: true }) items: XtreamCategory[];

    @Output() categoryClicked = new EventEmitter<XtreamCategory>();

    portalStore = inject(PortalStore);

    searchText = this.portalStore.searchPhrase;

    trackByFn(_index: number, item: XtreamCategory) {
        return item.category_id;
    }
}
