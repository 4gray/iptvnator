import { NgFor, NgIf } from '@angular/common';
import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { XtreamCategory } from '../../../../shared/xtream-category.interface';
import { FilterPipe } from '../../shared/pipes/filter.pipe';
import { PortalStore } from '../portal.store';

@Component({
    selector: 'app-category-view',
    standalone: true,
    template: `
        <ng-container *ngIf="items?.length > 0; else noItems">
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
                        {{ item.category_name }}
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
                    <div>Nothing found, try to change you search request</div>
                </div>
            </div>
        </ng-container>
        <ng-template #noItems>
            <div class="no-content">
                <mat-icon class="icon">warning</mat-icon>
                <div>
                    Oops, no content here, please change the category or content
                    type
                </div>
            </div>
        </ng-template>
    `,
    styles: [
        `
            :host {
                margin: 20px;
                display: block;
            }

            mat-card-content {
                overflow-wrap: break-word;
            }

            .no-content {
                text-align: center;

                .icon {
                    font-size: 64px;
                    height: 64px;
                    width: 64px;
                }
            }

            .grid {
                display: flex;
                flex-wrap: wrap;
                gap: 10px;
                justify-content: center;

                .category-item {
                    cursor: pointer;
                    width: 200px;
                }
            }
        `,
    ],
    imports: [
        FilterPipe,
        FormsModule,
        MatCardModule,
        MatIconModule,
        NgFor,
        NgIf,
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
