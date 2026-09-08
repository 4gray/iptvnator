import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
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
            [backLabel]="'Return to downloads'"
            [backAvailable]="backAvailable()"
            [playbackActive]="playbackActive()"
            (backClicked)="backRequests = backRequests + 1"
            (closePlayerRequested)="closePlayer()"
        >
            <ng-template appDetailTags>
                <span class="details__tag">2026</span>
            </ng-template>
            <ng-template appDetailMeta>
                <div class="details__meta-item">Cast entry</div>
            </ng-template>
            <ng-template appDetailActions>
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
    readonly backAvailable = signal(true);
    closeRequests = 0;
    backRequests = 0;

    closePlayer(): void {
        this.closeRequests++;
        this.playbackActive.set(false);
    }
}

describe('PortalDetailShellComponent', () => {
    let fixture: ComponentFixture<HostComponent>;
    let host: HostComponent;

    const query = (selector: string): HTMLElement | null =>
        (fixture.nativeElement as HTMLElement).querySelector(selector);

    const requiredQuery = (selector: string): HTMLElement => {
        const element = query(selector);
        if (!element) throw new Error(`Missing element: ${selector}`);
        return element;
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [HostComponent, TranslateModule.forRoot()],
        }).compileComponents();
        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            BACK: 'Go back',
            PORTALS: { CLOSE_PLAYER: 'Close player' },
        });
        translate.use('en');

        fixture = TestBed.createComponent(HostComponent);
        host = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('makes the scroll owner a named keyboard region and focuses it once', async () => {
        await fixture.whenStable();
        const shell = requiredQuery('app-portal-detail-shell');
        expect(shell.tabIndex).toBe(0);
        expect(shell.getAttribute('aria-label')).toBe('Show Title');
        expect(document.activeElement).toBe(shell);
        const play = requiredQuery('.play-btn');
        play.focus();
        host.playbackActive.set(true);
        fixture.detectChanges();
        await fixture.whenStable();
        expect(document.activeElement).not.toBe(shell);
    });

    it('keeps native scrolling on the shell without forwarding keys to the player', () => {
        const shell = requiredQuery('app-portal-detail-shell');
        const globalKey = jest.fn();
        document.addEventListener('keydown', globalKey);
        try {
            const event = new KeyboardEvent('keydown', {
                key: 'ArrowDown',
                bubbles: true,
                cancelable: true,
            });
            shell.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(false);
            expect(globalKey).not.toHaveBeenCalled();
            requiredQuery('.play-btn').dispatchEvent(
                new KeyboardEvent('keydown', { key: ' ', bubbles: true })
            );
            expect(globalKey).toHaveBeenCalledTimes(1);
        } finally {
            document.removeEventListener('keydown', globalKey);
        }
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
        expect(query('.shell__back-button')?.getAttribute('aria-label')).toBe(
            'Return to downloads'
        );
    });

    it.each([{ isLoading: true }, { errorMessage: 'Unavailable' }])(
        'keeps the translated fallback Back available in loading/error states',
        (state) => {
            fixture.destroy();
            const shellFixture = TestBed.createComponent(
                PortalDetailShellComponent
            );
            for (const [key, value] of Object.entries(state))
                shellFixture.componentRef.setInput(key, value);
            shellFixture.detectChanges();
            const element = shellFixture.nativeElement as HTMLElement;
            const button = element.querySelector<HTMLButtonElement>(
                '.shell__back-button'
            );
            expect(button?.type).toBe('button');
            expect(button?.getAttribute('aria-label')).toBe('Go back');
            const back = jest.fn();
            shellFixture.componentInstance.backClicked.subscribe(back);
            button?.click();
            expect(back).toHaveBeenCalledTimes(1);
        }
    );

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

    it('unwinds one level per Escape and consumes handled events', () => {
        const escape = () =>
            requiredQuery('app-portal-detail-shell').dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Escape',
                    bubbles: true,
                    cancelable: true,
                })
            );
        host.playbackActive.set(true);
        fixture.detectChanges();
        expect(escape()).toBe(false);
        expect(host.closeRequests).toBe(1);
        expect(host.backRequests).toBe(0);
        fixture.detectChanges();
        expect(escape()).toBe(false);
        expect(host.backRequests).toBe(1);
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

    it('keeps one labelled back control outside the collapsing hero', async () => {
        const back = requiredQuery('.shell__back-button');
        expect(back.closest('app-content-hero')).toBeNull();
        back.click();
        expect(host.backRequests).toBe(1);
        host.playbackActive.set(true);
        fixture.detectChanges();
        expect(query('.shell__back-button')).toBe(back);
        expect(back.getAttribute('aria-label')).toBe('Close player');
        expect(back.getAttribute('aria-keyshortcuts')).toBe('Escape');
        requiredQuery('.fake-player').tabIndex = 0;
        requiredQuery('.fake-player').focus();
        back.click();
        fixture.detectChanges();
        await fixture.whenStable();
        expect(host.closeRequests).toBe(1);
        expect(host.backRequests).toBe(1);
        expect(document.activeElement).toBe(back);
    });

    it('has no dead-end browse action for a host without back navigation', () => {
        host.backAvailable.set(false);
        fixture.detectChanges();
        expect(query('.shell__back-button')).toBeNull();
        requiredQuery('app-portal-detail-shell').dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
            })
        );
        expect(host.backRequests).toBe(0);
        host.playbackActive.set(true);
        fixture.detectChanges();
        requiredQuery('.shell__back-button').click();
        expect(host.closeRequests).toBe(1);
    });

    it.each([
        'input',
        'textarea',
        'select',
        'div[contenteditable]',
        'div[role=dialog]',
        'div[role=menu]',
    ])('leaves Escape to %s', (selector) => {
        const shell = requiredQuery('app-portal-detail-shell');
        const control = document.createElement(selector.split('[')[0]);
        if (selector.includes('contenteditable'))
            control.setAttribute('contenteditable', 'true');
        if (selector.includes('role='))
            control.setAttribute(
                'role',
                selector.includes('dialog') ? 'dialog' : 'menu'
            );
        shell.append(control);
        control.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
            })
        );
        expect(host.backRequests).toBe(0);
        control.remove();
    });

    it('ignores held Escape and events outside this shell', () => {
        const event = () =>
            new KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
                repeat: true,
            });
        requiredQuery('app-portal-detail-shell').dispatchEvent(event());
        document.body.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
            })
        );
        expect(host.backRequests).toBe(0);
    });

    it.each([false, true])(
        'ignores an inert shell and browser fullscreen (watch=%s)',
        (watch) => {
            host.playbackActive.set(watch);
            fixture.detectChanges();
            const shell = requiredQuery('app-portal-detail-shell');
            const escape = () =>
                shell.dispatchEvent(
                    new KeyboardEvent('keydown', {
                        key: 'Escape',
                        bubbles: true,
                        cancelable: true,
                    })
                );
            shell.setAttribute('inert', '');
            escape();
            shell.removeAttribute('inert');
            const descriptor = Object.getOwnPropertyDescriptor(
                document,
                'fullscreenElement'
            );
            Object.defineProperty(document, 'fullscreenElement', {
                configurable: true,
                value: shell,
            });
            try {
                escape();
            } finally {
                if (descriptor)
                    Object.defineProperty(
                        document,
                        'fullscreenElement',
                        descriptor
                    );
                else Reflect.deleteProperty(document, 'fullscreenElement');
            }
            expect(host.backRequests).toBe(0);
            expect(host.closeRequests).toBe(0);
        }
    );

    it('leaves Escape to a player menu even when focus remains on its trigger', () => {
        host.playbackActive.set(true);
        fixture.detectChanges();
        const menu = document.createElement('div');
        menu.setAttribute('role', 'menu');
        requiredQuery('.fake-player').append(menu);
        requiredQuery('app-portal-detail-shell').dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
            })
        );
        expect(host.closeRequests).toBe(0);
    });
});
