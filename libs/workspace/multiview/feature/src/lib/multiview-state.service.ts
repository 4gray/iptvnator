import { computed, effect, Injectable, signal } from '@angular/core';
import { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import {
    DEFAULT_MULTIVIEW_LAYOUT_ID,
    getMultiviewLayoutPreset,
    isMultiviewLayoutId,
    MultiviewLayoutId,
} from './multiview-layouts';

export type MultiviewSlotOrigin = 'favorites' | 'recent';

export interface MultiviewSlotChannel {
    readonly item: UnifiedCollectionItem;
    readonly origin: MultiviewSlotOrigin;
}

interface PersistedMultiviewState {
    layoutId: MultiviewLayoutId;
    slots: (MultiviewSlotChannel | null)[];
    audioFocusIndex: number | null;
}

export const MULTIVIEW_STORAGE_KEY = 'multiview-state-v1';

/**
 * Component-provided state for the multiview grid: active layout preset,
 * per-slot channel assignments, and the single audio-focused slot.
 * Persisted to localStorage so the grid survives reloads.
 */
@Injectable()
export class MultiviewStateService {
    private readonly _layoutId = signal<MultiviewLayoutId>(
        DEFAULT_MULTIVIEW_LAYOUT_ID
    );
    private readonly _slots = signal<(MultiviewSlotChannel | null)[]>([]);
    private readonly _audioFocusIndex = signal<number | null>(null);

    readonly layoutId = this._layoutId.asReadonly();
    readonly slots = this._slots.asReadonly();
    readonly audioFocusIndex = this._audioFocusIndex.asReadonly();
    readonly layout = computed(() =>
        getMultiviewLayoutPreset(this._layoutId())
    );
    readonly occupiedCount = computed(
        () => this._slots().filter((slot) => slot !== null).length
    );

    constructor() {
        this.restore();
        effect(() => this.persist());
    }

    setLayout(layoutId: MultiviewLayoutId): void {
        if (!isMultiviewLayoutId(layoutId)) {
            return;
        }
        this._layoutId.set(layoutId);
        const capacity = getMultiviewLayoutPreset(layoutId).capacity;
        this._slots.update((slots) => resizeSlots(slots, capacity));
        this.ensureValidAudioFocus();
    }

    assign(index: number, channel: MultiviewSlotChannel): void {
        if (!this.isValidIndex(index)) {
            return;
        }
        this._slots.update((slots) =>
            slots.map((slot, i) => (i === index ? channel : slot))
        );
        if (this._audioFocusIndex() === null) {
            this._audioFocusIndex.set(index);
        }
    }

    remove(index: number): void {
        if (!this.isValidIndex(index)) {
            return;
        }
        this._slots.update((slots) =>
            slots.map((slot, i) => (i === index ? null : slot))
        );
        this.ensureValidAudioFocus();
    }

    focusAudio(index: number): void {
        if (!this.isValidIndex(index) || this._slots()[index] === null) {
            return;
        }
        this._audioFocusIndex.set(index);
    }

    private isValidIndex(index: number): boolean {
        return (
            Number.isInteger(index) &&
            index >= 0 &&
            index < this._slots().length
        );
    }

    /** Refocus the first occupied slot when the current focus became invalid. */
    private ensureValidAudioFocus(): void {
        const focus = this._audioFocusIndex();
        const slots = this._slots();
        if (focus !== null && focus < slots.length && slots[focus] !== null) {
            return;
        }
        const firstOccupied = slots.findIndex((slot) => slot !== null);
        this._audioFocusIndex.set(firstOccupied === -1 ? null : firstOccupied);
    }

    private restore(): void {
        const restored = readPersistedState();
        this._layoutId.set(restored.layoutId);
        this._slots.set(restored.slots);
        this._audioFocusIndex.set(restored.audioFocusIndex);
        this.ensureValidAudioFocus();
    }

    private persist(): void {
        const state: PersistedMultiviewState = {
            layoutId: this._layoutId(),
            slots: this._slots(),
            audioFocusIndex: this._audioFocusIndex(),
        };
        try {
            localStorage.setItem(MULTIVIEW_STORAGE_KEY, JSON.stringify(state));
        } catch {
            // Persistence is best-effort; a full or unavailable storage is fine.
        }
    }
}

function resizeSlots(
    slots: (MultiviewSlotChannel | null)[],
    capacity: number
): (MultiviewSlotChannel | null)[] {
    const resized = slots.slice(0, capacity);
    while (resized.length < capacity) {
        resized.push(null);
    }
    return resized;
}

function readPersistedState(): PersistedMultiviewState {
    const fallbackCapacity = getMultiviewLayoutPreset(
        DEFAULT_MULTIVIEW_LAYOUT_ID
    ).capacity;
    const defaults: PersistedMultiviewState = {
        layoutId: DEFAULT_MULTIVIEW_LAYOUT_ID,
        slots: resizeSlots([], fallbackCapacity),
        audioFocusIndex: null,
    };

    let raw: string | null = null;
    try {
        raw = localStorage.getItem(MULTIVIEW_STORAGE_KEY);
    } catch {
        return defaults;
    }
    if (!raw) {
        return defaults;
    }

    try {
        const parsed = JSON.parse(raw) as Partial<PersistedMultiviewState>;
        const layoutId = isMultiviewLayoutId(parsed.layoutId)
            ? parsed.layoutId
            : DEFAULT_MULTIVIEW_LAYOUT_ID;
        const capacity = getMultiviewLayoutPreset(layoutId).capacity;
        const slots = resizeSlots(
            Array.isArray(parsed.slots)
                ? parsed.slots.map(sanitizeSlot)
                : [],
            capacity
        );
        const audioFocusIndex =
            typeof parsed.audioFocusIndex === 'number' &&
            Number.isInteger(parsed.audioFocusIndex) &&
            parsed.audioFocusIndex >= 0 &&
            parsed.audioFocusIndex < capacity
                ? parsed.audioFocusIndex
                : null;

        return { layoutId, slots, audioFocusIndex };
    } catch {
        return defaults;
    }
}

function sanitizeSlot(candidate: unknown): MultiviewSlotChannel | null {
    if (typeof candidate !== 'object' || candidate === null) {
        return null;
    }
    const slot = candidate as Partial<MultiviewSlotChannel>;
    if (slot.origin !== 'favorites' && slot.origin !== 'recent') {
        return null;
    }
    const item = slot.item as Partial<UnifiedCollectionItem> | undefined;
    if (
        !item ||
        typeof item !== 'object' ||
        typeof item.uid !== 'string' ||
        typeof item.name !== 'string' ||
        typeof item.sourceType !== 'string' ||
        typeof item.playlistId !== 'string'
    ) {
        return null;
    }
    return { item: item as UnifiedCollectionItem, origin: slot.origin };
}
