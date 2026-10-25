import { TestBed } from '@angular/core/testing';
import {
    PLAYLIST_RECENT_HISTORY_STORAGE_KEY,
    PlaylistRecentHistoryService,
} from './playlist-recent-history.service';

describe('PlaylistRecentHistoryService', () => {
    const create = () => {
        TestBed.configureTestingModule({
            providers: [PlaylistRecentHistoryService],
        });
        return TestBed.inject(PlaylistRecentHistoryService);
    };

    beforeEach(() => localStorage.clear());
    afterEach(() => TestBed.resetTestingModule());

    it('keeps the three most recently opened, newest first', () => {
        const history = create();
        for (const id of ['a', 'b', 'c', 'b', 'd']) {
            history.record(id);
        }
        expect(history.ids()).toEqual(['d', 'b', 'c']);
    });

    it('survives a restart and ignores unreadable storage', () => {
        create().record('a');
        TestBed.resetTestingModule();
        expect(create().ids()).toEqual(['a']);

        TestBed.resetTestingModule();
        localStorage.setItem(PLAYLIST_RECENT_HISTORY_STORAGE_KEY, '{oops');
        expect(create().ids()).toEqual([]);
    });
});
