import {
    ComponentFixture,
    DeferBlockBehavior,
    DeferBlockState,
    TestBed,
} from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';
import {
    PlaylistActions,
    selectPlaylistsLoadFailed,
    selectPlaylistsLoadingFlag,
} from '@iptvnator/m3u-state';
import { provideRouter, Router } from '@angular/router';
import { AppStartupStatusComponent } from './app-startup-status.component';

describe('AppStartupStatusComponent', () => {
    beforeEach(() =>
        TestBed.configureTestingModule({
            imports: [AppStartupStatusComponent, TranslateModule.forRoot()],
            deferBlockBehavior: DeferBlockBehavior.Manual,
            providers: [
                provideRouter([{ path: 'server-sign-in', children: [] }]),
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

    it('shows the server sign-in page although sources could not load', async () => {
        TestBed.inject(MockStore).overrideSelector(
            selectPlaylistsLoadFailed,
            true
        );
        const fixture = TestBed.createComponent(AppStartupStatusComponent);
        fixture.componentRef.setInput('routeReady', true);
        fixture.detectChanges();
        expect(fixture.componentInstance.complete()).toBe(false);

        await TestBed.inject(Router).navigateByUrl('/server-sign-in');
        fixture.detectChanges();

        expect(fixture.componentInstance.complete()).toBe(true);
        expect(fixture.nativeElement.querySelector('section')).toBeNull();
    });

    function createFailedFixture() {
        TestBed.inject(MockStore).overrideSelector(
            selectPlaylistsLoadFailed,
            true
        );
        const fixture = TestBed.createComponent(AppStartupStatusComponent);
        fixture.detectChanges();
        return fixture;
    }

    function expectRetryDispatch(
        fixture: ComponentFixture<AppStartupStatusComponent>,
        material: boolean
    ) {
        const buttons: HTMLButtonElement[] = Array.from(
            fixture.nativeElement.querySelectorAll('button')
        );
        expect(buttons).toHaveLength(1);
        expect(buttons[0].classList.contains('mat-mdc-unelevated-button')).toBe(
            material
        );
        const dispatch = jest.spyOn(TestBed.inject(MockStore), 'dispatch');
        buttons[0].click();
        expect(dispatch).toHaveBeenCalledWith(PlaylistActions.loadPlaylists());
    }

    it('offers a retry on failure without rendering raw storage errors', () => {
        const fixture = createFailedFixture();
        expect(
            fixture.nativeElement.querySelector('[role="alert"]')
        ).not.toBeNull();
        expect(fixture.nativeElement.querySelector('mat-spinner')).toBeNull();
        // Material's button loads with the failure branch, not the first
        // screen; the placeholder already retries while it downloads.
        expectRetryDispatch(fixture, false);
    });

    it('swaps in the Material button once its chunk has loaded', async () => {
        const fixture = createFailedFixture();
        const [retryBlock] = await fixture.getDeferBlocks();
        await retryBlock.render(DeferBlockState.Complete);
        expectRetryDispatch(fixture, true);
    });

    it('keeps the native retry button when the button chunk fails to load', async () => {
        const fixture = createFailedFixture();
        const [retryBlock] = await fixture.getDeferBlocks();
        await retryBlock.render(DeferBlockState.Error);
        expectRetryDispatch(fixture, false);
    });
});
