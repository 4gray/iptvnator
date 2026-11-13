import { Injectable, computed, inject, signal } from '@angular/core';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { MultiviewAnchorRegistry } from './multiview-anchor-registry';
import {
    MULTIVIEW_SOURCE_PICKER,
    type MultiviewChannelResolver,
    type MultiviewPickRequest,
    type MultiviewSourcePicker,
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
    private picker = inject(MULTIVIEW_SOURCE_PICKER, { optional: true });

    /** Whether a picker exists at all; without one there is no dock button. */
    get hasPicker(): boolean {
        return this.picker !== null;
    }

    /**
     * Installs the picker at run time, for a host that provides it below the
     * root (the workspace shell). Player views read {@link hasPicker} when
     * they are created, so the host installs it before it renders them.
     * Returns the uninstall function.
     */
    usePicker(picker: MultiviewSourcePicker): () => void {
        this.picker = picker;
        return () => {
            if (this.picker === picker) this.picker = null;
        };
    }

    private readonly channelResolver = signal<MultiviewChannelResolver | null>(
        null
    );

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

    /** Whether a list row can be Alt+clicked or dragged in right now (R5). */
    readonly canAddChannel = computed(
        () => this.channelResolver() !== null && this.canAdd()
    );

    /**
     * Installs how list rows become tile sources, at run time like the
     * picker. Returns the uninstall function.
     */
    useChannelResolver(resolver: MultiviewChannelResolver): () => void {
        this.channelResolver.set(resolver);
        return () => {
            if (this.channelResolver() === resolver) {
                this.channelResolver.set(null);
            }
        };
    }

    /** R5: Alt+click or a drop on free player space adds the channel. */
    async addChannel(item: UnifiedCollectionItem) {
        const source = await this.resolveChannel(item);
        return source ? this.add(source) : null;
    }

    /** R5: a channel dropped on a tile replaces that tile. */
    async replaceWithChannel(tileId: string, item: UnifiedCollectionItem) {
        const source = await this.resolveChannel(item);
        return source ? this.store.replace(tileId, source) : null;
    }

    private async resolveChannel(
        item: UnifiedCollectionItem
    ): Promise<MultiviewTileSource | null> {
        const resolver = this.channelResolver();
        if (!resolver || !this.canAdd()) return null;
        return resolver.resolve(item).catch(() => null);
    }

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
