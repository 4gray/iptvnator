import { signal } from '@angular/core';
import { EpgDateNavigationDirection } from '../epg-date';

export interface EpgGuideFocus {
    readonly row: number;
    /** Block index inside the row, or null when the whole row is focused. */
    readonly block: number | null;
}

export interface EpgGuideKeyboardHost {
    rowCount(): number;
    blockCount(row: number): number;
    /** Index of the playing channel's row, or -1. */
    activeRow(): number;
    /** True while a dialog owns the keyboard. */
    isBlocked(): boolean;
    play(row: number): void;
    details(row: number, block: number): void;
    jumpNow(): void;
    stepDay(direction: EpgDateNavigationDirection): void;
    close(): void;
}

function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    return (
        target.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
    );
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/**
 * Roving focus for the guide grid. ↑/↓ move between rows, ←/→ between the
 * focused row's programmes, Enter plays the row, I opens details, N jumps to
 * now, PgUp/PgDn change the day, Esc closes. Returns whether the event was
 * consumed so the caller can `preventDefault()`.
 */
export class EpgGuideKeyboardController {
    readonly focus = signal<EpgGuideFocus | null>(null);

    constructor(private readonly host: EpgGuideKeyboardHost) {}

    handle(event: KeyboardEvent): boolean {
        if (
            event.defaultPrevented ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey ||
            isEditableTarget(event.target) ||
            this.host.isBlocked()
        ) {
            return false;
        }
        switch (event.key) {
            case 'Escape':
                this.host.close();
                return true;
            case 'ArrowDown':
                return this.moveRow(1);
            case 'ArrowUp':
                return this.moveRow(-1);
            case 'ArrowRight':
                return this.moveBlock(1);
            case 'ArrowLeft':
                return this.moveBlock(-1);
            case 'Enter':
                return this.play();
            case 'i':
            case 'I':
                return this.details();
            case 'n':
            case 'N':
                this.host.jumpNow();
                return true;
            case 'PageUp':
                this.host.stepDay('prev');
                return true;
            case 'PageDown':
                this.host.stepDay('next');
                return true;
            default:
                return false;
        }
    }

    private currentRow(): number {
        const focused = this.focus();
        if (focused) {
            return focused.row;
        }
        return this.host.activeRow();
    }

    private moveRow(delta: number): boolean {
        const count = this.host.rowCount();
        if (count === 0) {
            return false;
        }
        const current = this.currentRow();
        const next =
            current < 0
                ? delta > 0
                    ? 0
                    : count - 1
                : clamp(current + delta, 0, count - 1);
        this.focus.set({ row: next, block: null });
        return true;
    }

    private moveBlock(delta: number): boolean {
        const count = this.host.rowCount();
        if (count === 0) {
            return false;
        }
        const row = clamp(Math.max(0, this.currentRow()), 0, count - 1);
        const blocks = this.host.blockCount(row);
        if (blocks === 0) {
            this.focus.set({ row, block: null });
            return true;
        }
        const current = this.focus()?.row === row ? this.focus()?.block ?? null : null;
        const start = current ?? (delta > 0 ? -1 : blocks);
        this.focus.set({ row, block: clamp(start + delta, 0, blocks - 1) });
        return true;
    }

    private play(): boolean {
        const row = this.currentRow();
        if (row < 0 || row >= this.host.rowCount()) {
            return false;
        }
        this.host.play(row);
        return true;
    }

    private details(): boolean {
        const focused = this.focus();
        if (!focused || focused.block === null) {
            return false;
        }
        this.host.details(focused.row, focused.block);
        return true;
    }
}
