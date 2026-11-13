import {
    afterRenderEffect,
    ChangeDetectionStrategy,
    Component,
    computed,
    type ElementRef,
    inject,
    viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import {
    DialogFooterStartDirective,
    DialogShellComponent,
} from '@iptvnator/ui/components';
import { TranslatePipe } from '@ngx-translate/core';
import { connectionMeter } from './connection-budget';
import type {
    MultiviewPickerDialogData,
    MultiviewPickerResult,
} from './multiview-picker-context';
import { MultiviewPickerController } from './multiview-picker-controller';
import {
    MULTIVIEW_PICKER_TYPES,
    type MultiviewPickerType,
    rowsOf,
} from './multiview-picker-list';
import { MultiviewPickerRowComponent } from './multiview-picker-row.component';
import {
    MULTIVIEW_PICKER_QUICK_SECTIONS,
    type MultiviewPickerSectionId,
} from './multiview-picker-sections';

const SECTION_ICONS: Readonly<Record<MultiviewPickerSectionId, string>> = {
    'live-now': 'sensors',
    continue: 'play_circle',
    favorites: 'favorite_border',
    recent: 'history',
    playlist: 'dns',
};

/** Provider names, not translated. */
const SOURCE_NAMES = { xtream: 'Xtream', m3u: 'M3U', stalker: 'Stalker' };

/** Keys a list row responds to, besides typing into the search. */
const NAVIGATION_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Enter']);

/**
 * The multiview source picker (spec 9.5): search on top, sections on the
 * left, the list on the right and the connection budget in the footer.
 * The search field owns the keyboard as a combobox over the list: typing
 * filters, the arrows move the active row, Enter picks it, Escape closes.
 */
@Component({
    selector: 'app-multiview-picker-dialog',
    templateUrl: './multiview-picker-dialog.component.html',
    styleUrl: './multiview-picker-dialog.component.scss',
    imports: [
        DialogShellComponent,
        DialogFooterStartDirective,
        MatIconModule,
        MultiviewPickerRowComponent,
        TranslatePipe,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { '(keydown)': 'onKeydown($event)' },
})
export class MultiviewPickerDialogComponent {
    private readonly ref =
        inject<
            MatDialogRef<MultiviewPickerDialogComponent, MultiviewPickerResult>
        >(MatDialogRef);
    readonly data = inject<MultiviewPickerDialogData>(MAT_DIALOG_DATA);
    readonly picker = new MultiviewPickerController(this.data, (result) =>
        this.ref.close(result)
    );
    private readonly searchInput =
        viewChild<ElementRef<HTMLInputElement>>('searchInput');

    readonly types = MULTIVIEW_PICKER_TYPES;
    readonly quickSections = MULTIVIEW_PICKER_QUICK_SECTIONS;
    readonly icons = SECTION_ICONS;
    readonly sourceNames = SOURCE_NAMES;
    readonly isReplace = this.data.request.context === 'replace';

    readonly rowIds = computed(() => {
        const ids = new Map<string, string>();
        const keys = this.picker.series()
            ? (this.picker.episodeRows() ?? []).map((row) => row.sessionKey)
            : rowsOf(this.picker.groups()).map((row) => row.sessionKey);
        keys.forEach((key, index) => ids.set(key, `mv-picker-option-${index}`));
        return ids;
    });
    readonly activeId = computed(() => {
        const key = this.picker.activeKey();
        return key ? (this.rowIds().get(key) ?? null) : null;
    });
    /** Keyboard moves stay visible: the list scrolls to the active row. */
    private readonly revealActive = afterRenderEffect(() => {
        const id = this.activeId();
        if (id) {
            document.getElementById(id)?.scrollIntoView?.({ block: 'nearest' });
        }
    });
    readonly meter = computed(() => {
        const budget = this.picker.budget();
        return budget ? connectionMeter(budget) : [];
    });
    readonly sectionCount = (id: MultiviewPickerSectionId) =>
        this.picker.sections().find((section) => section.id === id)?.count ?? 0;

    onKeydown(event: KeyboardEvent): void {
        if (event.defaultPrevented || event.altKey || event.metaKey) return;
        const input = this.searchInput()?.nativeElement;
        const inSearch = event.target === input;
        if (NAVIGATION_KEYS.has(event.key) && (inSearch || !isControl(event))) {
            event.preventDefault();
            if (event.key === 'Enter') this.picker.chooseActive();
            else this.picker.move(event.key === 'ArrowDown' ? 1 : -1);
            return;
        }
        if (event.key === 'Backspace' && !inSearch && this.picker.series()) {
            event.preventDefault();
            this.picker.closeEpisodes();
            return;
        }
        // Typing anywhere goes to the search (spec 9.5).
        if (!inSearch && event.key.length === 1 && !event.ctrlKey && input) {
            input.focus();
        }
    }

    onQuery(value: string): void {
        this.picker.query.set(value);
    }

    /** The search keeps the keyboard: arrows and Enter act on the list. */
    selectSection(id: MultiviewPickerSectionId): void {
        this.picker.selectSection(id);
        this.searchInput()?.nativeElement.focus();
    }

    selectType(type: MultiviewPickerType): void {
        this.picker.type.set(type);
        this.searchInput()?.nativeElement.focus();
    }
}

function isControl(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    return !!target?.closest('button, a, input, textarea, select');
}
