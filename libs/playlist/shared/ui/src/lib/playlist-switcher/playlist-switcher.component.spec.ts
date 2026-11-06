import {
    ChangeDetectionStrategy,
    Component,
    output,
    signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { SourceStatusService } from '@iptvnator/portal/shared/data-access';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { PlaylistSwitcherOpenService } from './playlist-switcher-open.service';
import { PlaylistSwitcherPanelComponent } from './playlist-switcher-panel.component';
import { PlaylistSwitcherComponent } from './playlist-switcher.component';

@Component({
    selector: 'app-playlist-switcher-panel',
    template: '<input class="stub-search" />',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubPanelComponent {
    readonly closeRequested = output<void>();
    readonly playlistSelected = output<string>();
    readonly addPlaylistRequested = output<void>();
    readonly accountInfoRequested = output<PlaylistMeta>();
}

const URL_NAMED = {
    _id: 'url-named',
    title: 'get.php?username=joe&password=hunter2&type=m3u_plus',
    url: 'http://biggie.test:8080/get.php?username=joe&password=hunter2&type=m3u_plus',
    count: 3220,
    importDate: '',
    autoRefresh: false,
} as PlaylistMeta;

describe('PlaylistSwitcherComponent', () => {
    let fixture: ComponentFixture<PlaylistSwitcherComponent>;
    let active: ReturnType<typeof signal<PlaylistMeta | null>>;

    const trigger = () =>
        (fixture.nativeElement as HTMLElement).querySelector(
            '[data-test-id="playlist-switcher-trigger"]'
        ) as HTMLButtonElement;
    const panel = () => document.querySelector('app-playlist-switcher-panel');

    beforeEach(() => {
        active = signal<PlaylistMeta | null>(URL_NAMED);
        TestBed.configureTestingModule({
            imports: [
                PlaylistSwitcherComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: PlaylistContextFacade,
                    useValue: {
                        resolvedPlaylistId: signal('url-named'),
                        activePlaylist: active,
                    },
                },
                {
                    provide: SourceStatusService,
                    useValue: { statusOf: () => ({ reachability: 'ok' }) },
                },
            ],
        });
        TestBed.overrideComponent(PlaylistSwitcherComponent, {
            remove: { imports: [PlaylistSwitcherPanelComponent] },
            add: { imports: [StubPanelComponent] },
        });
        fixture = TestBed.createComponent(PlaylistSwitcherComponent);
        fixture.componentRef.setInput('currentTitle', '');
        fixture.componentRef.setInput('subtitle', '3 sources');
        fixture.detectChanges();
    });

    afterEach(() => fixture.destroy());

    it('names the active source by its host, never by a credential URL', () => {
        expect(trigger().querySelector('.name')?.textContent?.trim()).toBe(
            'biggie.test:8080'
        );
        expect(
            trigger().querySelector('.channels-count')?.textContent
        ).toContain('M3U · HOME.PLAYLISTS.CHANNELS_COUNT');
        expect(trigger().textContent).not.toMatch(/hunter2|password=/);
        expect(trigger().querySelector('.source-tile__dot')).not.toBeNull();
        expect(trigger().getAttribute('aria-keyshortcuts')).toBe(
            'Meta+P Control+P'
        );
    });

    it('shows the source count when no source is active', () => {
        active.set(null);
        fixture.detectChanges();
        expect(trigger().querySelector('.channels-count')?.textContent).toBe(
            '3 sources'
        );
    });

    it('opens the popover in an overlay and closes it on Escape, back on the trigger', () => {
        trigger().click();
        fixture.detectChanges();
        expect(panel()).not.toBeNull();
        expect(trigger().getAttribute('aria-expanded')).toBe('true');
        expect(trigger().classList).toContain('is-open');

        document.body.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
        fixture.detectChanges();
        expect(panel()).toBeNull();
        expect(document.activeElement).toBe(trigger());
    });

    it('refits the open popover when the window shrinks', () => {
        const height = Object.getOwnPropertyDescriptor(window, 'innerHeight');
        const setHeight = (value: number) =>
            Object.defineProperty(window, 'innerHeight', {
                configurable: true,
                value,
            });
        try {
            setHeight(900);
            trigger().click();
            fixture.detectChanges();
            const opened = fixture.componentInstance.maxHeight();

            setHeight(600);
            window.dispatchEvent(new Event('resize'));
            expect(fixture.componentInstance.maxHeight()).not.toBe(opened);
            expect(
                parseInt(fixture.componentInstance.maxHeight() ?? '', 10)
            ).toBeLessThanOrEqual(600);
        } finally {
            if (height) Object.defineProperty(window, 'innerHeight', height);
        }
    });

    it('opens on a ⌘P / Ctrl+P request while it is on screen', () => {
        const switcherOpen = TestBed.inject(PlaylistSwitcherOpenService);
        expect(switcherOpen.available).toBe(true);
        switcherOpen.request();
        fixture.detectChanges();
        expect(panel()).not.toBeNull();

        fixture.destroy();
        expect(switcherOpen.available).toBe(false);
    });
});
