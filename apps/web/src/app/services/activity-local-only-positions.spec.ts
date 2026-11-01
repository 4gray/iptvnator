import { ActivityLocalOnlyPositions } from './activity-local-only-positions';
const position = { contentType: 'vod' as const, contentXtreamId: 42 };
describe('durable local-only position ownership', () => {
    afterEach(() => localStorage.clear());
    it('survives recreation while keeping server and source profiles separate', () => {
        new ActivityLocalOnlyPositions('synthetic-nas', localStorage).mark(
            'source-a',
            position
        );
        const reopened = new ActivityLocalOnlyPositions(
            'synthetic-nas',
            localStorage
        );
        expect(reopened.has('source-a', position)).toBe(true);
        expect(reopened.has('source-b', position)).toBe(false);
        expect(
            new ActivityLocalOnlyPositions('other-nas', localStorage).has(
                'source-a',
                position
            )
        ).toBe(false);
        reopened.clear('source-a', position);
        expect(reopened.has('source-a', position)).toBe(false);
    });
    it('keeps independent items intact when either client clears its own item', () => {
        const a = new ActivityLocalOnlyPositions('synthetic-nas', localStorage);
        const b = new ActivityLocalOnlyPositions('synthetic-nas', localStorage);
        a.mark('source-a', position);
        b.mark('source-a', { ...position, contentXtreamId: 43 });
        a.clear('source-a', position);
        expect(b.has('source-a', { ...position, contentXtreamId: 43 })).toBe(
            true
        );
    });
    it('binds fallback to its session until a new explicit action supersedes it', () => {
        const store = new ActivityLocalOnlyPositions(
            'synthetic-nas',
            localStorage
        );
        const held = {
            ...position,
            activitySessionId: 'synthetic-local-session',
        };
        store.mark('source-a', held);
        expect(store.owns('source-a', held)).toBe(true);
        const other = {
            ...position,
            activitySessionId: 'synthetic-other-session',
        };
        expect(store.owns('source-a', other)).toBe(false);
        store.committed('source-a', other, 'checkpoint');
        expect(store.has('source-a', held)).toBe(true);
        store.committed('source-a', other, 'begin');
        expect(store.has('source-a', held)).toBe(false);
    });
    it('retires ownership after a verified source incarnation changes, including after restart', () => {
        let incarnation: string | undefined;
        const make = () =>
            new ActivityLocalOnlyPositions(
                'synthetic-nas',
                localStorage,
                () => incarnation
            );
        const store = make();
        store.mark('source-a', position);
        incarnation = 'original-incarnation';
        store.rememberSources([
            {
                sourceId: 'source-a',
                sourceIncarnation: incarnation,
                provider: 'xtream',
            },
        ]);
        expect(store.has('source-a', position)).toBe(true);
        incarnation = 'replacement-incarnation';
        store.rememberSources([
            {
                sourceId: 'source-a',
                sourceIncarnation: incarnation,
                provider: 'xtream',
            },
        ]);
        expect(store.has('source-a', position)).toBe(false);
        expect(make().has('source-a', position)).toBe(false);
        store.mark('source-a', position);
        expect(store.has('source-a', position)).toBe(true);
    });
    it('recovers an unfinished minimal snapshot without copying titles or stream metadata', () => {
        const store = new ActivityLocalOnlyPositions(
            'synthetic-nas',
            localStorage
        );
        const input = {
            ...position,
            positionSeconds: 65,
            durationSeconds: 100,
            activityTitle: 'Synthetic local entry',
            url: 'http://synthetic.invalid/stream',
        };
        const pending = store.stage('source-a', input, 'synthetic-session');
        const reopened = new ActivityLocalOnlyPositions(
            'synthetic-nas',
            localStorage
        );
        expect(reopened.snapshots('source-a')).toEqual([
            expect.objectContaining({
                position: expect.objectContaining({ positionSeconds: 65 }),
            }),
        ]);
        expect(reopened.snapshots('source-a')[0].position).not.toHaveProperty(
            'activityTitle'
        );
        expect(reopened.snapshots('source-a')[0].position).not.toHaveProperty(
            'url'
        );
        reopened.complete('source-a', { ...pending, token: 'other-token' });
        expect(reopened.snapshots('source-a')).toHaveLength(1);
        reopened.complete('source-a', pending);
        expect(reopened.snapshots('source-a')).toHaveLength(0);
        expect(reopened.has('source-a', input)).toBe(true);
    });
    it('propagates storage failures instead of treating protected data as shared', () => {
        const store = new ActivityLocalOnlyPositions('synthetic-nas', {
            getItem: () => {
                throw new Error('Synthetic storage failure');
            },
            setItem: () => {
                throw new Error('Synthetic storage failure');
            },
            removeItem: () => undefined,
        });
        expect(() => store.has('source-a', position)).toThrow(
            'Synthetic storage failure'
        );
        expect(() => store.mark('source-a', position)).toThrow(
            'Synthetic storage failure'
        );
    });
});
