import { TestBed } from '@angular/core/testing';
import { DatabaseService, SourceActivityService } from '@iptvnator/services';
import type { ExternalPlayerSession } from '@iptvnator/shared/interfaces';
import type { XtreamLiveSource } from './xtream-external-live-sessions.service';
import {
    observeExternalLiveCatalog,
    readRefreshedLivePlayback,
} from './xtream-refreshed-live-playback';

const playlistId = 'synthetic-source';
const item = { xtream_id: 72, category_id: 3 };
const moved = { ...item, category_id: 9 };
const category = { id: 9, xtream_id: 98 };

describe('Refreshed Xtream live playback', () => {
    const db = {
        getContentByXtreamId: jest.fn(),
        getAllXtreamCategories: jest.fn(),
    };

    beforeEach(() => {
        db.getContentByXtreamId.mockReset().mockResolvedValue(moved);
        db.getAllXtreamCategories.mockReset().mockResolvedValue([category]);
    });

    it('does not guess a category when the original SQLite category is missing', async () => {
        const unidentified = { xtream_id: item.xtream_id };
        await expect(
            readRefreshedLivePlayback(db, playlistId, unidentified)
        ).resolves.toEqual({ item: unidentified, categoryId: 'unknown' });
        expect(db.getContentByXtreamId).not.toHaveBeenCalled();
    });

    it('keeps an ambiguous move unclassified and searches all category copies for locks', async () => {
        db.getContentByXtreamId.mockResolvedValue(null);
        await expect(
            readRefreshedLivePlayback(db, playlistId, item)
        ).resolves.toEqual({ item, categoryId: 'unknown' });
        expect(db.getContentByXtreamId).toHaveBeenCalledWith(
            item.xtream_id,
            playlistId,
            'live',
            undefined,
            item.category_id,
            undefined,
            true
        );
    });

    it('keeps the refreshed row unclassified when its category cannot be read', async () => {
        db.getAllXtreamCategories.mockRejectedValue(
            new Error('Synthetic database error')
        );
        await expect(
            readRefreshedLivePlayback(db, playlistId, item)
        ).resolves.toEqual({ item: moved, categoryId: 'unknown' });
    });

    it('updates a detached external session and leaves a newer session in place', async () => {
        const source: XtreamLiveSource = {
            playlistId,
            serverUrl: 'https://portal.example.test',
            username: 'synthetic-user',
            password: 'synthetic-password',
            channel: item,
            categoryId: 22,
        };
        const playing: ExternalPlayerSession = {
            id: 'synthetic-playing-session',
            player: 'mpv',
            status: 'playing',
            canClose: true,
            title: 'Synthetic channel',
            streamUrl: 'https://portal.example.test/live',
            startedAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
        };
        const newer = { ...playing, id: 'synthetic-newer-session' };
        const removed = { ...playing, id: 'synthetic-removed-session' };
        const other = { ...playing, id: 'synthetic-other-session' };
        const unknown = { ...playing, id: 'synthetic-unidentified-session' };
        const entries = new Map([
            [playing.id, { session: playing, source }],
            [newer.id, { session: newer, source }],
            [removed.id, { session: removed, source }],
            [
                other.id,
                {
                    session: other,
                    source: { ...source, playlistId: 'other-source' },
                },
            ],
            [
                unknown.id,
                { session: unknown, source: { ...source, channel: undefined } },
            ],
        ]);
        const update = jest.fn();
        TestBed.configureTestingModule({
            providers: [{ provide: DatabaseService, useValue: db }],
        });
        TestBed.runInInjectionContext(() =>
            observeExternalLiveCatalog(entries, update)
        );
        TestBed.inject(SourceActivityService).notifyLiveCatalogReplacement(
            playlistId
        );
        const replacement = entries.get(newer.id);
        if (replacement) replacement.source = { ...source, categoryId: 42 };
        entries.delete(removed.id);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(db.getContentByXtreamId).toHaveBeenCalledTimes(3);
        expect(update).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledWith(playing, {
            ...source,
            categoryId: category.xtream_id,
            channel: moved,
        });
    });
});
