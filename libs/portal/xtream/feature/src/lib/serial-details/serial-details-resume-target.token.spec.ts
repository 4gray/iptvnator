import { TestBed } from '@angular/core/testing';
import { XTREAM_SERIES_RESUME_TARGET } from './serial-details-resume-target.token';

describe('XTREAM_SERIES_RESUME_TARGET', () => {
    it('defaults to a null resume target outside collection detail hosts', () => {
        const target = TestBed.inject(XTREAM_SERIES_RESUME_TARGET);

        expect(target()).toBeNull();
    });
});
