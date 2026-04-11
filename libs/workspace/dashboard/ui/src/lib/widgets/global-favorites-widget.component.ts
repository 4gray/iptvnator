import {
    ChangeDetectionStrategy,
    Component,
    OnInit,
    computed,
    inject,
    input,
    signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { formatWithIntl } from '@iptvnator/pipes';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { startWith } from 'rxjs';
import {
    DashboardContentKind,
    DashboardDataService,
    DashboardWidgetConfig,
} from 'workspace-dashboard-data-access';
import {
    DashboardActivityItemViewModel,
    DashboardActivityItemsComponent,
} from './dashboard-activity-items.component';
import { DashboardWidgetShellComponent } from './dashboard-widget-shell.component';

const GLOBAL_FAVORITES_KIND_STORAGE_KEY =
    'workspace-dashboard-global-favorites-kind';
const GLOBAL_FAVORITES_VIEW_MODE_STORAGE_KEY =
    'workspace-dashboard-global-favorites-view-mode';
type DashboardActivityViewMode = 'list' | 'grid';
const INITIAL_PAGE_SIZE = 20;
const PAGE_SIZE = 20;

@Component({
    selector: 'app-global-favorites-widget',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        MatButtonModule,
        MatButtonToggleModule,
        MatMenuModule,
        MatIcon,
        MatProgressSpinnerModule,
        MatTooltipModule,
        DashboardActivityItemsComponent,
        DashboardWidgetShellComponent,
        TranslatePipe,
    ],
    templateUrl: './global-favorites-widget.component.html',
    styleUrl: './global-favorites-widget.component.scss',
})
export class GlobalFavoritesWidgetComponent implements OnInit {
    readonly widget = input.required<DashboardWidgetConfig>();
    readonly data = inject(DashboardDataService);
    private readonly translate = inject(TranslateService);
    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );
    readonly selectedKind = signal<DashboardContentKind>(
        this.readStoredKind() ?? 'all'
    );
    readonly viewMode = signal<DashboardActivityViewMode>(
        this.readStoredViewMode() ?? 'list'
    );
    readonly visibleItemLimit = signal(INITIAL_PAGE_SIZE);

    readonly counts = computed(() => {
        const items = this.data.globalFavoriteItems();
        return {
            all: items.length,
            channels: items.filter((item) => item.type === 'live').length,
            vod: items.filter((item) => item.type === 'movie').length,
            series: items.filter((item) => item.type === 'series').length,
        };
    });

    readonly filteredItems = computed(() =>
        this.data
            .globalFavoriteItems()
            .filter((item) =>
                this.data.isTypeInKind(item.type, this.selectedKind())
            )
    );

    readonly activityItems = computed<DashboardActivityItemViewModel[]>(() =>
        this.filteredItems()
            .slice(0, this.visibleItemLimit())
            .map((item) => ({
                id: `${item.id}-${item.playlist_id}-${item.added_at}`,
                title: item.title,
                subtitle: `${this.data.getFavoriteItemProviderLabel(item)} · ${this.data.getFavoriteItemTypeLabel(item)} · ${this.formatTimestamp(item.added_at)}`,
                type: item.type,
                imageUrl: item.poster_url,
                link: this.data.getGlobalFavoriteLink(item),
                navigationState:
                    this.data.getGlobalFavoriteNavigationState(item),
            }))
    );

    ngOnInit(): void {
        void this.data.reloadGlobalFavorites().then(() => {
            this.visibleItemLimit.set(INITIAL_PAGE_SIZE);
        });
    }

    onKindChange(kind: DashboardContentKind): void {
        this.setKind(kind);
    }

    onViewModeChange(value: unknown): void {
        if (value === 'list' || value === 'grid') {
            this.viewMode.set(value);
            this.persistViewMode(value);
        }
    }

    onItemsScrolledToEnd(): void {
        if (this.visibleItemLimit() >= this.filteredItems().length) {
            return;
        }

        this.visibleItemLimit.update((value) => value + PAGE_SIZE);
    }

    onRemoveItem(item: DashboardActivityItemViewModel): void {
        const globalItem = this.data
            .globalFavoriteItems()
            .find((i) => `${i.id}-${i.playlist_id}-${i.added_at}` === item.id);

        if (globalItem) {
            void this.data.removeGlobalFavorite(globalItem);
        } else {
            // Fallback strategy
            const fallbackItem = this.data
                .globalFavoriteItems()
                .find(
                    (i) =>
                        item.link.includes(String(i.xtream_id)) ||
                        item.link.includes(i.playlist_id)
                );
            if (fallbackItem) {
                void this.data.removeGlobalFavorite(fallbackItem);
            }
        }
    }

    private setKind(value: unknown): void {
        if (
            value === 'all' ||
            value === 'channels' ||
            value === 'vod' ||
            value === 'series'
        ) {
            this.selectedKind.set(value);
            this.persistKind(value);
            this.visibleItemLimit.set(INITIAL_PAGE_SIZE);
        }
    }

    private readStoredKind(): DashboardContentKind | null {
        if (typeof localStorage === 'undefined') {
            return null;
        }

        const value = localStorage.getItem(GLOBAL_FAVORITES_KIND_STORAGE_KEY);
        if (
            value === 'all' ||
            value === 'channels' ||
            value === 'vod' ||
            value === 'series'
        ) {
            return value;
        }

        return null;
    }

    private persistKind(kind: DashboardContentKind): void {
        if (typeof localStorage === 'undefined') {
            return;
        }
        localStorage.setItem(GLOBAL_FAVORITES_KIND_STORAGE_KEY, kind);
    }

    private readStoredViewMode(): DashboardActivityViewMode | null {
        if (typeof localStorage === 'undefined') {
            return null;
        }

        const value = localStorage.getItem(
            GLOBAL_FAVORITES_VIEW_MODE_STORAGE_KEY
        );
        return value === 'grid' || value === 'list' ? value : null;
    }

    private persistViewMode(viewMode: DashboardActivityViewMode): void {
        if (typeof localStorage === 'undefined') {
            return;
        }

        localStorage.setItem(GLOBAL_FAVORITES_VIEW_MODE_STORAGE_KEY, viewMode);
    }

    private formatTimestamp(value: string): string {
        this.languageTick();

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return this.translate.instant('WORKSPACE.DASHBOARD.RECENTLY');
        }

        return formatWithIntl(date, {
            locale: this.translate.currentLang || this.translate.defaultLang,
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }
}
