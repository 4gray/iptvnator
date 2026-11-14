import {
    computed,
    effect,
    signal,
    type Signal,
    untracked,
} from '@angular/core';
import type { MultiviewPickerData } from './multiview-picker-data.service';
import type { MultiviewPickerRow } from './multiview-picker-row';
import type { MultiviewPickerSectionId } from './multiview-picker-sections';

export interface MultiviewPickerCategoryDeps {
    readonly data: Signal<MultiviewPickerData | null>;
    readonly section: Signal<MultiviewPickerSectionId>;
    /** Loads one group of a paged portal. */
    readonly loadGroup: (
        groupId: string
    ) => Promise<readonly MultiviewPickerRow[]>;
}

/**
 * The category menu of the current playlist (spec 9.5). With the whole
 * channel list loaded it filters by group; a portal that lists channels per
 * group only (a Stalker portal without the full list) loads the chosen
 * group, and opens on its first one. Must be created in an injection
 * context.
 */
export class MultiviewPickerCategory {
    /** null: every category. */
    readonly selected = signal<string | null>(null);
    readonly loading = signal(false);
    private readonly loaded = signal<readonly MultiviewPickerRow[] | null>(
        null
    );

    readonly groups = computed(() => this.deps.data()?.playlistGroups ?? []);
    readonly paged = computed(() => this.deps.data()?.playlistPaged ?? false);
    readonly selectedName = computed(() => {
        const id = this.selected();
        return id === null
            ? null
            : (this.groups().find((group) => group.id === id)?.name ?? id);
    });

    constructor(private readonly deps: MultiviewPickerCategoryDeps) {
        effect(() => {
            const first = this.groups()[0];
            const open =
                this.paged() &&
                deps.section() === 'playlist' &&
                this.selected() === null;
            if (open && first) untracked(() => void this.select(first.id));
        });
    }

    /** The playlist section's rows for the chosen category. */
    rows(
        playlistRows: readonly MultiviewPickerRow[]
    ): readonly MultiviewPickerRow[] {
        if (this.paged()) return this.loaded() ?? [];
        const id = this.selected();
        if (id === null) return playlistRows;
        const groupOf = this.deps.data()?.playlistRowGroups;
        return playlistRows.filter(
            (row) => groupOf?.get(row.sessionKey) === id
        );
    }

    async select(id: string | null): Promise<void> {
        this.selected.set(id);
        if (!this.paged() || id === null) return;
        this.loading.set(true);
        this.loaded.set(null);
        const rows = await this.deps.loadGroup(id).catch(() => []);
        if (this.selected() !== id) return;
        this.loaded.set(rows);
        this.loading.set(false);
    }
}
