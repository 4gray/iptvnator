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
import { VodSourceRowComponent } from './vod-source-row.component';
import {
    groupVodSources,
    variantLabel,
    type VodSourceGroup,
} from './vod-source-groups.util';

/** Below this many sources, a filter box costs more than it saves. */
const FILTER_FROM = 8;

/**
 * Body of the "sources" popover: header, the source rows, and the auto-failover
 * footer. Rendered inside the chip's anchored menu on the details page and
 * reused as-is by the in-player popover and the playback error screen, so it
 * owns no anchoring of its own.
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
     * In-player variant: replaces the match kind with e.g.
     * "timecode will be kept · 0:42:18". Already formatted by the host.
     */
    readonly resumeLabel = input<string | null>(null);
    readonly showPin = input(true);

    readonly playRequested = output<string>();
    readonly pinRequested = output<string>();
    readonly checkRequested = output<string>();
    readonly autoFailoverToggled = output<boolean>();

    /** Filter text; only reachable once the list is long enough to need it. */
    readonly filter = signal('');

    /**
     * Progressive disclosure: a search box for four sources is chrome nobody
     * asked for, but scanning eleven by eye is worse.
     */
    readonly showFilter = computed(() => this.sources().length > FILTER_FROM);

    readonly visibleSources = computed(() => {
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

    /** Distinguishes copies within a group — usually the provider's own title. */
    variantLabelFor(group: VodSourceGroup, index: number): string {
        return variantLabel(group.sources[index], group.sources);
    }

    /** Anything still worth probing — drives the "check all" affordance. */
    readonly uncheckedCount = computed(
        () =>
            this.visibleSources().filter(
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

    onAutoFailoverChange(event: MatSlideToggleChange): void {
        this.autoFailoverToggled.emit(event.checked);
    }

    /**
     * Checking eleven sources one row at a time is busywork the app can do
     * itself; the probe service already dedupes and caches.
     */
    checkAllVisible(): void {
        for (const source of this.visibleSources()) {
            if (
                source.probe.status === 'idle' ||
                source.probe.status === 'unknown'
            ) {
                this.checkRequested.emit(source.id);
            }
        }
    }
}
