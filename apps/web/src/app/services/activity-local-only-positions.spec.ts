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
