import {
    ChangeDetectionStrategy,
    Component,
    EventEmitter,
    Output,
    inject,
} from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { XtreamCategory } from '../../../../shared/xtream-category.interface';
import { FilterPipe } from '../../shared/pipes/filter.pipe';
import { PlaylistErrorViewComponent } from '../playlist-error-view/playlist-error-view.component';
import { XtreamStore } from '../xtream.store';

@Component({
    selector: 'app-category-view',
    standalone: true,
    imports: [
        FilterPipe,
        MatCardModule,
        MatIconModule,
        MatListModule,
        PlaylistErrorViewComponent,
        TranslateModule,
        MatTooltipModule,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @let items = xtreamStore.getCategoriesBySelectedType();

        @if (items?.length > 0) {
            <mat-nav-list>
                @for (item of items; track $index) {
                    <mat-list-item
                        class="category-item"
                        [class.selected]="isSelected(item)"
                        (click)="categoryClicked.emit(item)"
                    >
                        {{
                            item.category_name ||
                                $any(item).name ||
                                'No category name'
                        }}
                    </mat-list-item>
                }
                @if (!items?.length) {
                    <app-playlist-error-view
                        title="No results"
                        [description]="
                            'PORTALS.EMPTY_LIST_VIEW.NO_SEARCH_RESULTS'
                                | translate
                        "
                        [showActionButtons]="false"
                        [viewType]="'NO_SEARCH_RESULTS'"
                    />
                }
            </mat-nav-list>
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
})
export class CategoryViewComponent {
    @Output() categoryClicked = new EventEmitter<XtreamCategory>();

    xtreamStore = inject(XtreamStore);
    route = inject(ActivatedRoute);

    ngOnInit(): void {
        const { categoryId } = this.route.snapshot.params;
        this.xtreamStore.setSelectedCategory(Number(categoryId));
    }

    isSelected(item: XtreamCategory): boolean {
        const selectedCategory = this.xtreamStore.selectedCategoryId();
        const itemId = Number((item as any).category_id || item.id);
        return selectedCategory !== null && selectedCategory === itemId;
    }
}
