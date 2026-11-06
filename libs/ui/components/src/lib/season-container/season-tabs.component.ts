import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    computed,
    input,
    output,
    viewChildren,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { TranslateModule } from '@ngx-translate/core';
import {
    MenuItemRadioCheckDirective,
    MenuItemRadioDirective,
} from '../menu-item-radio/menu-item-radio.directive';

/** Up to this many seasons the picker is a row of chips, beyond it a menu. */
const MAX_SEASON_CHIPS = 4;
let nextSeasonTabsId = 0;

/** A season whose episodes are not in yet: `loading` now, `unloaded` until asked. */
export type SeasonCountLoadState = 'loading' | 'unloaded';

/**
 * Season selector for the season container: a chip row ("Season 1 · 2 · 3")
 * for up to 4 seasons, a menu button beyond that, and a "back to playing
 * episode" chip when the currently playing episode belongs to a different
 * season. The threshold is the season count, not the available width.
 *
 * Neither form shows a season poster: the chips are a compact tab strip and
 * the menu rows carry "N episodes · M watched" instead, which tells a long
 * run of "Season 7 … Season 14" apart better than a column of near-identical
 * thumbnails.
 */
@Component({
    selector: 'app-season-tabs',
    templateUrl: './season-tabs.component.html',
    styleUrls: ['./season-tabs.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        MatButtonModule,
        MatIcon,
        MatMenuModule,
        MenuItemRadioCheckDirective,
        MenuItemRadioDirective,
        TranslateModule,
    ],
})
export class SeasonTabsComponent {
    readonly panelId = `season-panel-${nextSeasonTabsId++}`;
    private readonly tabs = viewChildren<ElementRef<HTMLButtonElement>>('tab');
    readonly tabStop = computed(() =>
        this.seasonKeys().includes(this.selectedSeason() ?? '')
            ? this.selectedSeason()
            : this.seasonKeys()[0]
    );
    readonly selectedTabId = computed(() =>
        this.useDropdown() || !this.tabStop()
            ? null
            : this.tabId(this.tabStop() ?? '')
    );
    /** Season keys, already sorted in display order. */
    // The owning panel queries its labels before Angular binds this child's inputs.
    readonly seasonKeys = input<string[]>([]);
    readonly selectedSeason = input<string | undefined>(undefined);
    readonly episodeCounts = input<Record<string, number>>({});
    readonly watchedCounts = input<Record<string, number>>({});
    /**
     * Seasons whose episode list is still a portal request away (lazy
     * Stalker VOD): their count is unknown, not zero, so the menu row shows
     * none until the portal answers.
     */
    readonly seasonLoadStates = input<Readonly<
        Record<string, SeasonCountLoadState>
    > | null>(null);
    /** Season key of the episode currently playing inline, if any. */
    readonly playingSeasonKey = input<string | null>(null);

    readonly seasonSelected = output<string>();
    readonly backToPlayingRequested = output<void>();

    readonly useDropdown = computed(
        () => this.seasonKeys().length > MAX_SEASON_CHIPS
    );

    readonly showBackToPlaying = computed(() => {
        const playing = this.playingSeasonKey();
        return playing !== null && playing !== this.selectedSeason();
    });

    /** False while the season's episode list is still on its way. */
    isCountKnown(seasonKey: string): boolean {
        return !this.seasonLoadStates()?.[seasonKey];
    }

    isSeasonCompleted(seasonKey: string): boolean {
        const total = this.episodeCounts()[seasonKey] ?? 0;
        return total > 0 && (this.watchedCounts()[seasonKey] ?? 0) >= total;
    }

    selectSeason(seasonKey: string): void {
        if (seasonKey !== this.selectedSeason()) {
            this.seasonSelected.emit(seasonKey);
        }
    }

    tabId(key: string): string {
        return `${this.panelId}-tab-${key}`;
    }

    onTabKeydown(event: KeyboardEvent, key: string): void {
        if (
            event.defaultPrevented ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey
        )
            return;
        const keys = this.seasonKeys();
        const index = keys.indexOf(key);
        const rtl =
            getComputedStyle(event.currentTarget as HTMLElement).direction ===
            'rtl';
        let next: number;
        switch (event.key) {
            case 'ArrowRight':
                next = index + (rtl ? -1 : 1);
                break;
            case 'ArrowLeft':
                next = index + (rtl ? 1 : -1);
                break;
            case 'Home':
                next = 0;
                break;
            case 'End':
                next = keys.length - 1;
                break;
            default:
                return;
        }
        event.preventDefault();
        event.stopPropagation();
        next = (next + keys.length) % keys.length;
        const tabs = this.tabs();
        // A fast Tab must see the new stop before Angular renders the selection.
        tabs.forEach((tab, index) => {
            tab.nativeElement.tabIndex = index === next ? 0 : -1;
        });
        if (next !== index) this.seasonSelected.emit(keys[next]);
        tabs[next]?.nativeElement.focus();
    }
}
