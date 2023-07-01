import { NgFor, NgIf } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { XtreamCategory } from '../../../../shared/xtream-category.interface';
import { FilterPipe } from '../../shared/pipes/filter.pipe';

@Component({
    selector: 'app-category-view',
    standalone: true,
    template: `
        <ng-container *ngIf="items?.length > 0; else noItems">
            <div class="search">
                <input
                    class="search-input"
                    placeholder="Search"
                    [(ngModel)]="searchText"
                    type="search"
                />
            </div>
            <div class="grid">
                <mat-card
                    class="category-item"
                    *ngFor="
                        let item of items
                            | filterBy : searchText : 'category_name';
                        trackBy: trackByFn
                    "
                    (click)="categoryClicked.emit(item)"
                >
                    <mat-card-content>
                        {{ item.category_name }}
                    </mat-card-content>
                </mat-card>
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
                margin: 10px;
                display: block;
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

            .search {
                text-align: center;
                margin-bottom: 10px;

                .search-input {
                    padding: 10px;
                    width: 300px;
                    text-align: center;
                    border-radius: 5px;
                    border: 1px solid #333;
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

    searchText: string;

    trackByFn(_index: number, item: XtreamCategory) {
        return item.category_id;
    }
}
