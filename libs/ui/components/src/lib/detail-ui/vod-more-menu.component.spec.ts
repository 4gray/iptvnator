import { signal } from '@angular/core';
import {
    VIEW_IN_PORTAL_HANDOFF,
    type ViewInPortalHandoff,
} from '../view-in-portal-action/view-in-portal-handoff.token';
import { OverlayContainer } from '@angular/cdk/overlay';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { VodMoreMenuComponent } from './vod-more-menu.component';
import type { VodMoreMenuSection } from './vod-more-menu.model';

const SECTIONS: VodMoreMenuSection[] = [
    {
        labelKey: 'GROUP_A',
        items: [
            { id: 'copy', labelKey: 'COPY', testId: 'menu-copy' },
            { id: 'sources', labelKey: 'SOURCES', kind: 'sources', hint: 2 },
        ],
    },
    {
        items: [{ id: 'reset', labelKey: 'RESET', disabled: true }],
    },
];

describe('VodMoreMenuComponent', () => {
    let fixture: ComponentFixture<VodMoreMenuComponent>;
    let overlay: HTMLElement;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [VodMoreMenuComponent, TranslateModule.forRoot()],
        }).compileComponents();
        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            GROUP_A: 'Watching',
            COPY: 'Copy stream URL',
            SOURCES: 'Other sources',
            RESET: 'Reset progress',
            BACK: 'Back',
        });
        translate.use('en');
        overlay = TestBed.inject(OverlayContainer).getContainerElement();
        fixture = TestBed.createComponent(VodMoreMenuComponent);
        fixture.componentRef.setInput('sections', SECTIONS);
        fixture.componentRef.setInput('label', 'More');
        fixture.componentRef.setInput('testId', 'more');
        fixture.detectChanges();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    function trigger(): HTMLButtonElement {
        return (fixture.nativeElement as HTMLElement).querySelector(
            '[data-testid="more"]'
        )!;
    }

    function rows(): HTMLButtonElement[] {
        return Array.from(
            overlay.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
        );
    }

    it('opens on click with groups, hints and disabled rows, and emits the chosen id', () => {
        trigger().click();
        fixture.detectChanges();
        expect(trigger().getAttribute('aria-expanded')).toBe('true');
        expect(overlay.querySelector('[role="menu"]')).toBeTruthy();
        expect(overlay.textContent).toContain('Watching');
        expect(overlay.textContent).toContain('Other sources');
        expect(
            overlay.querySelector('.more-menu__hint')?.textContent?.trim()
        ).toBe('2');
        const reset = rows().find((row) => row.textContent?.includes('Reset'))!;
        expect(reset.disabled).toBe(true);

        const spy = jest.fn();
        fixture.componentInstance.selected.subscribe(spy);
        overlay
            .querySelector<HTMLButtonElement>('[data-test-id="menu-copy"]')!
            .click();
        fixture.detectChanges();
        expect(spy).toHaveBeenCalledWith('copy');
        expect(overlay.querySelector('[role="menu"]')).toBeNull();
    });

    it('moves focus with the arrow keys and closes on Escape', () => {
        trigger().click();
        fixture.detectChanges();
        const [first, second] = rows();
        first.focus();
        const menu = overlay.querySelector<HTMLElement>('[role="menu"]')!;
        menu.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
        );
        expect(document.activeElement).toBe(second);
        menu.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })
        );
        expect(document.activeElement).toBe(first);

        menu.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
        fixture.detectChanges();
        expect(fixture.componentInstance.isOpen()).toBe(false);
    });

    it('switches to the sources panel, moves focus into it, and back', async () => {
        fixture.componentRef.setInput('sources', []);
        trigger().click();
        fixture.detectChanges();
        rows()
            .find((row) => row.textContent?.includes('Other sources'))!
            .click();
        fixture.detectChanges();
        expect(fixture.componentInstance.view()).toBe('sources');
        expect(overlay.querySelector('app-vod-sources-menu')).toBeTruthy();
        // The focused row is gone; keyboard focus lands on the panel's first control.
        await new Promise((resolve) => setTimeout(resolve));
        expect(document.activeElement).toBe(
            overlay.querySelector('.more-menu__back')
        );
        overlay.querySelector<HTMLButtonElement>('.more-menu__back')!.click();
        fixture.detectChanges();
        expect(fixture.componentInstance.view()).toBe('menu');
    });

    it('disables the trigger when there are no rows', () => {
        fixture.componentRef.setInput('sections', [{ items: [] }]);
        fixture.detectChanges();
        expect(trigger().disabled).toBe(true);
        expect(fixture.componentInstance.menuSections()).toEqual([]);
    });
});

describe('VodMoreMenuComponent collection portal handoff', () => {
    const available = signal(true);
    const playlistName = signal<string | null>('My Portal');
    const openInPortal = jest.fn();
    let fixture: ComponentFixture<VodMoreMenuComponent>;
    let overlay: HTMLElement;

    beforeEach(async () => {
        available.set(true);
        playlistName.set('My Portal');
        openInPortal.mockClear();
        const handoff: ViewInPortalHandoff = {
            viewInPortalAvailable: available,
            viewInPortalPlaylistName: playlistName,
            openInPortal,
        };
        await TestBed.configureTestingModule({
            imports: [VodMoreMenuComponent, TranslateModule.forRoot()],
            providers: [{ provide: VIEW_IN_PORTAL_HANDOFF, useValue: handoff }],
        }).compileComponents();
        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            PORTALS: {
                VIEW_IN_PORTAL: 'View in portal',
                VIEW_IN_PORTAL_TOOLTIP: 'Open in {{name}}',
            },
        });
        translate.use('en');
        overlay = TestBed.inject(OverlayContainer).getContainerElement();
        fixture = TestBed.createComponent(VodMoreMenuComponent);
        fixture.componentRef.setInput('sections', []);
        fixture.componentRef.setInput('label', 'More');
        fixture.detectChanges();
    });

    function openMenu(): void {
        fixture.nativeElement.querySelector('button').click();
        fixture.detectChanges();
    }

    function portalRow(): HTMLButtonElement | null {
        return overlay.querySelector('[data-menu-item="view-in-portal"]');
    }

    it('keeps the handoff inside the menu even when it is the only action', () => {
        expect(fixture.nativeElement.textContent).not.toContain(
            'Open in My Portal'
        );
        expect(fixture.nativeElement.querySelector('button').disabled).toBe(
            false
        );
        openMenu();
        expect(portalRow()?.getAttribute('role')).toBe('menuitem');
        expect(portalRow()?.textContent).toContain('Open in My Portal');
        const selected = jest.fn();
        fixture.componentInstance.selected.subscribe(selected);
        portalRow()!.click();
        fixture.detectChanges();
        expect(openInPortal).toHaveBeenCalledTimes(1);
        expect(selected).not.toHaveBeenCalled();
        expect(overlay.querySelector('[role="menu"]')).toBeNull();
        expect(document.activeElement).toBe(
            fixture.nativeElement.querySelector('button')
        );
    });

    it('uses the generic label when the source name is absent', () => {
        playlistName.set(null);
        fixture.detectChanges();
        openMenu();
        expect(portalRow()?.textContent).toContain('View in portal');
    });

    it('omits unavailable targets and reacts when availability changes', () => {
        available.set(false);
        fixture.componentRef.setInput('sections', SECTIONS);
        fixture.detectChanges();
        openMenu();
        expect(portalRow()).toBeNull();
        available.set(true);
        fixture.detectChanges();
        expect(portalRow()).not.toBeNull();
        available.set(false);
        fixture.detectChanges();
        expect(portalRow()).toBeNull();
    });

    it('disables an empty menu when its only handoff is unavailable', () => {
        available.set(false);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('button').disabled).toBe(
            true
        );
    });

    it('does not navigate if the target becomes unavailable before selection', () => {
        openMenu();
        const row = portalRow()!;
        available.set(false);
        row.click();
        expect(openInPortal).not.toHaveBeenCalled();
    });

    it('places navigation before the existing action groups without losing their events', () => {
        fixture.componentRef.setInput('sections', SECTIONS);
        fixture.detectChanges();
        openMenu();
        expect(overlay.querySelector('[role="menuitem"]')).toBe(portalRow());
        const selected = jest.fn();
        fixture.componentInstance.selected.subscribe(selected);
        overlay
            .querySelector<HTMLButtonElement>('[data-test-id="menu-copy"]')!
            .click();
        expect(selected).toHaveBeenCalledWith('copy');
        expect(openInPortal).not.toHaveBeenCalled();
    });
});
