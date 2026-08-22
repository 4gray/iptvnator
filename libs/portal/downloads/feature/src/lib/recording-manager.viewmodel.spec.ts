import type { RecordingItem } from '@iptvnator/services';
import {
    buildRecordingManagerViewModel,
    recordingDurationLabel,
    recordingDurationSeconds,
} from './recording-manager.viewmodel';

let nextId = 1;

function recording(overrides: Partial<RecordingItem> = {}): RecordingItem {
    return {
        id: nextId++,
        status: 'completed',
        filePath: `/rec/file-${nextId}.ts`,
        channelName: 'Channel One',
        startedAt: '2026-08-15T21:00:00Z',
        endedAt: '2026-08-15T21:58:00Z',
        fileAvailability: 'available',
        ...overrides,
    };
}

describe('recordingDurationSeconds', () => {
    it('computes whole seconds from the recorded interval', () => {
        expect(recordingDurationSeconds(recording())).toBe(58 * 60);
    });

    it('returns null while recording or for broken timestamps', () => {
        expect(
            recordingDurationSeconds(recording({ endedAt: undefined }))
        ).toBeNull();
        expect(
            recordingDurationSeconds(recording({ endedAt: 'garbage' }))
        ).toBeNull();
        expect(
            recordingDurationSeconds(
                recording({ endedAt: '2026-08-15T20:00:00Z' })
            )
        ).toBeNull();
    });
});

describe('buildRecordingManagerViewModel', () => {
    beforeEach(() => {
        nextId = 1;
    });

    it('partitions active, attention, and library rows', () => {
        const model = buildRecordingManagerViewModel({
            recordings: [
                recording({ status: 'recording', endedAt: undefined }),
                recording({ status: 'completed' }),
                recording({ status: 'interrupted' }),
                recording({ status: 'failed' }),
                recording({ fileAvailability: 'missing' }),
            ],
            filter: 'all',
        });
        expect(model.active).toHaveLength(1);
        expect(model.library.map(({ item }) => item.status)).toEqual(
            expect.arrayContaining(['completed', 'interrupted'])
        );
        expect(model.library).toHaveLength(2);
        expect(
            model.attention.map(({ attentionReason }) => attentionReason)
        ).toEqual(expect.arrayContaining(['failed', 'file-missing']));
        expect(model.count).toBe(5);
    });

    it('marks interrupted rows and keeps them playable', () => {
        const model = buildRecordingManagerViewModel({
            recordings: [recording({ status: 'interrupted' })],
            filter: 'recording',
        });
        expect(model.library[0].interrupted).toBe(true);
    });

    it('keeps active recordings under the in-progress filter', () => {
        // The chip counts them, so the page must list them.
        const model = buildRecordingManagerViewModel({
            recordings: [
                recording({ status: 'recording', endedAt: undefined }),
                recording({ status: 'completed' }),
                recording({ status: 'failed' }),
            ],
            filter: 'in-progress',
        });
        expect(model.active).toHaveLength(1);
        expect(model.library).toEqual([]);
        expect(model.attention).toEqual([]);
    });

    it('hides recordings under download-type filters but keeps the count', () => {
        for (const filter of ['movie', 'series']) {
            const model = buildRecordingManagerViewModel({
                recordings: [recording()],
                filter,
            });
            expect(model.active).toEqual([]);
            expect(model.attention).toEqual([]);
            expect(model.library).toEqual([]);
            expect(model.count).toBe(1);
        }
    });

    it('shows recordings under the all and recording filters', () => {
        for (const filter of ['all', 'recording', undefined]) {
            const model = buildRecordingManagerViewModel({
                recordings: [recording()],
                filter,
            });
            expect(model.library).toHaveLength(1);
        }
    });

    it('scopes to the playlist, excluding rows without a playlist id', () => {
        const model = buildRecordingManagerViewModel({
            recordings: [
                recording({ playlistId: 'playlist-a' }),
                recording({ playlistId: 'playlist-b' }),
                recording({ playlistId: undefined }),
            ],
            scopePlaylistId: 'playlist-a',
            filter: 'all',
        });
        expect(model.count).toBe(1);
        expect(model.library).toHaveLength(1);
        expect(model.library[0].item.playlistId).toBe('playlist-a');
    });

    it('matches search against program, channel, playlist, and error text', () => {
        const rows = [
            recording({ programTitle: 'Evening News' }),
            recording({ channelName: 'Discovery' }),
            recording({ playlistName: 'My provider' }),
            recording({ status: 'failed', errorMessage: 'disk full' }),
        ];
        const search = (term: string) =>
            buildRecordingManagerViewModel({
                recordings: rows,
                filter: 'all',
                searchTerm: term,
            });
        expect(search('evening').library).toHaveLength(1);
        expect(search('discovery').library).toHaveLength(1);
        expect(search('provider').library).toHaveLength(1);
        expect(search('disk').attention).toHaveLength(1);
        expect(search('nothing-matches').library).toHaveLength(0);
    });

    it('sorts newest first by startedAt with id tiebreak', () => {
        const model = buildRecordingManagerViewModel({
            recordings: [
                recording({ startedAt: '2026-08-13T10:00:00Z' }),
                recording({ startedAt: '2026-08-15T10:00:00Z' }),
                recording({ startedAt: '2026-08-14T10:00:00Z' }),
            ],
            filter: 'all',
        });
        expect(
            model.library.map(({ item }) => item.startedAt)
        ).toEqual([
            '2026-08-15T10:00:00Z',
            '2026-08-14T10:00:00Z',
            '2026-08-13T10:00:00Z',
        ]);
    });

    it('rounds duration minutes on the total before splitting hours', () => {
        // 59:45 must read "1 h", never "60 min" — and 1:59:45 must read
        // "2 h", never "1 h 60 min".
        expect(recordingDurationLabel(59 * 60 + 45)).toBe('1 h');
        expect(recordingDurationLabel(3600 + 59 * 60 + 45)).toBe('2 h');
        expect(recordingDurationLabel(3600 + 5 * 60)).toBe('1 h 5 min');
        expect(recordingDurationLabel(45)).toBe('1 min');
        expect(recordingDurationLabel(0)).toBe('');
        expect(recordingDurationLabel(null)).toBe('');
    });
});
