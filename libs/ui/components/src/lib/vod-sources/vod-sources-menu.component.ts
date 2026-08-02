import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
    signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import {
    MatSlideToggle,
    MatSlideToggleChange,
} from '@angular/material/slide-toggle';
import { TranslatePipe } from '@ngx-translate/core';
import {
    playlistDisplayLabel,
    VodSourceDescriptor,
    VodSourceMatchKind,
} from '@iptvnator/shared/interfaces';
import { VodSourceCopyRowComponent } from './vod-source-copy-row.component';
import {
    collectLanguagePrefixes,
    EMPTY_VOD_SOURCE_FILTERS,
    hasActiveVodSourceFilters,
    noChecksRunYet,
    sourceMatchesFilters,
    type VodSourceFilterState,
} from './vod-source-filtering.util';
import { VodSourceRowComponent } from './vod-source-row.component';
import { groupVodSources } from './vod-source-groups.util';

/** Below this many sources, a search box costs more than it saves. */
const FILTER_FROM = 8;

/**
 * Body of the "sources" popover: header, search + filter chips, the source
 * rows, and the auto-failover footer. Rendered inside the chip's anchored
 * menu on the details page and reused as-is by the in-player popover, so it
 * owns no anchoring of its own.
 *
 * Laid out as a flex column whose only scrollable region is the source list —
 * the host caps the popover's height to the space beside its anchor, and the
 * header, search, chips and footer must stay visible while the list scrolls.
 */
@Component({
    selector: 'app-vod-sources-menu',
    templateUrl: './vod-sources-menu.component.html',
    styleUrls: ['./vod-sources-menu.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        FormsModule,
        MatIcon,
        MatSlideToggle,
        TranslatePipe,
        VodSourceCopyRowComponent,
        VodSourceRowComponent,
    ],
})
export class VodSourcesMenuComponent {
    readonly sources = input.required<VodSourceDescriptor[]>();
    /**
     * Movie title for the header. Empty renders the bare "Source" heading used
     * by the in-player variant, where the title is already on screen.
     */
    readonly title = input('');
    readonly matchKind = input<VodSourceMatchKind>('title-year');
    readonly autoFailoverEnabled = input(false);
    /**
     * False on players that never report a playback failure (MPV, VLC,
     * Embedded MPV). The toggle would then promise a switch that can never
     * happen, so it is not offered at all.
     */
    readonly autoFailoverSupported = input(true);
    /**
     * In-player variant: replaces the match kind with e.g.
     * "timecode will be kept · 0:42:18". Already formatted by the host.
     */
    readonly resumeLabel = input<string | null>(null);
    readonly showPin = input(true);
    /** See `VodSourceRowComponent.playbackLive`. */
    readonly playbackLive = input(false);

    readonly playRequested = output<string>();
    readonly pinRequested = output<string>();
    readonly checkRequested = output<string>();
    readonly autoFailoverToggled = output<boolean>();

    /** Search text; only reachable once the list is long enough to need it. */
    readonly filter = signal('');

    /** The chip filters — compose with each other and the search (AND). */
    readonly filters = signal<VodSourceFilterState>(EMPTY_VOD_SOURCE_FILTERS);

    /**
     * Progressive disclosure: a search box for four sources is chrome nobody
     * asked for, but scanning eleven by eye is worse.
     */
    readonly showFilter = computed(() => this.sources().length > FILTER_FROM);

    readonly totalCount = computed(() => this.sources().length);

    /** Options for the language select — only prefixes actually present. */
    readonly languages = computed(() =>
        collectLanguagePrefixes(this.sources())
    );

    readonly filtersActive = computed(() =>
        hasActiveVodSourceFilters(this.filters())
    );

    /** Sources surviving the search box; what "check all" acts on. */
    private readonly searchedSources = computed(() => {
        const query = this.filter().trim().toLowerCase();
        const sources = this.sources();
        if (!query || !this.showFilter()) {
            return sources;
        }

        return sources.filter((source) =>
            playlistDisplayLabel(source.playlistName, source.playlistId)
                .toLowerCase()
                .includes(query)
        );
    });

    /** Sources surviving search AND chip filters — what the list shows. */
    readonly visibleSources = computed(() => {
        const filters = this.filters();
        return this.searchedSources().filter((source) =>
            sourceMatchesFilters(source, filters)
        );
    });

    readonly visibleCount = computed(() => this.visibleSources().length);

    /** "X of N", shown only once something actually reduced the list. */
    readonly showReducedCount = computed(
        () => this.visibleCount() !== this.totalCount()
    );

    /**
     * Sources collapsed per playlist. One playlist often lists the same film
     * several times; flat they are indistinguishable rows.
     */
    readonly groups = computed(() => groupVodSources(this.visibleSources()));

    private readonly expanded = signal<ReadonlySet<string>>(new Set());

    isExpanded(key: string): boolean {
        return this.expanded().has(key);
    }

    toggleGroup(key: string): void {
        this.expanded.update((keys) => {
            const next = new Set(keys);
            if (!next.delete(key)) {
                next.add(key);
            }
            return next;
        });
    }

    /** Anything still worth probing — drives the "check all" affordance. */
    readonly uncheckedCount = computed(
        () =>
            this.searchedSources().filter(
                (source) =>
                    source.probe.status === 'idle' ||
                    source.probe.status === 'unknown'
            ).length
    );

    readonly matchKindLabelKey = computed(() =>
        this.matchKind() === 'tmdb'
            ? 'PORTALS.MULTI_SOURCE.MATCHED_BY_TMDB'
            : 'PORTALS.MULTI_SOURCE.MATCHED_BY_TITLE'
    );

    clearFilters(): void {
        this.filters.set(EMPTY_VOD_SOURCE_FILTERS);
    }

    /**
     * Checks are lazy, so "show me what is available" would filter against
     * nothing the first time. Turning the filter on with no verdicts anywhere
     * therefore runs check-all itself — the question implies it.
     */
    toggleAvailableFilter(): void {
        const next = !this.filters().availableOnly;
        this.filters.update((filters) => ({ ...filters, availableOnly: next }));
        if (next && noChecksRunYet(this.sources())) {
            this.checkAllVisible();
        }
    }

    toggleHdFilter(): void {
        this.filters.update((filters) => ({
            ...filters,
            hdOnly: !filters.hdOnly,
        }));
    }

    setLanguageFilter(language: string | null): void {
        this.filters.update((filters) => ({ ...filters, language }));
    }

    onAutoFailoverChange(event: MatSlideToggleChange): void {
        this.autoFailoverToggled.emit(event.checked);
    }

    /**
     * Checking eleven sources one row at a time is busywork the app can do
     * itself; the host caps how many probes actually run at once.
     *
     * Based on the SEARCHED list, not the chip-filtered one: the "Available"
     * chip calls this precisely when its own filter would hide everything.
     */
    checkAllVisible(): void {
        for (const source of this.searchedSources()) {
            if (
                source.probe.status === 'idle' ||
                source.probe.status === 'unknown'
            ) {
                this.checkRequested.emit(source.id);
            }
        }
    }
}
