import { TestBed } from '@angular/core/testing';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateService } from '@ngx-translate/core';
import { invoke } from '@tauri-apps/api/core';
import { MockModule, MockProviders } from 'ng-mocks';
import { DataService } from './data.service';
import { EpgService } from './epg.service';

jest.mock('@tauri-apps/api/core', () => ({
    invoke: jest.fn(),
    isTauri: () => true,
}));

describe('EpgService', () => {
    let service: EpgService;
    let snackBar: MatSnackBar;
    let store: MockStore;
    let translateService: TranslateService;
    let dispatchSpy: jest.SpyInstance;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                EpgService,
                MockProviders(DataService, TranslateService, MatSnackBar),
                provideMockStore(),
            ],
            imports: [MockModule(MatSnackBarModule)],
        });

        service = TestBed.inject(EpgService);
        snackBar = TestBed.inject(MatSnackBar);
        store = TestBed.inject(MockStore);
        translateService = TestBed.inject(TranslateService);

        jest.spyOn(translateService, 'instant').mockImplementation(
            (key) => key
        );
        jest.spyOn(snackBar, 'open');
        dispatchSpy = jest.spyOn(store, 'dispatch');

        // Suppress console.error during tests
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should create a service instance', () => {
        expect(service).toBeTruthy();
    });

    describe('fetchEpg', () => {
        it('should show success notification on successful fetch', async () => {
            (invoke as jest.Mock).mockResolvedValueOnce({});
            service.fetchEpg(['http://example.com/epg.xml']);

            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(snackBar.open).toHaveBeenCalledWith(
                'EPG.FETCH_SUCCESS',
                null,
                expect.any(Object)
            );
        });

        it('should show error notification on fetch failure', async () => {
            (invoke as jest.Mock).mockRejectedValueOnce(new Error('Failed'));
            service.fetchEpg(['http://example.com/epg.xml']);

            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(snackBar.open).toHaveBeenCalledWith(
                'EPG.ERROR',
                'CLOSE',
                expect.any(Object)
            );
        });
    });

    describe('getChannelPrograms', () => {
        it('should update programs and set EPG flag to true when programs exist', (done) => {
            const mockPrograms = [
                {
                    start: new Date().toISOString(),
                    stop: new Date().toISOString(),
                    title: 'Test',
                },
            ];
            (invoke as jest.Mock).mockResolvedValueOnce(mockPrograms);

            service.getChannelPrograms('test-channel');

            service.currentEpgPrograms$.subscribe((programs) => {
                expect(programs).toHaveLength(1);
                expect(dispatchSpy).toHaveBeenCalledWith(
                    expect.objectContaining({ value: true })
                );
                done();
            });
        });

        it('should set EPG flag to false when no programs found', (done) => {
            (invoke as jest.Mock).mockResolvedValueOnce([]);

            service.getChannelPrograms('test-channel');

            service.currentEpgPrograms$.subscribe((programs) => {
                expect(programs).toHaveLength(0);
                expect(dispatchSpy).toHaveBeenCalledWith(
                    expect.objectContaining({ value: false })
                );
                done();
            });
        });
    });
});
