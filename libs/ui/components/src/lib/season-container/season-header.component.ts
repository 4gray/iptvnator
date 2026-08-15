import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';

export type EpisodeViewMode = 'grid' | 'list';

@Component({
    selector: 'app-season-header',
    templateUrl: './season-header.component.html',
    styleUrls: ['./season-header.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        MatButtonModule,
        MatButtonToggleModule,
        MatIcon,
        MatMenuModule,
        MatProgressSpinnerModule,
        MatTooltipModule,
        TranslateModule,
    ],
})
export class SeasonHeaderComponent {
    readonly downloadVisible = input.required<boolean>();
    readonly batchRunning = input.required<boolean>();
    readonly seasonDisabled = input.required<boolean>();
    readonly eligibleEpisodeCount = input.required<number>();
    readonly watchToggleVisible = input.required<boolean>();
    readonly watchBatchRunning = input.required<boolean>();
    readonly seasonFullyWatched = input.required<boolean>();
    readonly watchEligibleCount = input.required<number>();
    readonly seriesMenuVisible = input.required<boolean>();
    readonly seriesActionDisabled = input.required<boolean>();
    readonly seriesFullyWatched = input.required<boolean>();
    readonly seriesEligibleCount = input.required<number>();
    /** False while unloaded seasons make the series count a guess. */
    readonly seriesCountKnown = input.required<boolean>();
    readonly viewToggleVisible = input.required<boolean>();
    readonly viewMode = input.required<EpisodeViewMode>();

    readonly downloadSeason = output<void>();
    readonly toggleSeasonWatched = output<void>();
    readonly toggleSeriesWatched = output<void>();
    readonly viewModeChange = output<EpisodeViewMode>();

    seriesActionLabelKey(): string {
        if (this.seriesFullyWatched()) {
            return 'XTREAM.MARK_SERIES_UNWATCHED';
        }
        return this.seriesCountKnown()
            ? 'XTREAM.MARK_SERIES_WATCHED'
            : 'XTREAM.MARK_SERIES_WATCHED_ALL';
    }
}
