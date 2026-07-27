import type { VodSourceCandidate } from '@iptvnator/shared/interfaces';
import { VodMultiSourceController } from './vod-multi-source.controller';

function source(
    id: string,
    overrides: Partial<VodSourceCandidate> = {}
): VodSourceCandidate {
    return {
        id,
        playlistId: id,
        playlistName: id.toUpperCase(),
        portalType: 'xtream',
        contentId: 1,
        rawTitle: 'Dune',
        matchConfidence: 'exact',
        ...overrides,
    };
}

function controllerWith(...ids: string[]) {
    const controller = new VodMultiSourceController();
    controller.setSources(ids.map((id) => source(id)), 'title-year');
    return controller;
}

describe('VodMultiSourceController', () => {
    describe('alternatives and the chip', () => {
        it('reports no alternatives when the only source is the active one', () => {
            const controller = controllerWith('a');
            controller.setActiveSource('a');

            expect(controller.hasAlternatives()).toBe(false);
            expect(controller.alternativeCount()).toBe(0);
        });

        it('excludes the active source from the alternatives', () => {
            const controller = controllerWith('a', 'b', 'c');
            controller.setActiveSource('a');

            expect(controller.alternatives().map((s) => s.id)).toEqual([
                'b',
                'c',
            ]);
        });
    });

    describe('failover cannot loop', () => {
        it('never returns a source that was already tried', () => {
            const controller = controllerWith('a', 'b', 'c');
            controller.setActiveSource('a');

            const first = controller.pickFailoverTarget();
            expect(first).not.toBeNull();
            controller.setActiveSource(first!.id);

            const second = controller.pickFailoverTarget();
            expect(second!.id).not.toBe(first!.id);
            expect(second!.id).not.toBe('a');
        });

        it('exhausts after each source has been tried exactly once', () => {
            const controller = controllerWith('a', 'b', 'c');
            controller.setActiveSource('a');

            const visited = ['a'];
            for (let hop = 0; hop < 5; hop++) {
                const next = controller.pickFailoverTarget();
                if (!next) {
                    break;
                }
                expect(visited).not.toContain(next.id);
                visited.push(next.id);
                controller.setActiveSource(next.id);
            }

            // Three sources, three visits, then an honest dead end.
            expect(visited).toEqual(['a', 'b', 'c']);
            expect(controller.pickFailoverTarget()).toBeNull();
            expect(controller.isExhausted()).toBe(true);
        });

        it('stays exhausted even if the user returns to an earlier source', () => {
            const controller = controllerWith('a', 'b');
            controller.setActiveSource('a');
            controller.setActiveSource('b');
            controller.setActiveSource('a');

            // Returning by hand is allowed; automatic retrying is not.
            expect(controller.pickFailoverTarget()).toBeNull();
        });
    });

    describe('failover ranking', () => {
        it('prefers a probed-reachable source', () => {
            const controller = controllerWith('a', 'b', 'c');
            controller.setActiveSource('a');
            controller.setProbe('c', { status: 'ok' });

            expect(controller.pickFailoverTarget()!.id).toBe('c');
        });

        it('avoids a source probed as failing', () => {
            const controller = controllerWith('a', 'b', 'c');
            controller.setActiveSource('a');
            controller.setProbe('b', { status: 'fail' });

            expect(controller.pickFailoverTarget()!.id).toBe('c');
        });

        it('treats an unknown probe as neutral, not as a failure', () => {
            const controller = new VodMultiSourceController();
            controller.setSources(
                [source('a'), source('b'), source('c')],
                'title-year'
            );
            controller.setActiveSource('a');
            controller.setProbe('b', { status: 'unknown' });
            controller.setProbe('c', { status: 'fail' });

            // 'unknown' means we could not check — it must not be ranked
            // below a source we positively know is broken.
            expect(controller.pickFailoverTarget()!.id).toBe('b');
        });

        it('ignores guessed metadata when ranking', () => {
            const controller = new VodMultiSourceController();
            controller.setSources(
                [
                    source('a'),
                    // Rich-looking, but every value is a filename guess.
                    source('guessy', {
                        quality: { value: '2160p', provenance: 'parsed' },
                        codec: { value: 'HEVC', provenance: 'parsed' },
                        audio: { value: 'Дубляж', provenance: 'parsed' },
                        container: { value: 'mkv', provenance: 'parsed' },
                    }),
                    // One verified fact beats four guesses.
                    source('factual', {
                        container: { value: 'mp4', provenance: 'api' },
                    }),
                ],
                'title-year'
            );
            controller.setActiveSource('a');

            expect(controller.pickFailoverTarget()!.id).toBe('factual');
        });

        it('prefers an exact match over a fuzzy one, all else equal', () => {
            const controller = new VodMultiSourceController();
            controller.setSources(
                [
                    source('a'),
                    source('fuzzy', { matchConfidence: 'fuzzy' }),
                    source('exact', { matchConfidence: 'exact' }),
                ],
                'title-year'
            );
            controller.setActiveSource('a');

            expect(controller.pickFailoverTarget()!.id).toBe('exact');
        });

        it('deprioritizes a source known to have failed before', () => {
            const controller = new VodMultiSourceController();
            controller.setSources(
                [
                    source('a'),
                    source('stale', {
                        lastFailedAt: '2026-07-01T00:00:00.000Z',
                    }),
                    source('fresh'),
                ],
                'title-year'
            );
            controller.setActiveSource('a');

            expect(controller.pickFailoverTarget()!.id).toBe('fresh');
        });
    });

    describe('resume position', () => {
        it('carries the last reported position', () => {
            const controller = controllerWith('a');
            controller.setResumeSeconds(2538);

            expect(controller.getResumeSeconds()).toBe(2538);
        });

        it('ignores nonsensical positions rather than losing the good one', () => {
            const controller = controllerWith('a');
            controller.setResumeSeconds(2538);

            controller.setResumeSeconds(NaN);
            controller.setResumeSeconds(-5);
            controller.setResumeSeconds(Infinity);

            expect(controller.getResumeSeconds()).toBe(2538);
        });
    });

    describe('source state', () => {
        it('marks the pinned and active sources', () => {
            const controller = controllerWith('a', 'b');
            controller.setActiveSource('a');
            controller.setPinnedSource('b');

            const [first, second] = controller.sources();
            expect(first.isActive).toBe(true);
            expect(first.isPinned).toBe(false);
            expect(second.isActive).toBe(false);
            expect(second.isPinned).toBe(true);
        });

        it('merges upgraded metadata without reordering the list', () => {
            const controller = controllerWith('a', 'b');

            controller.updateSource(
                source('b', {
                    container: { value: 'mp4', provenance: 'api' },
                })
            );

            expect(controller.sources().map((s) => s.id)).toEqual(['a', 'b']);
            expect(controller.sources()[1].container).toEqual({
                value: 'mp4',
                provenance: 'api',
            });
        });

        it('defaults every source to an idle probe', () => {
            const controller = controllerWith('a');
            expect(controller.sources()[0].probe).toEqual({ status: 'idle' });
        });
    });
});
