import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    input,
    output,
    signal,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
    getPortalPlaybackProgressPercent,
    isPortalPlaybackInProgress,
    isPortalPlaybackWatched,
} from '@iptvnator/portal/shared/util';
import {
    PlaybackPositionData,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import { episodeTimeLabel, formatEpisodeAirDate } from './episode-meta.util';
import { SeasonDownloadPresenter } from './season-download-presenter';
import { resolveEpisodeInfo } from './season-watch-toggle.util';

export type EpisodeItemLayout = 'list' | 'grid';

/**
 * One episode of the selected season, as a list row or a grid card.
 *
 * The whole item is one stretched button: a click or Enter plays (resuming
 * from the saved position), Tab lands on it and reveals the actions through
 * `:focus-within`. The actions — mark watched, download, "…" — sit in a
 * reserved slot above that button, so showing them never moves the text.
 * Watched episodes carry a check on the thumbnail and muted text, started
 * ones a progress bar and the time left; there is no bar on a watched one.
 */
@Component({
    selector: 'app-episode-item',
    templateUrl: './episode-item.component.html',
    styleUrl: './episode-item.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        MatIcon,
        MatMenuModule,
        MatProgressSpinner,
        MatTooltip,
        TranslatePipe,
    ],
    host: {
        class: 'episode-item',
        '[class.episode-list-item]': "layout() === 'list'",
        '[class.episode-card]': "layout() === 'grid'",
        '[class.episode-item--watched]': 'watched()',
        '[class.episode-item--in-progress]': 'inProgress()',
        '[class.episode-item--current]': 'current()',
        '[class.episode-item--launching]': 'launching()',
        '[class.episode-item--playing]': 'playing()',
        '[attr.data-episode-id]': 'episode().id',
    },
})
export class EpisodeItemComponent {
    private readonly translate = inject(TranslateService);
    readonly downloadPresenter = inject(SeasonDownloadPresenter);

    readonly episode = input.required<XtreamSerieEpisode>();
    readonly layout = input<EpisodeItemLayout>('list');
    readonly position = input<PlaybackPositionData | undefined>(undefined);
    /** Distinct per-episode still available; otherwise a dimmed fallback. */
    readonly showStill = input(true);
    readonly launching = input(false);
    /** Playing inline or in an external player session. */
    readonly playing = input(false);
    /** The "now playing / continue" row of the season. */
    readonly current = input(false);

    readonly played = output<void>();
    readonly restartRequested = output<void>();
    readonly watchedToggled = output<Event>();
    readonly infoRequested = output<Event>();

    readonly info = computed(() => resolveEpisodeInfo(this.episode()));
    readonly watched = computed(() => isPortalPlaybackWatched(this.position()));
    readonly inProgress = computed(() =>
        isPortalPlaybackInProgress(this.position())
    );
    /** Bar only for a started, unfinished episode. */
    readonly progressPercent = computed(() =>
        this.watched() ? 0 : getPortalPlaybackProgressPercent(this.position())
    );
    readonly timeLabel = computed(() =>
        episodeTimeLabel(this.info(), this.position())
    );

    private readonly failedStill = signal<string | null>(null);
    readonly stillUrl = computed(() => {
        const url = this.info()?.movie_image;
        return url && url !== this.failedStill() ? url : null;
    });

    /** Read on every check: follows a language switch with the pipes. */
    airDate(): string {
        return formatEpisodeAirDate(
            this.info()?.releasedate,
            this.translate.currentLang || this.translate.defaultLang
        );
    }

    onStillError(url: string): void {
        this.failedStill.set(url);
    }

    play(): void {
        if (!this.launching()) {
            this.played.emit();
        }
    }
}
