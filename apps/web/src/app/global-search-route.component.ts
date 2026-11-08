import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { selectAllPlaylistsMeta } from '@iptvnator/m3u-state';
import {
    buildStalkerDetailNavigationTarget,
    buildStalkerStateItem,
    queryParamSignal,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { ParentalLockService } from '@iptvnator/services';
import {
    GLOBAL_SEARCH_MIN_LENGTH,
    isStalkerAccountPlaylist,
} from '@iptvnator/shared/interfaces';
import {
    type StalkerGlobalSearchContext,
    type StalkerGlobalSearchItem,
    StalkerGlobalSearchService,
} from './stalker-global-search.service';
import {
    type AdditionalGlobalSearchResult,
    SearchResultsComponent,
} from './xtream-search-results.lazy';

@Component({
    selector: 'app-global-search-results',
    imports: [
        MatButtonModule,
        RouterLink,
        SearchResultsComponent,
        TranslatePipe,
    ],
    providers: [XtreamStore, StalkerGlobalSearchService],
    templateUrl: './global-search-route.component.html',
    styleUrl: './global-search-route.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GlobalSearchRouteComponent {
    private readonly preview = inject(StalkerGlobalSearchService);
    private readonly router = inject(Router);
    private readonly filters = inject(XtreamStore).searchFilters;
    private readonly parentalLock = inject(ParentalLockService);
    private readonly playlists = inject(Store).selectSignal(
        selectAllPlaylistsMeta
    );
    private readonly stalkerSources = computed(() =>
        this.playlists().filter(isStalkerAccountPlaylist)
    );
    readonly term = queryParamSignal(inject(ActivatedRoute), 'q', (term) =>
        (term ?? '').trim()
    );
    private readonly context = computed<StalkerGlobalSearchContext>(() => ({
        term: this.term(),
        movies: this.filters().movie,
        series: this.filters().series,
        sources: this.stalkerSources(),
        lockVersion: this.parentalLock.version(),
    }));
    readonly groups = this.preview.groups;
    readonly searchingPlaylists = computed(() =>
        this.groups().some(({ loading }) => loading)
    );
    readonly failedPlaylists = computed(() =>
        this.groups().filter(({ hasError }) => hasError)
    );
    readonly additionalResults = computed<AdditionalGlobalSearchResult[]>(
        () => {
            const results: AdditionalGlobalSearchResult[] = [];
            for (const { playlistId, playlistName, items } of this.groups()) {
                for (const result of items) {
                    const { item } = result;
                    results.push({
                        id: `stalker:${result.key}`,
                        playlist_id: playlistId,
                        playlist_name: playlistName,
                        title: item.o_name || item.name || item.title || '',
                        poster_url: item.screenshot_uri,
                        type: result.displayType,
                        open: () => this.openStalkerItem(result),
                    });
                }
            }
            return results;
        }
    );

    constructor() {
        effect(() => {
            const { term, movies, series, sources } = this.context();
            if (
                term.length >= GLOBAL_SEARCH_MIN_LENGTH &&
                (movies || series) &&
                sources.length
            ) {
                untracked(() => this.preview.search(this.context));
            }
        });
    }

    retryStalker(playlistId: string): void {
        this.preview.retry(playlistId, this.context);
    }

    openStalkerItem(result: StalkerGlobalSearchItem): void {
        if (!this.preview.canOpen(result)) {
            return;
        }
        const { item, id, origin, playlistId } = result;
        const type = origin === 'vod' ? 'movie' : 'series';
        const target = buildStalkerDetailNavigationTarget({
            playlistId,
            type,
            categoryId: item.category_id,
            item: buildStalkerStateItem(
                { ...item, id, is_series: item.is_series ?? undefined },
                {
                    id,
                    title: item.o_name || item.name || item.title || '',
                    type,
                }
            ),
            returnTo: this.router.url,
        });
        void this.router.navigate(target.link, { state: target.state });
    }
}
