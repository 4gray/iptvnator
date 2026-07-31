import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ContentHeroComponent } from './content-hero.component';

describe('ContentHeroComponent', () => {
    let fixture: ComponentFixture<ContentHeroComponent>;
    const originalResizeObserver = globalThis.ResizeObserver;

    afterEach(() => {
        Object.defineProperty(globalThis, 'ResizeObserver', {
            configurable: true,
            writable: true,
            value: originalResizeObserver,
        });
    });

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ContentHeroComponent, TranslateModule.forRoot()],
        }).compileComponents();

        fixture = TestBed.createComponent(ContentHeroComponent);
        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', { BACK: 'Go back' });
        translate.use('en');
    });

    it('renders description content when ResizeObserver is unavailable', () => {
        Object.defineProperty(globalThis, 'ResizeObserver', {
            configurable: true,
            writable: true,
            value: undefined,
        });

        fixture.componentRef.setInput('title', 'Fallback_Title');
        fixture.componentRef.setInput('description', 'Plain description');

        expect(() => fixture.detectChanges()).not.toThrow();

        const host = fixture.nativeElement as HTMLElement;
        expect(host.textContent).toContain('Fallback Title');
        expect(host.textContent).toContain('Plain description');
    });

    it('renders an accessible button with the translated fallback back label', () => {
        fixture.detectChanges();

        const back = (fixture.nativeElement as HTMLElement).querySelector(
            '.hero__back-button'
        ) as HTMLButtonElement;
        expect(back.type).toBe('button');
        expect(back.getAttribute('aria-label')).toBe('Go back');
    });

    it('uses an explicit back label when supplied', () => {
        fixture.componentRef.setInput('backLabel', 'Back to downloads');
        fixture.detectChanges();

        const back = (fixture.nativeElement as HTMLElement).querySelector(
            '.hero__back-button'
        ) as HTMLButtonElement;
        expect(back.getAttribute('aria-label')).toBe('Back to downloads');
    });

    it('resets a poster failure when the poster URL changes', () => {
        fixture.componentRef.setInput('posterUrl', 'broken.jpg');
        fixture.detectChanges();
        const first = (fixture.nativeElement as HTMLElement).querySelector(
            'img[src="broken.jpg"]'
        ) as HTMLImageElement;
        first.dispatchEvent(new Event('error'));
        fixture.detectChanges();
        expect(
            (fixture.nativeElement as HTMLElement).querySelector(
                'img[src="broken.jpg"]'
            )
        ).toBeNull();

        fixture.componentRef.setInput('posterUrl', 'replacement.jpg');
        fixture.detectChanges();
        expect(
            (fixture.nativeElement as HTMLElement).querySelector(
                'img[src="replacement.jpg"]'
            )
        ).toBeTruthy();
    });
});
