import type { EpgChannelMetadata } from '@iptvnator/shared/interfaces';
import {
    indexEpgChannelCandidates,
    resolveEpgChannelCandidate,
} from './epg-channel-candidate-index.util';

function candidate(id: string, displayName: string): EpgChannelMetadata {
    return { id, displayName, iconUrl: null };
}

/** The linear lookup the index replaces; kept as the behavioural reference. */
function findCandidate(
    channelId: string,
    candidates: EpgChannelMetadata[]
): EpgChannelMetadata | null {
    const lower = channelId.toLowerCase();
    return (
        candidates.find((c) => c.id === channelId) ??
        candidates.find((c) => c.id.toLowerCase() === lower) ??
        candidates.find((c) => c.displayName === channelId) ??
        candidates.find((c) => c.displayName.toLowerCase() === lower) ??
        null
    );
}

describe('EPG channel candidate index', () => {
    it('applies id, case-insensitive id, display name, then case-insensitive display name precedence', () => {
        const byDisplayName = candidate('news.one', 'CNN');
        const byLowerId = candidate('CNN.US', 'Cable News');
        const byExactId = candidate('cnn.us', 'Other');
        const index = indexEpgChannelCandidates([
            byDisplayName,
            byLowerId,
            byExactId,
        ]);

        expect(resolveEpgChannelCandidate(index, 'cnn.us')).toBe(byExactId);
        expect(resolveEpgChannelCandidate(index, 'Cnn.Us')).toBe(byLowerId);
        expect(resolveEpgChannelCandidate(index, 'CNN')).toBe(byDisplayName);
        expect(resolveEpgChannelCandidate(index, 'cnn')).toBe(byDisplayName);
        expect(resolveEpgChannelCandidate(index, 'missing')).toBeNull();
    });

    it('keeps the first candidate when several share a key', () => {
        const first = candidate('fox.1', 'FOX');
        const second = candidate('fox.2', 'FOX');
        const index = indexEpgChannelCandidates([first, second]);

        expect(resolveEpgChannelCandidate(index, 'FOX')).toBe(first);
        expect(resolveEpgChannelCandidate(index, 'fox')).toBe(first);
    });

    it('folds non-ASCII display names', () => {
        const kino = candidate('kino.ru', 'Киноман');
        const index = indexEpgChannelCandidates([kino]);

        expect(resolveEpgChannelCandidate(index, 'КИНОМАН')).toBe(kino);
    });

    it('returns the same candidate as a linear find for every key', () => {
        const names = ['ESPN', 'espn', 'ESPN 2', 'HBO', 'hbo', 'Киноман'];
        const candidates = Array.from({ length: 60 }, (_, i) =>
            candidate(
                i % 7 === 0 ? `ID.${i % 5}` : `id.${i % 11}`,
                names[i % names.length]
            )
        );
        const keys = [
            ...candidates.map((c) => c.id),
            ...candidates.map((c) => c.displayName.toUpperCase()),
            ...names,
            'id.3',
            'ID.3',
            'nothing',
        ];
        const index = indexEpgChannelCandidates(candidates);

        for (const key of keys) {
            expect(resolveEpgChannelCandidate(index, key)).toBe(
                findCandidate(key, candidates)
            );
        }
    });

    it('reads each candidate a constant number of times however many keys resolve', () => {
        let reads = 0;
        const candidates = Array.from({ length: 500 }, (_, i) => {
            const row = { id: `guide.${i}`, displayName: `Guide ${i}` };
            return {
                get id() {
                    reads += 1;
                    return row.id;
                },
                get displayName() {
                    reads += 1;
                    return row.displayName;
                },
                iconUrl: null,
            } as EpgChannelMetadata;
        });
        const keys = Array.from({ length: 500 }, (_, i) => `unmatched ${i}`);

        const index = indexEpgChannelCandidates(candidates);
        for (const key of keys) {
            resolveEpgChannelCandidate(index, key);
        }

        // A per-key linear scan reads ~4 fields per candidate per key (1M here).
        expect(reads).toBeLessThanOrEqual(candidates.length * 2);
    });
});
