import { DatePipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    input,
    output,
    signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { normalizeDateLocale } from '@iptvnator/pipes';
import {
    EpgDateNavigationDirection,
    parseEpgDateKey,
} from '@iptvnator/ui/epg/date';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { startWith } from 'rxjs';

export interface LiveEpgPanelSummary {
    readonly title?: string | null;
    readonly start?: string | number | Date | null;
    readonly stop?: string | number | Date | null;
    readonly progress?: number | null;
}

@Component({
    selector: 'app-live-epg-panel',
    imports: [
        DatePipe,
        MatButton,
        MatIcon,
        MatIconButton,
        MatMenuModule,
        MatTooltip,
        TranslatePipe,
    ],
    templateUrl: './live-epg-panel.component.html',
    styleUrl: './live-epg-panel.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveEpgPanelComponent {
    readonly collapsed = input(false);
    readonly summary = input<LiveEpgPanelSummary | null>(null);
    readonly loading = input(false);
    readonly summaryLabelKey = input('EPG.CURRENT_PROGRAM');
    readonly showDateNavigator = input(false);
    readonly selectedDate = input<string | null>(null);
    readonly showReturnToLive = input(false);
    readonly collapsedChange = output<boolean>();
    readonly dateNavigation = output<EpgDateNavigationDirection>();
    readonly returnToLive = output<void>();

    private readonly translate = inject(TranslateService);
    private readonly currentTimeMs = signal(Date.now());
    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );

    readonly hasSummary = computed(() => {
        const title = this.summary()?.title;
        return typeof title === 'string' && title.trim().length > 0;
    });

    readonly hasTimeRange = computed(() => {
        const summary = this.summary();
        return !!summary?.start || !!summary?.stop;
    });

    readonly progress = computed(() => {
        const summary = this.summary();
        if (!summary) {
            return null;
        }

        const explicitProgress = Number(summary.progress);
        if (Number.isFinite(explicitProgress)) {
            return clampProgress(explicitProgress);
        }

        const startMs = toTimeMs(summary.start);
        const stopMs = toTimeMs(summary.stop);
        if (startMs === null || stopMs === null || stopMs <= startMs) {
            return null;
        }

        const elapsed = this.currentTimeMs() - startMs;
        return clampProgress((elapsed / (stopMs - startMs)) * 100);
    });
    readonly selectedDateValue = computed(() =>
        parseEpgDateKey(this.selectedDate())
    );
    readonly currentLocale = computed(() => {
        this.languageTick();
        return normalizeDateLocale(
            this.translate.currentLang || this.translate.defaultLang
        );
    });

    constructor() {
        effect((onCleanup) => {
            const intervalId = window.setInterval(() => {
                this.currentTimeMs.set(Date.now());
            }, 30_000);

            onCleanup(() => clearInterval(intervalId));
        });
    }

    toggleCollapsed(): void {
        this.collapsedChange.emit(!this.collapsed());
    }

    navigateDate(direction: EpgDateNavigationDirection): void {
        this.dateNavigation.emit(direction);
    }
}

function toTimeMs(
    value: string | number | Date | null | undefined
): number | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const parsed =
        value instanceof Date
            ? value.getTime()
            : typeof value === 'number'
              ? value
              : Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function clampProgress(value: number): number {
    return Math.min(100, Math.max(0, value));
}
