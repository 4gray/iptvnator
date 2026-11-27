import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { Params, RouterLink } from '@angular/router';
import { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import {
    foldSearchText,
    isStalkerSeriesItem,
} from '@iptvnator/shared/interfaces';
import { SPINNER_DIAMETERS, StateViewComponent } from '@iptvnator/ui/state';
import { TranslatePipe } from '@ngx-translate/core';
import { ContentCardComponent } from '../content-card/content-card.component';
import { ContentRailShellComponent } from '../content-rail-shell/content-rail-shell.component';

@Component({
    selector: 'app-watched-history',
    templateUrl: './watched-history.component.html',
    styleUrl: './watched-history.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        ContentCardComponent,
        ContentRailShellComponent,
        MatButton,
        MatProgressSpinner,
        RouterLink,
        StateViewComponent,
        TranslatePipe,
    ],
})
export class WatchedHistoryComponent {
    readonly expanded = input(false);
    readonly items = input.required<readonly UnifiedCollectionItem[]>();
    readonly searchTerm = input('');
    readonly loading = input(false);
    readonly hasMore = input(false);
    readonly scopeLabel = input('');
    readonly seeAllQueryParams = input<Params | null>(null);

    readonly itemSelected = output<UnifiedCollectionItem>();
    readonly seeAllActivated = output<void>();
    readonly loadMoreRequested = output<void>();

    protected readonly historyLink = ['/workspace', 'global-recent'];
    protected readonly spinnerDiameter = SPINNER_DIAMETERS.md;
    protected readonly normalizedSearch = computed(() =>
        foldSearchText(this.searchTerm().trim())
    );
    protected readonly gridItems = computed(() => {
        const term = this.normalizedSearch();
        const items = this.items();
        return term
            ? items.filter((item) => foldSearchText(item.name).includes(term))
            : items;
    });

    protected displayType(
        item: UnifiedCollectionItem
    ): UnifiedCollectionItem['contentType'] {
        return item.sourceType === 'stalker' &&
            item.contentType === 'movie' &&
            isStalkerSeriesItem(
                item.stalkerItem as Parameters<typeof isStalkerSeriesItem>[0]
            )
            ? 'series'
            : item.contentType;
    }

    protected onSeeAll(event: MouseEvent): void {
        if (
            event.button === 0 &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.shiftKey &&
            !event.altKey
        ) {
            this.seeAllActivated.emit();
        }
    }
}
