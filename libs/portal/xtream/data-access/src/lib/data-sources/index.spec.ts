import { TestBed } from '@angular/core/testing';
import { XtreamApiService } from '../services/xtream-api.service';
import {
    provideXtreamDataSource,
    PwaXtreamDataSource,
    XTREAM_DATA_SOURCE,
} from './index';

describe('provideXtreamDataSource', () => {
    let originalElectron: typeof window.electron;

    beforeEach(() => {
        originalElectron = window.electron;
    });

    afterEach(() => {
        (window as unknown as { electron?: typeof window.electron }).electron =
            originalElectron;
        TestBed.resetTestingModule();
    });

    it('uses the PWA data source when the web shim exposes an empty electron object', () => {
        (window as unknown as { electron?: typeof window.electron }).electron =
            {} as typeof window.electron;

        TestBed.configureTestingModule({
            providers: [
                ...provideXtreamDataSource(),
                {
                    provide: XtreamApiService,
                    useValue: {},
                },
            ],
        });

        expect(TestBed.inject(XTREAM_DATA_SOURCE)).toBeInstanceOf(
            PwaXtreamDataSource
        );
    });
});
