import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIcon } from '@angular/material/icon';
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
    readonly viewToggleVisible = input.required<boolean>();
    readonly viewMode = input.required<EpisodeViewMode>();

    readonly downloadSeason = output<void>();
    readonly viewModeChange = output<EpisodeViewMode>();
}
