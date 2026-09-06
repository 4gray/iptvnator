import { DatePipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { EpgDateNavigationDirection } from '../epg-date';
import {
    EPG_GUIDE_ZOOM_MAX,
    EPG_GUIDE_ZOOM_MIN,
    EPG_GUIDE_ZOOM_STEP,
    EpgGuideDensity,
} from './epg-guide-layout.util';
import { EpgGuideScope } from './epg-guide-source';

/**
 * Guide toolbar: day stepper, "Now", scope menu, "Only with EPG", density,
 * zoom, the channel filter and (when the host supports it) programme search.
 * Purely presentational — every control reports through an output and the
 * guide shell owns the state.
 */
@Component({
    selector: 'app-epg-guide-toolbar',
    imports: [
        DatePipe,
        MatButtonModule,
        MatIconModule,
        MatMenuModule,
        MatTooltipModule,
        TranslatePipe,
    ],
    templateUrl: './epg-guide-toolbar.component.html',
    styleUrl: './epg-guide-toolbar.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EpgGuideToolbarComponent {
    readonly dayMs = input.required<number>();
    readonly isToday = input(false);
    readonly currentLocale = input('en');
    readonly scopes = input<EpgGuideScope[]>([]);
    readonly scopeId = input('');
    readonly onlyWithEpg = input(false);
    readonly coverageLoaded = input(false);
    readonly density = input<EpgGuideDensity>('comfortable');
    readonly zoom = input(EPG_GUIDE_ZOOM_MIN);
    readonly filter = input('');
    readonly searchEnabled = input(false);
    readonly searchQuery = input('');
    readonly shownCount = input(0);
    readonly totalCount = input(0);

    readonly stepDay = output<EpgDateNavigationDirection>();
    readonly jumpNow = output<void>();
    readonly scopeChange = output<string>();
    readonly onlyWithEpgChange = output<boolean>();
    readonly densityChange = output<EpgGuideDensity>();
    readonly zoomChange = output<number>();
    readonly filterChange = output<string>();
    readonly searchQueryChange = output<string>();

    readonly zoomMin = EPG_GUIDE_ZOOM_MIN;
    readonly zoomMax = EPG_GUIDE_ZOOM_MAX;
    readonly zoomStep = EPG_GUIDE_ZOOM_STEP;

    readonly scopeLabel = computed(
        () =>
            this.scopes().find((scope) => scope.id === this.scopeId())?.label ??
            ''
    );
    readonly densityIcon = computed(() =>
        this.density() === 'comfortable' ? 'density_medium' : 'density_small'
    );
    readonly densityLabelKey = computed(() =>
        this.density() === 'comfortable'
            ? 'EPG.GUIDE.DENSITY_COMPACT'
            : 'EPG.GUIDE.DENSITY_COMFORTABLE'
    );

    toggleDensity(): void {
        this.densityChange.emit(
            this.density() === 'comfortable' ? 'compact' : 'comfortable'
        );
    }

    onZoomInput(event: Event): void {
        this.zoomChange.emit((event.target as HTMLInputElement).valueAsNumber);
    }

    onFilterInput(event: Event): void {
        this.filterChange.emit((event.target as HTMLInputElement).value);
    }

    onSearchInput(event: Event): void {
        this.searchQueryChange.emit((event.target as HTMLInputElement).value);
    }

    /**
     * The guide's keyboard controller ignores keys typed into inputs, so Esc
     * is handled here: it first clears a non-empty field, and only blurs an
     * already-empty one so the next Esc reaches the guide and closes it.
     */
    onFilterEscape(event: Event): void {
        this.onEscape(event, this.filter(), (value) =>
            this.filterChange.emit(value)
        );
    }

    onSearchEscape(event: Event): void {
        this.onEscape(event, this.searchQuery(), (value) =>
            this.searchQueryChange.emit(value)
        );
    }

    private onEscape(
        event: Event,
        value: string,
        clear: (value: string) => void
    ): void {
        if (value.length > 0) {
            event.stopPropagation();
            clear('');
            return;
        }
        (event.target as HTMLElement | null)?.blur();
    }
}
