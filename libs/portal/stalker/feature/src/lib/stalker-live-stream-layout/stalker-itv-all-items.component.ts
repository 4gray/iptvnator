import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    ElementRef,
    input,
    inject,
    linkedSignal,
    output,
    signal,
    viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';
import {
    GridListComponent,
    InfiniteScrollDirective,
    PlaylistErrorViewComponent,
} from '@iptvnator/portal/shared/ui';
import {
    StalkerItvChannel,
    StalkerItvLoadProgress,
} from '@iptvnator/portal/stalker/data-access';
import { EpgProgram, foldSearchText } from '@iptvnator/shared/interfaces';
import {
    ChannelListItemComponent,
    ChannelListSkeletonComponent,
} from '@iptvnator/ui/components';
import { SettingsStore } from '@iptvnator/services';

/** Initial render window and per-`loadMore` growth over the cached list. */
const RENDER_CHUNK = 50;
const VIEW_MODE_KEY = 'stalker-itv-overview-view';
const VIEW_MODE = { grid: 'grid', list: 'list' } as const;
type ViewMode = (typeof VIEW_MODE)[keyof typeof VIEW_MODE];

function restoreViewMode(): ViewMode {
    try {
        return localStorage.getItem(VIEW_MODE_KEY) === VIEW_MODE.list
            ? VIEW_MODE.list
            : VIEW_MODE.grid;
    } catch {
        return VIEW_MODE.grid;
    }
}

/**
 * "All channels" grid shown in the Live TV main area before a category is
 * selected — mirrors the Xtream live "All Items" view. Fed by the full ITV
 * channel list cache; the render window is purely client-side so growing it
 * never touches the store's legacy page state (which would re-fire portal
 * requests).
 */
@Component({
    selector: 'app-stalker-itv-all-items',
    imports: [
        GridListComponent,
        InfiniteScrollDirective,
        MatProgressSpinnerModule,
        TranslatePipe,
        MatButtonModule,
        MatButtonToggleModule,
        MatIcon,
        MatTooltip,
        ChannelListItemComponent,
        ChannelListSkeletonComponent,
        PlaylistErrorViewComponent,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './stalker-itv-all-items.component.html',
    styleUrl: './stalker-itv-all-items.component.scss',
})
export class StalkerItvAllItemsComponent {
    protected readonly settingsStore = inject(SettingsStore);
    readonly channels = input<StalkerItvChannel[]>([]);
    readonly loading = input(false);
    readonly progress = input<StalkerItvLoadProgress | null>(null);
    readonly searchTerm = input('');
    readonly sidebarCollapsed = input(false);
    readonly showEpg = input(false);
    readonly epgLoading = input(false);
    readonly epgPrograms = input<ReadonlyMap<string | number, EpgProgram>>(
        new Map()
    );
    readonly epgProgress = input<ReadonlyMap<string | number, number>>(
        new Map()
    );

    readonly channelActivated = output<StalkerItvChannel>();
    readonly restorePanels = output<void>();
    readonly visibleChannelsChanged = output<StalkerItvChannel[]>();
    readonly previewRefreshRequested = output<void>();
    readonly viewMode = signal<ViewMode>(restoreViewMode());
    readonly restoreButton = viewChild('restoreButton', {
        read: ElementRef<HTMLButtonElement>,
    });
    private readonly scrollContainer =
        viewChild<ElementRef<HTMLElement>>('scrollContainer');

    constructor() {
        effect(() => this.visibleChannelsChanged.emit(this.visibleChannels()));
    }

    setViewMode(mode: string): void {
        if (mode !== VIEW_MODE.grid && mode !== VIEW_MODE.list) return;
        this.viewMode.set(mode);
        try {
            localStorage.setItem(VIEW_MODE_KEY, mode);
        } catch {
            // A display preference remains usable when browser storage is blocked.
        }
        const container = this.scrollContainer()?.nativeElement;
        if (container) container.scrollTop = 0;
    }

    /** Resets to the first chunk whenever the source list or search changes. */
    readonly renderLimit = linkedSignal({
        source: () => ({
            term: this.searchTerm(),
            channelCount: this.channels().length,
        }),
        computation: () => RENDER_CHUNK,
    });

    readonly filteredChannels = computed(() => {
        const term = foldSearchText(this.searchTerm().trim());
        const channels = this.channels();
        if (!term) {
            return channels;
        }

        return channels.filter((channel) =>
            foldSearchText(
                `${channel.o_name ?? ''} ${channel.name ?? ''}`
            ).includes(term)
        );
    });

    readonly hasMoreItems = computed(
        () => this.filteredChannels().length > this.renderLimit()
    );

    readonly visibleChannels = computed(() =>
        this.filteredChannels().slice(0, this.renderLimit())
    );

    /** The visible window, mapped so GridListComponent can resolve the logo. */
    readonly visibleGridItems = computed(() =>
        this.visibleChannels().map((channel) => {
            // GridListItem forbids null is_series; Stalker payloads may
            // carry it — drop the nullish form (same as toPlayableChannel).
            const { is_series, ...rest } = channel;
            return {
                ...rest,
                ...(is_series == null ? {} : { is_series }),
                stream_icon: channel.logo,
                epgProgram: this.epgPrograms().get(String(channel.id)),
                epgProgress: this.epgProgress().get(String(channel.id)) ?? 0,
            };
        })
    );

    loadMore(): void {
        if (!this.hasMoreItems()) {
            return;
        }

        this.renderLimit.update((limit) => limit + RENDER_CHUNK);
    }

    onItemClicked(item: unknown): void {
        if (!item || typeof item !== 'object' || !('id' in item)) return;
        const channel = this.channels().find(
            (channel) => String(channel.id) === String(item.id)
        );
        if (channel) this.channelActivated.emit(channel);
    }

    onChannelClicked(channel: StalkerItvChannel): void {
        if (!this.settingsStore.openStreamOnDoubleClick())
            this.channelActivated.emit(channel);
    }
}
