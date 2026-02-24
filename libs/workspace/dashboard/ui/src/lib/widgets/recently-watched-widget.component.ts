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

const RECENTLY_WATCHED_KIND_STORAGE_KEY =
    'workspace-dashboard-recently-watched-kind';
const RECENTLY_WATCHED_VIEW_MODE_STORAGE_KEY =
    'workspace-dashboard-recently-watched-view-mode';
type DashboardActivityViewMode = 'list' | 'grid';
const INITIAL_PAGE_SIZE = 20;
const PAGE_SIZE = 20;

@Component({
    selector: 'app-recently-watched-widget',
    imports: [
        MatButtonModule,
        MatButtonToggleModule,
        MatMenuModule,
        MatIcon,
        DashboardActivityItemsComponent,
        DashboardWidgetShellComponent,
    ],
    templateUrl: './recently-watched-widget.component.html',
    styleUrl: './recently-watched-widget.component.scss',
})
export class RecentlyWatchedWidgetComponent {
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
        const items = this.data.globalRecentItems();
        return {
            all: items.length,
            channels: items.filter((item) => item.type === 'live').length,
            vod: items.filter((item) => item.type === 'movie').length,
            series: items.filter((item) => item.type === 'series').length,
        };
    });

    readonly filteredItems = computed(() =>
        this.data
            .globalRecentItems()
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
                id: `${item.id}-${item.playlist_id}-${item.viewed_at}`,
                title: item.title,
                subtitle: `${this.data.getRecentItemProviderLabel(item)} · ${this.data.getRecentItemTypeLabel(item)} · ${this.formatTimestamp(item.viewed_at)}`,
                type: item.type,
                imageUrl: item.poster_url,
                link: this.data.getRecentItemLink(item),
                navigationState: this.data.getRecentItemNavigationState(item),
            }))
    );

    constructor() {
        void this.data.reloadGlobalRecentItems();
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

        const value = localStorage.getItem(RECENTLY_WATCHED_KIND_STORAGE_KEY);
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
        localStorage.setItem(RECENTLY_WATCHED_KIND_STORAGE_KEY, kind);
    }

    private readStoredViewMode(): DashboardActivityViewMode | null {
        if (typeof localStorage === 'undefined') {
            return null;
        }

        const value = localStorage.getItem(
            RECENTLY_WATCHED_VIEW_MODE_STORAGE_KEY
        );
        return value === 'grid' || value === 'list' ? value : null;
    }

    private persistViewMode(viewMode: DashboardActivityViewMode): void {
        if (typeof localStorage === 'undefined') {
            return;
        }

        localStorage.setItem(RECENTLY_WATCHED_VIEW_MODE_STORAGE_KEY, viewMode);
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
