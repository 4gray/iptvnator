import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { EmbeddedMpvDockPanelComponent } from './embedded-mpv-dock-panel.component';
import { EmbeddedMpvDockPanelView } from './embedded-mpv-dock-panels';

const PANEL: EmbeddedMpvDockPanelView = {
    kind: 'audio',
    title: 'Audio tracks',
    chips: Array.from({ length: 12 }, (_, index) => ({
        id: String(index + 1),
        label: `Track ${index + 1} with a fairly long descriptive name`,
        selected: index === 3,
    })),
};

describe('EmbeddedMpvDockPanelComponent', () => {
    let fixture: ComponentFixture<EmbeddedMpvDockPanelComponent>;

    const chipButtons = (): HTMLButtonElement[] =>
        fixture.debugElement
            .queryAll(By.css('.embedded-mpv-dock-panel__chip'))
            .map((chip) => chip.nativeElement);

    const panelRoot = (): HTMLElement =>
        fixture.debugElement.query(By.css('.embedded-mpv-dock-panel'))
            .nativeElement;

    const ribbon = (): HTMLElement =>
        fixture.debugElement.query(By.css('.embedded-mpv-dock-panel__ribbon'))
            .nativeElement;

    const dispatchPanelKey = (key: string): KeyboardEvent => {
        const event = new KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
        });
        (document.activeElement ?? panelRoot()).dispatchEvent(event);
        return event;
    };

    const flushMicrotasks = () => new Promise<void>(queueMicrotask);

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [EmbeddedMpvDockPanelComponent],
        }).compileComponents();

        fixture = TestBed.createComponent(EmbeddedMpvDockPanelComponent);
        fixture.componentRef.setInput('panel', PANEL);
        fixture.componentRef.setInput('backLabel', 'Back');
        fixture.detectChanges();
        await flushMicrotasks();
    });

    afterEach(() => {
        fixture.destroy();
    });

    it('renders chips with tooltips, roving tabindex, and a selected marker', () => {
        const chips = chipButtons();

        expect(chips).toHaveLength(12);
        expect(chips[3].getAttribute('aria-checked')).toBe('true');
        expect(chips[3].tabIndex).toBe(0);
        expect(chips[0].tabIndex).toBe(-1);
        expect(chips[5].getAttribute('title')).toBe(PANEL.chips[5].label);
        expect(chips[3].querySelector('mat-icon')).not.toBeNull();
        expect(chips[0].querySelector('mat-icon')).toBeNull();
    });

    it('focuses the selected chip when the panel opens', () => {
        expect(document.activeElement).toBe(chipButtons()[3]);
    });

    it('walks chips with arrow keys, Home, and End', () => {
        const chips = chipButtons();

        dispatchPanelKey('ArrowRight');
        expect(document.activeElement).toBe(chips[4]);

        dispatchPanelKey('ArrowLeft');
        dispatchPanelKey('ArrowLeft');
        expect(document.activeElement).toBe(chips[2]);

        dispatchPanelKey('End');
        expect(document.activeElement).toBe(chips[11]);
        dispatchPanelKey('ArrowRight');
        expect(document.activeElement).toBe(chips[11]);

        dispatchPanelKey('Home');
        expect(document.activeElement).toBe(chips[0]);
        dispatchPanelKey('ArrowLeft');
        expect(document.activeElement).toBe(chips[0]);
    });

    it('claims arrow keys so document-level shortcuts never see them', () => {
        const documentKeydown = jest.fn();
        document.addEventListener('keydown', documentKeydown);

        const horizontal = dispatchPanelKey('ArrowRight');
        const vertical = dispatchPanelKey('ArrowUp');
        const escape = dispatchPanelKey('Escape');

        expect(horizontal.defaultPrevented).toBe(true);
        expect(vertical.defaultPrevented).toBe(true);
        expect(escape.defaultPrevented).toBe(false);

        const seenKeys = documentKeydown.mock.calls.map(
            ([event]: [KeyboardEvent]) => event.key
        );
        expect(seenKeys).toEqual(['Escape']);

        document.removeEventListener('keydown', documentKeydown);
    });

    it('maps vertical wheel deltas to horizontal ribbon scrolling', () => {
        const ribbonEl = ribbon();
        ribbonEl.scrollLeft = 0;

        const wheel = new WheelEvent('wheel', {
            deltaY: 120,
            deltaX: 0,
            cancelable: true,
        });
        ribbonEl.dispatchEvent(wheel);

        expect(ribbonEl.scrollLeft).toBe(120);
        expect(wheel.defaultPrevented).toBe(true);

        const horizontalSwipe = new WheelEvent('wheel', {
            deltaY: 2,
            deltaX: 40,
            cancelable: true,
        });
        ribbonEl.dispatchEvent(horizontalSwipe);

        expect(ribbonEl.scrollLeft).toBe(120);
        expect(horizontalSwipe.defaultPrevented).toBe(false);
    });

    it('emits chipSelected and closed', () => {
        const selected = jest.fn();
        const closed = jest.fn();
        fixture.componentInstance.chipSelected.subscribe(selected);
        fixture.componentInstance.closed.subscribe(closed);

        chipButtons()[7].click();
        expect(selected).toHaveBeenCalledWith('8');

        fixture.debugElement
            .query(By.css('[data-test-id="embedded-mpv-dock-panel-back"]'))
            .nativeElement.click();
        expect(closed).toHaveBeenCalledTimes(1);
    });

    it('keeps the first chip tabbable when no chip is selected', () => {
        fixture.componentRef.setInput('panel', {
            kind: 'aspect',
            title: 'Aspect ratio',
            chips: PANEL.chips.map((chip) => ({ ...chip, selected: false })),
        });
        fixture.detectChanges();

        const chips = chipButtons();
        expect(chips[0].tabIndex).toBe(0);
        expect(chips[1].tabIndex).toBe(-1);
    });
});
