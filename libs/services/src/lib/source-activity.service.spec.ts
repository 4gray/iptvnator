import { TestBed } from '@angular/core/testing';
import { SourceActivityService } from './source-activity.service';

describe('SourceActivityService coordination', () => {
    it('reports every other hold without exposing the protected source as idle', () => {
        const activity = TestBed.inject(SourceActivityService);
        const own = activity.begin(['source']);
        const edit = activity.begin(['source']);
        const other = activity.begin(['source', 'source']);
        const remaining: boolean[] = [];
        const unsubscribe = activity.onRelease(() => {
            remaining.push(activity.isBusy('source', 1));
        });
        edit();
        edit();
        expect(remaining).toEqual([true]);
        other();
        expect(remaining).toEqual([true, false]);
        expect(activity.isBusy('source')).toBe(true);
        unsubscribe();
        own();
        expect(activity.isBusy('source')).toBe(false);
        expect(remaining).toEqual([true, false]);
    });

    it('does not mark an unrelated source busy and unsubscribes before release', () => {
        const activity = TestBed.inject(SourceActivityService);
        const finish = activity.begin(['busy']);
        const released = jest.fn();
        const unsubscribe = activity.onRelease(released);
        expect(activity.isBusy('other')).toBe(false);
        expect(activity.isBusy('busy')).toBe(true);
        unsubscribe();
        finish();
        expect(released).not.toHaveBeenCalled();
    });
});
