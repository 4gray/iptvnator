import { DatePipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { EpgListRow } from '../epg-list-view.utils';

/**
 * One programme row in the vertical EPG list. Dumb/presentational: it renders
 * the precomputed `EpgListRow` and emits semantic intents; the list component
 * owns activation policy (live vs timeshift vs open-details). Mirrors the
 * mockup's `.g-row[data-when]` template.
 */
@Component({
    selector: 'app-epg-list-view-row',
    templateUrl: './epg-list-view-row.component.html',
    styleUrl: './epg-list-view-row.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DatePipe, MatIcon, TranslatePipe],
    host: {
        class: 'g-row',
        role: 'button',
        tabindex: '0',
        '[attr.data-when]': 'row().when',
        '[class.sel]': 'selected()',
        '[class.playing]': 'isPlaying()',
        '(click)': 'onRowClick()',
        '(keydown.enter)': 'onKeydown($event)',
        '(keydown.space)': 'onKeydown($event)',
    },
})
export class EpgListViewRowComponent {
    readonly row = input.required<EpgListRow>();
    readonly selected = input(false);
    readonly currentLocale = input('en');
    /** Current wall-clock ms from the list's 30s tick (drives minutes-left). */
    readonly nowMs = input(0);

    readonly activate = output<void>();
    readonly watch = output<void>();
    readonly info = output<void>();

    /** Archive-playback highlight: the active programme is a past one. */
    readonly isPlaying = computed(() => {
        const row = this.row();
        return row.isActive && row.when === 'past';
    });

    /** Minutes remaining on the on-air programme (for the `now` row tag). */
    readonly minutesLeft = computed(() => {
        const row = this.row();
        if (row.when !== 'now') {
            return null;
        }
        return Math.max(0, Math.round((row.stopMs - this.nowMs()) / 60_000));
    });

    onRowClick(): void {
        this.activate.emit();
    }

    /**
     * Keyboard Enter/Space activates the row only when the event target is the
     * row itself — keydown from the nested watch/info buttons bubbles up here,
     * and hijacking it would swap the button's action for row activation (the
     * `preventDefault()` would also suppress the button's native click).
     */
    onKeydown(event: Event): void {
        if (event.target !== event.currentTarget) {
            return;
        }
        event.preventDefault();
        this.activate.emit();
    }

    onWatch(event: Event): void {
        event.stopPropagation();
        this.watch.emit();
    }

    onInfo(event: Event): void {
        event.stopPropagation();
        this.info.emit();
    }
}
