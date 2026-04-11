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
        MatProgressSpinnerModule,
        MatTooltipModule,
        DashboardActivityItemsComponent,
        DashboardWidgetShellComponent,
        TranslatePipe,
    ],
    templateUrl: './recently-watched-widget.component.html',
    styleUrl: './recently-watched-widget.component.scss',
})
export class RecentlyWatchedWidgetComponent implements OnInit {
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

    constructor() {}

    ngOnInit(): void {
        this.data.reloadGlobalRecentItems().then(() => {
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
            .globalRecentItems()
            .find((i) => `${i.id}-${i.playlist_id}-${i.viewed_at}` === item.id);

        if (globalItem) {
            void this.data.removeGlobalRecentItem(globalItem);
        } else {
            // Fallback strategy if custom ID mapping changed
            const fallbackItem = this.data
                .globalRecentItems()
                .find(
                    (i) =>
                        item.link.includes(String(i.xtream_id)) ||
                        item.link.includes(i.playlist_id)
                );
            if (fallbackItem) {
                void this.data.removeGlobalRecentItem(fallbackItem);
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
