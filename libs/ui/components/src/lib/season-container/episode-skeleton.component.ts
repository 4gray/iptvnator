import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
} from '@angular/core';
import { EpisodeItemLayout } from './episode-item.component';

/** Rows shown while the provider has not said how many episodes there are. */
const DEFAULT_SKELETON_ROWS = 6;

/**
 * Loading placeholders for the season container's episodes, at the exact
 * geometry of the full-density rows (or grid cards) they precede, so the
 * real items swap in without moving anything: a 168×94 thumbnail, a 90px
 * title and 110px meta line, two description lines. No hover state, no
 * actions (the slot is reserved, and at phone width it is the row the
 * real actions take under the text). Bare mode is never anticipated — it
 * is decided once the data is final.
 */
@Component({
    selector: 'app-episode-skeleton',
    template: `
        @for (row of rows(); track row) {
            <div
                class="episode-skeleton"
                [class.episode-skeleton--card]="layout() === 'grid'"
                data-testid="episode-skeleton"
            >
                @if (layout() === 'list') {
                    <span class="episode-skeleton__number"></span>
                }
                <span class="episode-skeleton__thumb"></span>
                <span class="episode-skeleton__text">
                    <span class="episode-skeleton__title-row">
                        <span class="episode-skeleton__title"></span>
                        <span class="episode-skeleton__meta"></span>
                    </span>
                    <span class="episode-skeleton__line"></span>
                    <span
                        class="episode-skeleton__line episode-skeleton__line--short"
                    ></span>
                </span>
                @if (layout() === 'list') {
                    <span class="episode-skeleton__actions"></span>
                }
            </div>
        }
    `,
    styleUrl: './episode-skeleton.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        'aria-hidden': 'true',
        '[class.episodes-list]': "layout() === 'list'",
        '[class.episodes-grid]': "layout() === 'grid'",
    },
})
export class EpisodeSkeletonComponent {
    readonly layout = input<EpisodeItemLayout>('list');
    /** Episode count when known (TMDB pending), else a default screenful. */
    readonly count = input<number | null>(null);

    readonly rows = computed(() =>
        Array.from(
            { length: this.count() || DEFAULT_SKELETON_ROWS },
            (_, index) => index
        )
    );
}
