import { Injectable, computed, inject } from '@angular/core';
import { MultiviewAnchorRegistry } from './multiview-anchor-registry';
import {
    MULTIVIEW_SOURCE_PICKER,
    type MultiviewPickRequest,
} from './multiview-ports';
import type {
    MultiviewEffect,
    MultiviewTileSource,
} from './multiview-session.model';
import {
    MultiviewSessionStore,
    supportsMultiview,
} from './multiview-session.store';

const rejected = (
    reason: Extract<MultiviewEffect, { type: 'rejected' }>['reason']
): MultiviewEffect => ({ type: 'rejected', reason });

/**
 * The ways into multiview: picking a source, Alt+click and drag from a list
 * (spec 9.1, R1, R5). Starts a session on the current anchor or adds to the
 * running one.
 */
@Injectable({ providedIn: 'root' })
export class MultiviewEntryService {
    private readonly store = inject(MultiviewSessionStore);
    private readonly anchors = inject(MultiviewAnchorRegistry);
    private readonly picker = inject(MULTIVIEW_SOURCE_PICKER, {
        optional: true,
    });

    /** Whether a picker exists at all; without one there is no dock button. */
    readonly hasPicker = this.picker !== null;

    /** Whether a source can be added right now. */
    readonly canAdd = computed(() => {
        if (this.store.exists()) return true;
        const anchor = this.anchors.current();
        return (
            anchor !== null &&
            anchor.host.source() !== null &&
            supportsMultiview(anchor.host.engine())
        );
    });

    /** Adds a source to the session, starting one on the current anchor. */
    add(source: MultiviewTileSource): MultiviewEffect | null {
        if (this.store.exists()) return this.store.add(source);

        const anchor = this.anchors.current();
        const primary = anchor?.host.source() ?? null;
        if (!anchor || !primary) return rejected('no-anchor');
        const engine = anchor.host.engine();
        if (!supportsMultiview(engine)) return rejected('unsupported-player');
        // R1: tile 1 continues a VOD where the view's player was.
        const position =
            primary.kind === 'live' || primary.position !== undefined
                ? primary.position
                : (anchor.position?.() ?? undefined);
        return this.store.start(
            anchor.host.anchorId,
            position === undefined ? primary : { ...primary, position },
            engine,
            source
        );
    }

    /** Opens the picker and applies its choice (spec 9.5 contexts). */
    async pick(request: MultiviewPickRequest = { context: 'add' }) {
        const source = await this.picker?.pick(request);
        if (!source) return null;
        return request.context === 'replace'
            ? this.store.replace(request.tileId, source)
            : this.add(source);
    }
}
