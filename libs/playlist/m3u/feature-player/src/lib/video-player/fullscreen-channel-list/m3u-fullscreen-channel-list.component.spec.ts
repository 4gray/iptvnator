import { Component, Input, input, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import {
    Channel,
    PlaylistRecentlyViewedItem,
} from '@iptvnator/shared/interfaces';
import { M3uFullscreenChannelListComponent } from './m3u-fullscreen-channel-list.component';

@Component({
    selector: 'app-channel-list-container',
    template: '',
})
class StubChannelListContainerComponent {
    @Input() channelList: Channel[] = [];
    readonly channelsLoading = input(false);
    readonly activeView = input<string>('all');
    readonly recentItems = input<PlaylistRecentlyViewedItem[]>([]);
    readonly searchTerm = input<string | null>(null);
    readonly compact = input(false);
    readonly resetActiveChannelOnDestroy = input(true);
    readonly sidebarToggleRequested = output<void>();
}

describe('M3uFullscreenChannelListComponent', () => {
    let fixture: ComponentFixture<M3uFullscreenChannelListComponent>;
    let component: M3uFullscreenChannelListComponent;

    const container = (): StubChannelListContainerComponent =>
        fixture.debugElement.query(
            By.directive(StubChannelListContainerComponent)
        ).componentInstance;
    const chip = (view: string): HTMLButtonElement | null =>
        fixture.nativeElement.querySelector(
            `[data-test-id="m3u-fullscreen-view-${view}"]`
        );

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                M3uFullscreenChannelListComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
        })
            .overrideComponent(M3uFullscreenChannelListComponent, {
                set: {
                    imports: [
                        StubChannelListContainerComponent,
                        MatIconModule,
                        MatTooltipModule,
                        TranslateModule,
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(M3uFullscreenChannelListComponent);
        component = fixture.componentInstance;
    });

    afterEach(() => {
        fixture.destroy();
    });

    it('starts on the routed view and never lets the panel list reset playback', () => {
        const channels = [{ id: 'one', url: 'http://one' } as Channel];
        fixture.componentRef.setInput('channels', channels);
        fixture.componentRef.setInput('initialView', 'favorites');
        fixture.componentRef.setInput('searchTerm', 'ne');
        fixture.detectChanges();

        expect(component.view()).toBe('favorites');
        expect(chip('favorites')?.getAttribute('aria-selected')).toBe('true');
        expect(container().activeView()).toBe('favorites');
        expect(container().channelList).toBe(channels);
        expect(container().searchTerm()).toBe('ne');
        expect(container().compact()).toBe(true);
        expect(container().resetActiveChannelOnDestroy()).toBe(false);
    });

    it('labels the icon-only view segments for assistive tech and tooltips', () => {
        fixture.detectChanges();

        for (const view of ['all', 'groups', 'favorites', 'recent']) {
            const segment = chip(view);
            expect(segment?.getAttribute('role')).toBe('tab');
            expect(segment?.getAttribute('aria-label')).toBeTruthy();
            expect(segment?.textContent?.replace(/\s+/g, '')).toBe(
                segment?.querySelector('mat-icon')?.textContent?.trim()
            );
        }
    });

    it('falls back to all channels for a view the panel does not offer', () => {
        fixture.componentRef.setInput('initialView', 'something-else');
        fixture.detectChanges();

        expect(component.view()).toBe('all');
        expect(chip('all')?.getAttribute('aria-selected')).toBe('true');
    });

    it('switches the list view locally without navigating', () => {
        fixture.detectChanges();

        chip('groups')?.click();
        fixture.detectChanges();

        expect(component.view()).toBe('groups');
        expect(container().activeView()).toBe('groups');
        expect(chip('all')?.getAttribute('aria-selected')).toBe('false');
        expect(chip('groups')?.getAttribute('aria-selected')).toBe('true');
    });

    it("turns the list's hide-sidebar request into a close request", () => {
        fixture.detectChanges();
        const closeRequested = jest.fn();
        component.closeRequested.subscribe(closeRequested);

        container().sidebarToggleRequested.emit();

        expect(closeRequested).toHaveBeenCalledTimes(1);
    });
});
