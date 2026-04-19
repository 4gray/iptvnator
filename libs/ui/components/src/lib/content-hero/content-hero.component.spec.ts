import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
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
});
