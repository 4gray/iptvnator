import {
    ComponentFixture,
    fakeAsync,
    flushMicrotasks,
    TestBed,
    tick,
} from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import {
    EpgRuntimeBridgeService,
    EpgService,
} from '@iptvnator/epg/data-access';
import { EpgMappingDialogComponent } from './epg-mapping-dialog.component';

describe('EPG mapping search recovery', () => {
    let fixture: ComponentFixture<EpgMappingDialogComponent>;
    const matches = [{ id: 'demo', displayName: 'Demo news', iconUrl: null }];
    const bridge = {
        getEpgMapping: jest.fn().mockResolvedValue(null),
        searchEpgChannels: jest.fn(),
    };

    beforeEach(async () => {
        bridge.searchEpgChannels.mockReset().mockResolvedValue(matches);
        await TestBed.configureTestingModule({
            imports: [EpgMappingDialogComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: MAT_DIALOG_DATA,
                    useValue: { channelKey: 'news', channelName: 'News' },
                },
                { provide: MatDialogRef, useValue: { close: jest.fn() } },
                { provide: MatSnackBar, useValue: { open: jest.fn() } },
                { provide: EpgRuntimeBridgeService, useValue: bridge },
                { provide: EpgService, useValue: { clearCache: jest.fn() } },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(EpgMappingDialogComponent);
        fixture.detectChanges();
        await fixture.whenStable();
    });

    function search(term: string) {
        fixture.componentInstance.onSearchInput(term);
        tick(301);
        flushMicrotasks();
        fixture.detectChanges();
    }

    it('distinguishes a rejected lookup from no matches and keeps accepting new queries', fakeAsync(() => {
        bridge.searchEpgChannels.mockRejectedValueOnce(new Error('offline'));
        search('news');
        expect(fixture.componentInstance.searchFailed()).toBe(true);
        expect(
            fixture.nativeElement.querySelector('[role="status"]').textContent
        ).toContain('PORTALS.SEARCH_VIEW.ERROR_TITLE');
        expect(fixture.nativeElement.textContent).not.toContain(
            'EPG_MAPPING_DIALOG.NO_RESULTS'
        );
        search('demo');
        expect(bridge.searchEpgChannels).toHaveBeenCalledTimes(2);
        expect(fixture.componentInstance.searchFailed()).toBe(false);
        expect(fixture.componentInstance.results()).toEqual(matches);
        expect(fixture.componentInstance.loading()).toBe(false);
    }));

    it('retries the same query after a synchronous bridge failure', fakeAsync(() => {
        bridge.searchEpgChannels.mockImplementationOnce(() => {
            throw new Error('bridge unavailable');
        });
        search('news');
        expect(fixture.componentInstance.searchFailed()).toBe(true);
        fixture.nativeElement.querySelector('[role="status"] button').click();
        tick(301);
        flushMicrotasks();
        expect(bridge.searchEpgChannels).toHaveBeenLastCalledWith('news');
        expect(fixture.componentInstance.results()).toEqual(matches);
        expect(fixture.componentInstance.searchFailed()).toBe(false);
    }));

    it('clears a previous selection when the query changes', fakeAsync(() => {
        search('news');
        fixture.componentInstance.selectChannel('demo');
        search('new query');
        expect(fixture.componentInstance.selectedId()).toBeNull();
    }));

    it('clears a failed lookup when the query becomes too short without another request', fakeAsync(() => {
        bridge.searchEpgChannels.mockRejectedValueOnce(new Error('offline'));
        search('demo');
        search(' ');
        expect(bridge.searchEpgChannels).toHaveBeenCalledTimes(1);
        expect(fixture.componentInstance.searchFailed()).toBe(false);
        expect(fixture.componentInstance.loading()).toBe(false);
        expect(fixture.componentInstance.results()).toEqual([]);
        expect(
            fixture.nativeElement.querySelector('[role="status"]')
        ).toBeNull();
    }));

    it.each([undefined, null])(
        'treats an unavailable or empty bridge response (%s) as no results',
        fakeAsync((response: undefined | null) => {
            bridge.searchEpgChannels.mockReturnValueOnce(
                response === undefined ? undefined : Promise.resolve(response)
            );
            search('demo');
            expect(fixture.componentInstance.results()).toEqual([]);
            expect(fixture.componentInstance.loading()).toBe(false);
            expect(fixture.componentInstance.searchFailed()).toBe(false);
            expect(fixture.nativeElement.textContent).toContain(
                'EPG_MAPPING_DIALOG.NO_RESULTS'
            );
        })
    );
});
