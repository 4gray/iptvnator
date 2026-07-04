import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import {
    DetailActionsTemplateDirective,
    DetailMetaTemplateDirective,
    DetailTagsTemplateDirective,
} from './detail-template.directives';
import { PortalDetailShellComponent } from './portal-detail-shell.component';

@Component({
    standalone: true,
    imports: [
        PortalDetailShellComponent,
        DetailTagsTemplateDirective,
        DetailMetaTemplateDirective,
        DetailActionsTemplateDirective,
    ],
    template: `
        <app-portal-detail-shell
            [title]="'Show Title'"
            [description]="'Show description'"
            [posterUrl]="'poster.jpg'"
            [playbackActive]="playbackActive()"
            (closePlayerRequested)="closeRequests = closeRequests + 1"
        >
            <ng-template detailTags>
                <span class="details__tag">2026</span>
            </ng-template>
            <ng-template detailMeta>
                <div class="details__meta-item">Cast entry</div>
            </ng-template>
            <ng-template detailActions>
                <button class="play-btn">Play</button>
            </ng-template>
            @if (playbackActive()) {
                <div detail-player class="fake-player">player</div>
            }
            <div detail-episodes class="fake-episodes">episodes</div>
            <div detail-extras class="fake-extras">extras</div>
        </app-portal-detail-shell>
    `,
})
class HostComponent {
    readonly playbackActive = signal(false);
    closeRequests = 0;
}

describe('PortalDetailShellComponent', () => {
    let fixture: ComponentFixture<HostComponent>;
    let host: HostComponent;

    const query = (selector: string): HTMLElement | null =>
        (fixture.nativeElement as HTMLElement).querySelector(selector);

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [HostComponent, TranslateModule.forRoot()],
        }).compileComponents();

        fixture = TestBed.createComponent(HostComponent);
        host = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('renders hero with stamped tags/meta/actions in browse state', () => {
        expect(query('.shell__hero--collapsed')).toBeNull();
        expect(query('app-content-hero')).toBeTruthy();
        expect(query('.details__tags .details__tag')?.textContent).toContain(
            '2026'
        );
        expect(query('.details__meta .details__meta-item')).toBeTruthy();
        expect(query('.action-buttons .play-btn')).toBeTruthy();
        expect(query('app-content-about')).toBeNull();
    });

    it('collapses hero and shows About with re-stamped templates in watch state', () => {
        host.playbackActive.set(true);
        fixture.detectChanges();

        expect(query('.shell__hero--collapsed')).toBeTruthy();
        const about = query('app-content-about');
        expect(about).toBeTruthy();
        expect(about?.querySelector('.details__tag')?.textContent).toContain(
            '2026'
        );
        expect(about?.querySelector('.details__meta-item')).toBeTruthy();
        // Actions are intentionally NOT repeated in About
        expect(about?.querySelector('.play-btn')).toBeNull();
        expect(about?.textContent).toContain('Show description');
    });

    it('keeps the player slot outside any shell conditional', () => {
        host.playbackActive.set(true);
        fixture.detectChanges();
        const player = query('.fake-player');
        expect(player).toBeTruthy();

        // Toggling unrelated shell state must not recreate the projected node
        host.playbackActive.set(false);
        fixture.detectChanges();
        // player disappears only because the HOST @if removed it
        expect(query('.fake-player')).toBeNull();
    });

    it('emits closePlayerRequested on Escape only during playback', () => {
        const escape = () =>
            document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
            );

        escape();
        expect(host.closeRequests).toBe(0);

        host.playbackActive.set(true);
        fixture.detectChanges();
        escape();
        expect(host.closeRequests).toBe(1);
    });

    it('ignores Escape when the event was already handled', () => {
        host.playbackActive.set(true);
        fixture.detectChanges();

        const event = new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
        });
        event.preventDefault();
        document.dispatchEvent(event);
        expect(host.closeRequests).toBe(0);
    });
});
