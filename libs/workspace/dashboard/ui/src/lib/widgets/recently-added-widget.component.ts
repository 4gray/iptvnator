import {
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
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { startWith } from 'rxjs';
import {
    DashboardDataService,
    DashboardRecentlyAddedFilterKind,
    DashboardRecentlyAddedItem,
    DashboardWidgetConfig,
} from 'workspace-dashboard-data-access';
import {
    DashboardActivityItemViewModel,
    DashboardActivityItemsComponent,
} from './dashboard-activity-items.component';
import { DashboardWidgetShellComponent } from './dashboard-widget-shell.component';

const RECENTLY_ADDED_KIND_STORAGE_KEY =
    'workspace-dashboard-recently-added-kind';
const RECENTLY_ADDED_VIEW_MODE_STORAGE_KEY =
    'workspace-dashboard-recently-added-view-mode';
type DashboardActivityViewMode = 'list' | 'grid';
const QUERY_LIMIT = 200;
const DISPLAY_LIMIT = 25;

@Component({
    selector: 'app-recently-added-widget',
    imports: [
        MatButtonModule,
        MatButtonToggleModule,
        MatMenuModule,
        MatIcon,
        MatTooltipModule,
        DashboardActivityItemsComponent,
        DashboardWidgetShellComponent,
        TranslatePipe,
    ],
    templateUrl: './recently-added-widget.component.html',
    styleUrl: './recently-added-widget.component.scss',
})
export class RecentlyAddedWidgetComponent implements OnInit {
    readonly widget = input.required<DashboardWidgetConfig>();
    readonly data = inject(DashboardDataService);
    private readonly translate = inject(TranslateService);
    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );

    readonly selectedKind = signal<DashboardRecentlyAddedFilterKind>(
        this.readStoredKind() ?? 'all'
    );
    readonly viewMode = signal<DashboardActivityViewMode>(
        this.readStoredViewMode() ?? 'list'
    );
    readonly items = signal<DashboardRecentlyAddedItem[]>([]);
    readonly loading = signal(true);
    readonly loadFailed = signal(false);

    readonly activityItems = computed<DashboardActivityItemViewModel[]>(() =>
        this.items()
            .slice(0, DISPLAY_LIMIT)
            .map((item) => ({
                id: `${item.id}-${item.playlist_id}-${item.added_at}`,
                title: item.title,
                subtitle: `${this.data.getRecentlyAddedItemProviderLabel(item)} · ${this.data.getRecentlyAddedItemTypeLabel(item)} · ${this.formatTimestamp(item.added_at)}`,
                type: item.type,
                imageUrl: item.poster_url,
                link: this.data.getRecentlyAddedLink(item),
                navigationState:
                    this.data.getRecentlyAddedNavigationState(item),
            }))
    );

    ngOnInit(): void {
        void this.reloadItems();
    }

    onKindChange(kind: DashboardRecentlyAddedFilterKind): void {
        this.selectedKind.set(kind);
        this.persistKind(kind);
        void this.reloadItems();
    }

    onViewModeChange(value: unknown): void {
        if (value === 'grid' || value === 'list') {
            this.viewMode.set(value);
            this.persistViewMode(value);
        }
    }

    async reloadItems(): Promise<void> {
        this.loading.set(true);
        this.loadFailed.set(false);

        try {
            const items = await this.data.getGlobalRecentlyAddedItems(
                this.selectedKind(),
                QUERY_LIMIT
            );
            this.items.set(items);
        } catch (error) {
            console.warn(
                '[RecentlyAddedWidget] Failed to load recently added items',
                error
            );
            this.items.set([]);
            this.loadFailed.set(true);
        } finally {
            this.loading.set(false);
        }
    }

    private readStoredKind(): DashboardRecentlyAddedFilterKind | null {
        if (typeof localStorage === 'undefined') {
            return null;
        }

        const value = localStorage.getItem(RECENTLY_ADDED_KIND_STORAGE_KEY);
        return value === 'vod' || value === 'series' || value === 'all'
            ? value
            : null;
    }

    private persistKind(kind: DashboardRecentlyAddedFilterKind): void {
        if (typeof localStorage === 'undefined') {
            return;
        }

        localStorage.setItem(RECENTLY_ADDED_KIND_STORAGE_KEY, kind);
    }

    private readStoredViewMode(): DashboardActivityViewMode | null {
        if (typeof localStorage === 'undefined') {
            return null;
        }

        const value = localStorage.getItem(
            RECENTLY_ADDED_VIEW_MODE_STORAGE_KEY
        );
        return value === 'grid' || value === 'list' ? value : null;
    }

    private persistViewMode(viewMode: DashboardActivityViewMode): void {
        if (typeof localStorage === 'undefined') {
            return;
        }

        localStorage.setItem(RECENTLY_ADDED_VIEW_MODE_STORAGE_KEY, viewMode);
    }

    private formatTimestamp(value?: string | number): string {
        this.languageTick();

        const timestamp = this.data.formatTimestamp(value);
        return timestamp ===
            this.translate.instant('WORKSPACE.DASHBOARD.NOT_YET_SYNCED')
            ? this.translate.instant('WORKSPACE.DASHBOARD.RECENTLY')
            : timestamp;
    }
}
