import {
    Component,
    effect,
    inject,
    input,
    output,
    viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenu, MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { FilterActions, selectActiveTypeFilters } from 'm3u-state';
import { SortBy, SortOrder, SortService } from 'services';

@Component({
    selector: 'app-filter-sort-menu',
    templateUrl: './filter-sort-menu.component.html',
    styleUrls: ['./filter-sort-menu.component.scss'],
    imports: [MatButtonModule, MatIconModule, MatMenuModule, TranslateModule],
})
export class FilterSortMenuComponent {
    private store = inject(Store);
    private sortService = inject(SortService);

    readonly menu = viewChild.required<MatMenu>('filterSortMenu');
    readonly menuTrigger = input<MatMenuTrigger>();
    readonly filterChanged = output<void>();

    playlistTypes = [
        {
            id: 'm3u',
            icon: 'playlist_play',
            translationKey: 'HOME.PLAYLIST_TYPES.M3U',
            checked: true,
        },
        {
            id: 'xtream',
            icon: 'cloud',
            translationKey: 'HOME.PLAYLIST_TYPES.XTREAM',
            checked: true,
        },
        {
            id: 'stalker',
            icon: 'router',
            translationKey: 'HOME.PLAYLIST_TYPES.STALKER',
            checked: true,
        },
    ];

    private readonly selectedTypeFilters = this.store.selectSignal(
        selectActiveTypeFilters
    );

    readonly SortBy = SortBy;
    readonly SortOrder = SortOrder;
    private readonly currentSortOptions = toSignal(
        this.sortService.getSortOptions(),
        {
            requireSync: true,
        }
    );

    constructor() {
        effect(() => {
            if (this.selectedTypeFilters) {
                this.playlistTypes = this.playlistTypes.map((type) => {
                    type.checked = this.selectedTypeFilters().includes(type.id);
                    return type;
                });
            }
        });
    }

    togglePlaylistType(type: {
        id: string;
        icon: string;
        translationKey: string;
        checked: boolean;
    }) {
        const currentlySelectedCount = this.playlistTypes.filter(
            (f) => f.checked
        ).length;

        // Prevent deselecting if it's the last selected option
        if (type.checked && currentlySelectedCount === 1) {
            return;
        }

        type.checked = !type.checked;
        this.store.dispatch(
            FilterActions.setSelectedFilters({
                selectedFilters: this.playlistTypes
                    .filter((f) => f.checked)
                    .map((f) => f.id),
            })
        );
        this.filterChanged.emit();
    }

    setSortOptions(by: SortBy, order: SortOrder): void {
        this.sortService.setSortOptions({ by, order });
    }

    isSortActive(by: SortBy, order: SortOrder): boolean {
        const options = this.currentSortOptions();
        return options?.by === by && options?.order === order;
    }

    get activeFiltersCount(): number {
        return this.playlistTypes.filter((type) => !type.checked).length;
    }

    closeMenu(): void {
        this.menuTrigger()?.closeMenu();
    }
}
