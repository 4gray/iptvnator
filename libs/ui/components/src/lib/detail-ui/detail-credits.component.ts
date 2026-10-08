import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

const LEAD_CAST_LIMIT = 3;

/**
 * Two text lines of credits inside the details hero: "Starring" with the
 * first three names and an "and more" link to the Cast & crew row, then
 * "Director". Nothing renders for an empty list.
 */
@Component({
    selector: 'app-detail-credits',
    imports: [TranslatePipe],
    templateUrl: './detail-credits.component.html',
    styleUrl: './detail-credits.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailCreditsComponent {
    readonly cast = input<readonly string[]>([]);
    readonly directors = input<readonly string[]>([]);

    /** "and more" was activated: the host scrolls to the Cast & crew row. */
    readonly moreRequested = output<void>();

    readonly leadCast = computed(() =>
        this.cast().slice(0, LEAD_CAST_LIMIT).join(', ')
    );
    readonly hasMore = computed(() => this.cast().length > LEAD_CAST_LIMIT);
    readonly directorNames = computed(() => this.directors().join(', '));
}
