import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ResizableDirective } from './resizable.directive';

@Component({
    imports: [ResizableDirective],
    template: `
        <aside
            appResizable
            [minWidth]="minWidth"
            [maxWidth]="maxWidth"
            [defaultWidth]="defaultWidth"
            [storageKey]="storageKey"
            [handlePosition]="handlePosition"
        ></aside>
    `,
})
class Host {
    minWidth = 200;
    maxWidth = 600;
    defaultWidth = 300;
    storageKey = 'sidebar-width';
    handlePosition: 'right' | 'left' = 'right';
}

describe('ResizableDirective', () => {
    const fixtures: ComponentFixture<Host>[] = [];

    function render(host: Partial<Host> = {}): HTMLElement {
        const fixture = TestBed.createComponent(Host);
        Object.assign(fixture.componentInstance, host);
        fixture.detectChanges();
        fixtures.push(fixture);

        const aside: HTMLElement = fixture.nativeElement.querySelector('aside');
        // jsdom has no layout; a drag starts from the rendered width.
        Object.defineProperty(aside, 'offsetWidth', {
            configurable: true,
            get: () => parseInt(aside.style.width, 10) || 0,
        });
        return aside;
    }

    function drag(aside: HTMLElement, fromX: number, toX: number): void {
        const handle = aside.querySelector('.resize-handle') as HTMLElement;
        handle.dispatchEvent(
            new MouseEvent('mousedown', { clientX: fromX, bubbles: true })
        );
        if (toX !== fromX) {
            document.dispatchEvent(
                new MouseEvent('mousemove', { clientX: toX, bubbles: true })
            );
        }
        document.dispatchEvent(
            new MouseEvent('mouseup', { clientX: toX, bubbles: true })
        );
    }

    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        fixtures.splice(0).forEach((fixture) => fixture.destroy());
        localStorage.clear();
    });

    it('clamps a shared width for rendering without writing it back', () => {
        localStorage.setItem('sidebar-width', '520');

        const settings = render({ minWidth: 200, maxWidth: 400 });

        expect(settings.style.width).toBe('400px');
        expect(localStorage.getItem('sidebar-width')).toBe('520');

        const categories = render({ minWidth: 240, maxWidth: 560 });

        expect(categories.style.width).toBe('520px');
        expect(localStorage.getItem('sidebar-width')).toBe('520');
    });

    it('does not raise a shared width a wider minimum clamps up', () => {
        localStorage.setItem('sidebar-width', '210');

        const favorites = render({ minWidth: 250, maxWidth: 600 });

        expect(favorites.style.width).toBe('250px');
        expect(localStorage.getItem('sidebar-width')).toBe('210');
    });

    it('reads an alias key from the shared width without writing it', () => {
        localStorage.setItem('sidebar-width', '520');

        const panel = render({
            maxWidth: 400,
            storageKey: 'workspace-settings-panel-width',
        });

        expect(panel.style.width).toBe('400px');
        expect(localStorage.getItem('sidebar-width')).toBe('520');
        expect(
            localStorage.getItem('workspace-settings-panel-width')
        ).toBeNull();
    });

    it('migrates the raw legacy width, not the clamped one', () => {
        localStorage.setItem('downloads-sidebar-width', '520');

        const downloads = render({
            maxWidth: 400,
            storageKey: 'downloads-sidebar-width',
        });

        expect(downloads.style.width).toBe('400px');
        expect(localStorage.getItem('sidebar-width')).toBe('520');
        expect(localStorage.getItem('downloads-sidebar-width')).toBeNull();
    });

    it('persists the width a user drags to', () => {
        localStorage.setItem('sidebar-width', '300');
        const aside = render({ maxWidth: 560 });

        drag(aside, 100, 180);

        expect(aside.style.width).toBe('380px');
        expect(localStorage.getItem('sidebar-width')).toBe('380');
    });

    it('persists a left-handle drag on a key of its own', () => {
        localStorage.setItem('live-channels-sidebar-width', '400');
        const aside = render({
            storageKey: 'live-channels-sidebar-width',
            handlePosition: 'left',
        });

        drag(aside, 400, 350);

        expect(aside.style.width).toBe('450px');
        expect(localStorage.getItem('live-channels-sidebar-width')).toBe('450');
        expect(localStorage.getItem('sidebar-width')).toBeNull();
    });

    it('does not persist the clamped width when the handle is only clicked', () => {
        localStorage.setItem('sidebar-width', '520');
        const settings = render({ maxWidth: 400 });

        drag(settings, 100, 100);

        expect(settings.style.width).toBe('400px');
        expect(localStorage.getItem('sidebar-width')).toBe('520');
    });

    it('falls back to the default without writing an unparseable width', () => {
        localStorage.setItem('sidebar-width', 'wide');

        const aside = render({ defaultWidth: 290 });

        expect(aside.style.width).toBe('290px');
        expect(localStorage.getItem('sidebar-width')).toBe('wide');
    });

    it('keeps an unparseable legacy width instead of migrating it', () => {
        localStorage.setItem('downloads-sidebar-width', 'wide');

        const aside = render({
            defaultWidth: 290,
            storageKey: 'downloads-sidebar-width',
        });

        expect(aside.style.width).toBe('290px');
        expect(localStorage.getItem('sidebar-width')).toBeNull();
        expect(localStorage.getItem('downloads-sidebar-width')).toBe('wide');
    });

    it('renders the default without writing when nothing is stored', () => {
        const aside = render({ defaultWidth: 290 });

        expect(aside.style.width).toBe('290px');
        expect(localStorage.getItem('sidebar-width')).toBeNull();
    });
});
