import {
    ChangeDetectionStrategy,
    Component,
    NgZone,
    OnDestroy,
    OnInit,
    computed,
    inject,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { EpgItemDescriptionComponent } from 'components';
import { DashboardWidgetShellComponent } from './dashboard-widget-shell.component';

export interface NowPlayingItem {
    channel_id: string;
    title: string;
    description: string | null;
    category: string | null;
    start: string;
    stop: string;
    channel_name: string | null;
    channel_icon: string | null;
}

/** NowPlayingItem enriched with pre-computed display values */
export interface NowPlayingItemView extends NowPlayingItem {
    progressPercent: number;
    minutesLeft: number;
    initial: string;
}

export type OnAirCategoryKey = 'all' | 'sports' | 'news' | 'movies' | 'kids';

@Component({
    selector: 'app-on-air-widget',
    imports: [
        MatButtonModule,
        MatButtonToggleModule,
        MatIcon,
        MatTooltip,
        RouterLink,
        DashboardWidgetShellComponent,
        TranslatePipe,
    ],
    templateUrl: './on-air-widget.component.html',
    styleUrl: './on-air-widget.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OnAirWidgetComponent implements OnInit, OnDestroy {
    private readonly zone = inject(NgZone);
    private readonly dialog = inject(MatDialog);

    readonly items = signal<NowPlayingItemView[]>([]);
    readonly isLoading = signal(true);
    readonly selectedCategory = signal<OnAirCategoryKey>('all');

    readonly categoryKeys: OnAirCategoryKey[] = [
        'all',
        'sports',
        'news',
        'movies',
        'kids',
    ];

    private readonly categoryKeywords: Record<OnAirCategoryKey, string[]> = {
        all: [],
        sports: [
            'sport',
            'football',
            'soccer',
            'basketball',
            'tennis',
            'f1',
            'cricket',
            'rugby',
        ],
        news: ['news', 'nachrichten', 'info', 'actualité', 'noticias', 'haber'],
        movies: ['movie', 'film', 'cinema', 'kino', 'cine', 'films'],
        kids: [
            'kids',
            'children',
            'child',
            'cartoon',
            'animation',
            'junior',
            'enfants',
        ],
    };

    readonly filtered = computed<NowPlayingItemView[]>(() => {
        const cat = this.selectedCategory();
        if (cat === 'all') return this.items();
        const keywords = this.categoryKeywords[cat];
        return this.items().filter((item) =>
            keywords.some((kw) =>
                (item.category ?? '').toLowerCase().includes(kw)
            )
        );
    });

    private refreshTimer: ReturnType<typeof setTimeout> | null = null;

    ngOnInit(): void {
        void this.loadItems();
        // Run timer outside Angular Zone — prevents zone-triggered CD on every tick.
        // Signal updates inside loadItems() propagate to the view via Angular's
        // signal reactivity without needing zone.run().
        this.zone.runOutsideAngular(() => {
            this.refreshTimer = setInterval(
                () => void this.loadItems(),
                60_000
            );
        });
    }

    ngOnDestroy(): void {
        if (this.refreshTimer !== null) {
            clearInterval(this.refreshTimer);
        }
    }

    setCategory(cat: OnAirCategoryKey): void {
        this.selectedCategory.set(cat);
    }

    categoryTranslationKey(cat: OnAirCategoryKey): string {
        return `WORKSPACE.DASHBOARD.ON_AIR_CAT_${cat.toUpperCase()}`;
    }

    openInfo(item: NowPlayingItemView): void {
        this.dialog.open(EpgItemDescriptionComponent, {
            data: {
                channel: item.channel_id,
                channel_name: item.channel_name,
                title: item.title,
                desc: item.description,
                category: item.category,
                start: item.start,
                stop: item.stop,
                episodeNum: null,
                rating: null,
                iconUrl: item.channel_icon ?? null,
            },
            width: '480px',
            maxWidth: '96vw',
        });
    }

    private async loadItems(): Promise<void> {
        if (!window.electron) {
            this.isLoading.set(false);
            return;
        }
        try {
            const data = await window.electron.getNowPlayingPrograms({
                limit: 25,
            });
            const now = Date.now();
            const enriched: NowPlayingItemView[] = (
                data as NowPlayingItem[]
            ).map((item) => {
                const start = new Date(item.start).getTime();
                const stop = new Date(item.stop).getTime();
                const range = stop - start;
                return {
                    ...item,
                    progressPercent:
                        range > 0
                            ? Math.round(
                                  Math.min(
                                      100,
                                      Math.max(0, ((now - start) / range) * 100)
                                  )
                              )
                            : 0,
                    minutesLeft: Math.max(0, Math.round((stop - now) / 60_000)),
                    initial: (item.channel_name ?? item.channel_id ?? '?')
                        .charAt(0)
                        .toUpperCase(),
                };
            });
            this.items.set(enriched);
        } catch {
            this.items.set([]);
        } finally {
            this.isLoading.set(false);
        }
    }
}
