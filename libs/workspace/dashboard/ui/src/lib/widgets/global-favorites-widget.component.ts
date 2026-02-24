import { Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import {
    DashboardContentKind,
    DashboardDataService,
    DashboardWidgetConfig,
    createDefaultWidgetScope,
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
    imports: [
        MatButtonModule,
        MatButtonToggleModule,
        MatMenuModule,
        MatIcon,
        DashboardActivityItemsComponent,
        DashboardWidgetShellComponent,
    ],
    templateUrl: './global-favorites-widget.component.html',
    styleUrl: './global-favorites-widget.component.scss',
})
export class GlobalFavoritesWidgetComponent {
    readonly widget = input.required<DashboardWidgetConfig>();
    readonly data = inject(DashboardDataService);
    readonly selectedKind = signal<DashboardContentKind>(
        this.readStoredKind() ?? 'all'
    );
    readonly viewMode = signal<DashboardActivityViewMode>(
        this.readStoredViewMode() ?? 'list'
    );
    readonly visibleItemLimit = signal(INITIAL_PAGE_SIZE);
    readonly scope = computed(
        () => this.widget().settings?.scope ?? createDefaultWidgetScope()
    );

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
            .filter((item) =>
                this.data.matchesScope(
                    item.playlist_id,
                    item.source,
                    this.scope()
                )
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

    constructor() {
        void this.data.reloadGlobalFavorites();
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
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return 'Recently';
        }

        return date.toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }
}
