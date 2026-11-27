import { Injectable, signal } from '@angular/core';

export interface WorkspaceFavoriteFolderEntry {
    id: string;
    name?: string;
    labelKey?: string;
    count: number;
}

export interface WorkspaceFavoriteFoldersPanelState {
    entries: readonly WorkspaceFavoriteFolderEntry[];
    selectedId: string;
    onSelect(id: string): void;
    onCreate(): void;
    onCollapse(): void;
    onRename(id: string): void;
    onRemove(id: string): void;
    dragOriginId?: string | null;
    dragTargetId?: string | null;
    flashedId?: string | null;
}

/** The active Favorites Live page supplies the state for the shell's panel. */
@Injectable({ providedIn: 'root' })
export class WorkspaceFavoriteFoldersPanel {
    private readonly panelState =
        signal<WorkspaceFavoriteFoldersPanelState | null>(null);
    readonly state = this.panelState.asReadonly();

    set(state: WorkspaceFavoriteFoldersPanelState): void {
        this.panelState.set(state);
    }

    clear(): void {
        this.panelState.set(null);
    }
}
