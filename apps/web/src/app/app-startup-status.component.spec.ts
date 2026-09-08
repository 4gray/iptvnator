import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';
import {
    PlaylistActions,
    selectPlaylistsLoadFailed,
    selectPlaylistsLoadingFlag,
} from '@iptvnator/m3u-state';
import { AppStartupStatusComponent } from './app-startup-status.component';

describe('AppStartupStatusComponent', () => {
    beforeEach(() =>
        TestBed.configureTestingModule({
            imports: [AppStartupStatusComponent, TranslateModule.forRoot()],
            providers: [
                provideMockStore({
                    selectors: [
                        { selector: selectPlaylistsLoadingFlag, value: false },
                        { selector: selectPlaylistsLoadFailed, value: false },
                    ],
                }),
            ],
        })
    );

    it('keeps showing preparation while EPG reconciliation delays the route', () => {
        const store = TestBed.inject(MockStore);
        store.overrideSelector(selectPlaylistsLoadingFlag, true);
        const fixture = TestBed.createComponent(AppStartupStatusComponent);
        fixture.detectChanges();
        expect(
            fixture.nativeElement.querySelector('[role="status"]')
        ).not.toBeNull();
        fixture.componentRef.setInput('routeReady', true);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('section')).toBeNull();
    });

    it('does not expose an empty workspace before sources finish loading', () => {
        const fixture = TestBed.createComponent(AppStartupStatusComponent);
        fixture.componentRef.setInput('routeReady', true);
        fixture.detectChanges();
        expect(fixture.componentInstance.complete()).toBe(false);
        const store = TestBed.inject(MockStore);
        store.overrideSelector(selectPlaylistsLoadingFlag, true);
        store.refreshState();
        fixture.detectChanges();
        expect(fixture.componentInstance.complete()).toBe(true);
    });

    it('offers a retry on failure without rendering raw storage errors', () => {
        TestBed.inject(MockStore).overrideSelector(
            selectPlaylistsLoadFailed,
            true
        );
        const fixture = TestBed.createComponent(AppStartupStatusComponent);
        fixture.detectChanges();
        expect(
            fixture.nativeElement.querySelector('[role="alert"]')
        ).not.toBeNull();
        expect(fixture.nativeElement.querySelector('mat-spinner')).toBeNull();
        const dispatch = jest.spyOn(TestBed.inject(MockStore), 'dispatch');
        fixture.nativeElement.querySelector('button').click();
        expect(dispatch).toHaveBeenCalledWith(PlaylistActions.loadPlaylists());
    });
});
