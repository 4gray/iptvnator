import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ExpandableTextComponent } from './expandable-text.component';

describe('ExpandableTextComponent', () => {
    let fixture: ComponentFixture<ExpandableTextComponent>;
    const originalResizeObserver = globalThis.ResizeObserver;

    afterEach(() => {
        Object.defineProperty(globalThis, 'ResizeObserver', {
            configurable: true,
            writable: true,
            value: originalResizeObserver,
        });
    });

    beforeEach(async () => {
        Object.defineProperty(globalThis, 'ResizeObserver', {
            configurable: true,
            writable: true,
            value: undefined,
        });

        await TestBed.configureTestingModule({
            imports: [ExpandableTextComponent, TranslateModule.forRoot()],
        }).compileComponents();

        fixture = TestBed.createComponent(ExpandableTextComponent);
        fixture.componentRef.setInput('text', 'Some long description');
    });

    it('renders the text without a toggle when it does not overflow', () => {
        fixture.detectChanges();

        const host = fixture.nativeElement as HTMLElement;
        expect(host.textContent).toContain('Some long description');
        // JSDOM reports zero heights, so no overflow is detected
        expect(host.querySelector('.expandable-text__toggle')).toBeNull();
    });

    it('shows the toggle when the text overflows and expands on click', () => {
        fixture.detectChanges();

        // Simulate clamped overflow (JSDOM reports zero heights by default)
        // and retrigger the measuring effect via a text change.
        const paragraph = (
            fixture.nativeElement as HTMLElement
        ).querySelector('.expandable-text') as HTMLElement;
        Object.defineProperty(paragraph, 'scrollHeight', {
            value: 120,
            configurable: true,
        });
        Object.defineProperty(paragraph, 'clientHeight', {
            value: 48,
            configurable: true,
        });
        fixture.componentRef.setInput('text', 'Some even longer description');
        fixture.detectChanges();

        const toggle = (fixture.nativeElement as HTMLElement).querySelector(
            '.expandable-text__toggle'
        ) as HTMLButtonElement;
        expect(toggle).toBeTruthy();
        expect(toggle.textContent).toContain('SHOW_MORE');

        toggle.click();
        fixture.detectChanges();

        expect(fixture.componentInstance.isExpanded()).toBe(true);
        expect(
            (fixture.nativeElement as HTMLElement).textContent
        ).toContain('SHOW_LESS');
    });
});
