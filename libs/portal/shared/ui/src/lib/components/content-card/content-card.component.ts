import { DatePipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    input,
    linkedSignal,
    output,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { normalizeDateLocale } from '@iptvnator/pipes';
import { TranslateService } from '@ngx-translate/core';
import { startWith } from 'rxjs';
import { CoverTitlesService } from '../../cover-titles/cover-titles.service';

/** Channel-like cards always keep their label: logos rarely identify them. */
const LABELLED_CONTENT_TYPES: ReadonlySet<string> = new Set(['live', 'radio']);

@Component({
    selector: 'app-content-card',
    standalone: true,
    imports: [DatePipe, MatIcon, MatIconButton, MatTooltip],
    templateUrl: './content-card.component.html',
    styleUrl: './content-card.component.scss',
    host: { '[class.content-card--posters-only]': 'postersOnly()' },
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContentCardComponent {
    private readonly translate = inject(TranslateService);
    private readonly coverTitles = inject(CoverTitlesService);
    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );

    /** URL of the poster image */
    readonly posterUrl = input<string>();

    /** Title to display */
    readonly title = input.required<string>();

    /** Content type (live, movie, series) */
    readonly type = input<string>();

    /** Optional date to display (Date, string, or timestamp number) */
    readonly date = input<Date | string | number>();

    /** Whether to show the remove button */
    readonly showRemoveButton = input<boolean>(false);

    /** Tooltip text for the remove button */
    readonly removeTooltip = input<string>('Remove');

    /** Whether to show placeholder when no poster */
    readonly showPlaceholder = input<boolean>(true);

    /** Whether to render the type badge (live/movie/series) on the poster */
    readonly showTypeBadge = input<boolean>(true);

    /**
     * Whether this card may join the posters-only wall
     * (`Settings.showCoverTitles === false`). Hosts whose grids answer by
     * name — search results, "recently added" rails — pass false so their
     * labels stay put regardless of the preference.
     */
    readonly allowPostersOnly = input<boolean>(true);

    /** Emitted when the card is clicked */
    readonly cardClick = output<void>();

    /** Emitted when the remove button is clicked */
    readonly remove = output<void>();
    /** A failed poster URL falls back per card; a new URL gets a fresh try. */
    protected readonly artworkFailed = linkedSignal({
        source: this.posterUrl,
        computation: () => false,
    });
    protected readonly artworkMissing = computed(
        () => !this.posterUrl() || this.artworkFailed()
    );
    protected readonly postersOnly = computed(
        () =>
            this.allowPostersOnly() &&
            this.coverTitles.postersOnly() &&
            !LABELLED_CONTENT_TYPES.has(this.type() ?? '')
    );
    readonly currentLocale = computed(() => {
        this.languageTick();
        return normalizeDateLocale(
            this.translate.currentLang || this.translate.defaultLang
        );
    });

    /** Get the icon for the placeholder based on type */
    getPlaceholderIcon(): string {
        switch (this.type()) {
            case 'live':
                return 'live_tv';
            case 'radio':
                return 'radio';
            case 'series':
                return 'tv';
            default:
                return 'movie';
        }
    }

    onCardClick(): void {
        this.cardClick.emit();
    }

    /**
     * Enter/Space activate the card like a click; Space also prevents the
     * page scroll. The Remove control is a sibling of the activation
     * surface, never a descendant, so its keys cannot reach this handler.
     */
    onCardKey(event: Event): void {
        event.preventDefault();
        this.cardClick.emit();
    }

    onRemoveClick(event: Event): void {
        event.stopPropagation();
        this.remove.emit();
    }

    onImageError(): void {
        this.artworkFailed.set(true);
    }
}
