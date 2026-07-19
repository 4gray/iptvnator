import { TestBed } from '@angular/core/testing';
import { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import {
    MULTIVIEW_STORAGE_KEY,
    MultiviewSlotChannel,
    MultiviewStateService,
} from './multiview-state.service';

function buildItem(uid: string): UnifiedCollectionItem {
    return {
        uid,
        name: `Channel ${uid}`,
        contentType: 'live',
        sourceType: 'm3u',
        playlistId: 'playlist-1',
        playlistName: 'Playlist 1',
    } as UnifiedCollectionItem;
}

function buildSlot(uid: string): MultiviewSlotChannel {
    return { item: buildItem(uid), origin: 'favorites' };
}

describe('MultiviewStateService', () => {
    let service: MultiviewStateService;

    const createService = () => {
        TestBed.configureTestingModule({
            providers: [MultiviewStateService],
        });
        return TestBed.inject(MultiviewStateService);
    };

    beforeEach(() => {
        localStorage.removeItem(MULTIVIEW_STORAGE_KEY);
    });

    afterEach(() => {
        localStorage.removeItem(MULTIVIEW_STORAGE_KEY);
    });

    it('starts with the default 2x2 layout and empty slots', () => {
        service = createService();

        expect(service.layoutId()).toBe('grid-2x2');
        expect(service.slots()).toEqual([null, null, null, null]);
        expect(service.audioFocusIndex()).toBeNull();
        expect(service.occupiedCount()).toBe(0);
    });

    it('assigns a channel and auto-focuses audio on the first assignment', () => {
        service = createService();

        service.assign(2, buildSlot('a'));

        expect(service.slots()[2]?.item.uid).toBe('a');
        expect(service.audioFocusIndex()).toBe(2);
        expect(service.occupiedCount()).toBe(1);
    });

    it('does not steal audio focus on subsequent assignments', () => {
        service = createService();

        service.assign(0, buildSlot('a'));
        service.assign(1, buildSlot('b'));

        expect(service.audioFocusIndex()).toBe(0);
    });

    it('moves audio focus only to occupied slots', () => {
        service = createService();
        service.assign(0, buildSlot('a'));
        service.assign(1, buildSlot('b'));

        service.focusAudio(1);
        expect(service.audioFocusIndex()).toBe(1);

        service.focusAudio(3);
        expect(service.audioFocusIndex()).toBe(1);
    });

    it('refocuses the first occupied slot when the focused tile is removed', () => {
        service = createService();
        service.assign(0, buildSlot('a'));
        service.assign(1, buildSlot('b'));
        service.focusAudio(1);

        service.remove(1);

        expect(service.slots()[1]).toBeNull();
        expect(service.audioFocusIndex()).toBe(0);
    });

    it('clears audio focus when the last tile is removed', () => {
        service = createService();
        service.assign(0, buildSlot('a'));

        service.remove(0);

        expect(service.audioFocusIndex()).toBeNull();
    });

    it('grows and shrinks slots when the layout changes', () => {
        service = createService();
        service.assign(0, buildSlot('a'));
        service.assign(3, buildSlot('d'));

        service.setLayout('grid-3x3');
        expect(service.slots().length).toBe(9);
        expect(service.slots()[3]?.item.uid).toBe('d');

        service.setLayout('grid-1x2');
        expect(service.slots().length).toBe(2);
        expect(service.slots()[0]?.item.uid).toBe('a');
    });

    it('refocuses when shrinking drops the focused slot', () => {
        service = createService();
        service.assign(0, buildSlot('a'));
        service.assign(3, buildSlot('d'));
        service.focusAudio(3);

        service.setLayout('grid-1x2');

        expect(service.audioFocusIndex()).toBe(0);
    });

    it('ignores out-of-range indices', () => {
        service = createService();

        service.assign(99, buildSlot('a'));
        service.remove(-1);
        service.focusAudio(99);

        expect(service.slots()).toEqual([null, null, null, null]);
        expect(service.audioFocusIndex()).toBeNull();
    });

    it('persists state to localStorage', () => {
        service = createService();
        service.setLayout('grid-1x2');
        service.assign(1, buildSlot('a'));
        TestBed.flushEffects();

        const persisted = JSON.parse(
            localStorage.getItem(MULTIVIEW_STORAGE_KEY) ?? '{}'
        );
        expect(persisted.layoutId).toBe('grid-1x2');
        expect(persisted.slots[1].item.uid).toBe('a');
        expect(persisted.audioFocusIndex).toBe(1);
    });

    it('restores persisted state', () => {
        localStorage.setItem(
            MULTIVIEW_STORAGE_KEY,
            JSON.stringify({
                layoutId: 'grid-3x3',
                slots: [buildSlot('a'), null, buildSlot('c')],
                audioFocusIndex: 2,
            })
        );

        service = createService();

        expect(service.layoutId()).toBe('grid-3x3');
        expect(service.slots().length).toBe(9);
        expect(service.slots()[0]?.item.uid).toBe('a');
        expect(service.slots()[2]?.item.uid).toBe('c');
        expect(service.audioFocusIndex()).toBe(2);
    });

    it('falls back to defaults for corrupted persistence', () => {
        localStorage.setItem(MULTIVIEW_STORAGE_KEY, 'not-json{');

        service = createService();

        expect(service.layoutId()).toBe('grid-2x2');
        expect(service.slots()).toEqual([null, null, null, null]);
    });

    it('sanitizes invalid slot entries and focus indices on restore', () => {
        localStorage.setItem(
            MULTIVIEW_STORAGE_KEY,
            JSON.stringify({
                layoutId: 'grid-2x2',
                slots: [
                    { origin: 'favorites' },
                    { item: { uid: 'x' }, origin: 'bogus' },
                    buildSlot('c'),
                    42,
                ],
                audioFocusIndex: 17,
            })
        );

        service = createService();

        expect(service.slots()[0]).toBeNull();
        expect(service.slots()[1]).toBeNull();
        expect(service.slots()[2]?.item.uid).toBe('c');
        expect(service.slots()[3]).toBeNull();
        // Invalid persisted focus falls back to the first occupied slot.
        expect(service.audioFocusIndex()).toBe(2);
    });
});
