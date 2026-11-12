import { signal, untracked, type WritableSignal } from '@angular/core';
import type { TimelineRenderBlock } from '../epg-timeline/epg-timeline-render.util';
import type { EpgGuideFocus } from './epg-guide-keyboard.controller';
import { findGuideProgramme } from './epg-guide-layout.util';
import type { EpgGuideRowStatus } from './epg-guide-programs.service';
import type { EpgGuideChannel } from './epg-guide-source';

interface FocusHost {
    focus: WritableSignal<EpgGuideFocus | null>;
    rows(): readonly EpgGuideChannel[];
    blocksFor(row: number): TimelineRenderBlock[];
    trackProgrammes(channelId: string): void;
    statusFor(channelId: string): EpgGuideRowStatus;
    restoreFocus(focus: EpgGuideFocus | null): void;
    focusRow(row: number): void;
}

/** Tracks focus by channel and programme across filtering and schedule reloads. */
export class EpgGuideFocusController {
    private rowId: string | null = null;
    private recorded: EpgGuideFocus | null = null;
    private programme?: TimelineRenderBlock['block'];
    private readonly restoring = signal(false);

    constructor(private readonly host: FocusHost) {}

    blockFor(row: number): number | null {
        const focused = this.host.focus();
        return focused?.row === row && !this.restoring() ? focused.block : null;
    }

    observeProgrammes(): void {
        const focused = this.host.focus();
        const moved = focused !== this.recorded;
        if (moved) {
            this.restoring.set(false);
            this.recorded = focused;
            this.rowId = focused
                ? (untracked(() => this.host.rows())[focused.row]?.id ?? null)
                : null;
        }
        const id = this.rowId;
        if (!focused || focused.block === null || id === null) {
            this.programme = undefined;
            return;
        }
        const { row, block } = focused;
        this.host.trackProgrammes(id);
        const loading = this.isPending(id);
        untracked(() => {
            if (this.host.rows()[row]?.id !== id) return;
            const blocks = this.host.blocksFor(row);
            if (moved) {
                this.programme = blocks[block]?.block;
                if (this.programme) return;
            }
            const index = findGuideProgramme(blocks, this.programme);
            if (index < 0 && loading && this.programme) {
                this.restoring.set(true);
                return;
            }
            if (index !== block)
                this.host.focus.set({ row, block: index < 0 ? null : index });
            if (index !== block || this.restoring()) {
                this.restoring.set(false);
                this.host.focusRow(row);
            }
        });
    }

    reconcileRows(rows: readonly EpgGuideChannel[]): void {
        const focused = this.host.focus();
        const id = this.rowId;
        if (!focused || id === null) return;
        const row = rows.findIndex((channel) => channel.id === id);
        if (row === focused.row) return;
        const next = row < 0 ? Math.min(focused.row, rows.length - 1) : row;
        let block =
            row >= 0 && focused.block !== null
                ? findGuideProgramme(this.host.blocksFor(row), this.programme)
                : -1;
        if (
            row >= 0 &&
            block < 0 &&
            focused.block !== null &&
            this.programme &&
            this.isPending(id)
        ) {
            block = focused.block;
            this.restoring.set(true);
        } else {
            this.restoring.set(false);
        }
        this.rowId = rows[next]?.id ?? null;
        this.recorded =
            next < 0 ? null : { row: next, block: block < 0 ? null : block };
        this.host.focus.set(this.recorded);
        this.host.restoreFocus(this.recorded);
    }

    private isPending(channelId: string): boolean {
        const status = this.host.statusFor(channelId);
        return status === 'idle' || status === 'loading';
    }
}
