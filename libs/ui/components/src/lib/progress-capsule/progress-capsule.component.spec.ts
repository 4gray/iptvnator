import { ComponentFixture, TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ProgressCapsuleComponent } from './progress-capsule.component';

describe('ProgressCapsuleComponent', () => {
    let fixture: ComponentFixture<ProgressCapsuleComponent>;

    function render(progress: number): HTMLElement {
        fixture = TestBed.createComponent(ProgressCapsuleComponent);
        fixture.componentRef.setInput('progress', progress);
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }

    it('fills the capsule to the watched share', () => {
        const host = render(42);

        expect(
            host.querySelector<HTMLElement>('.progress-capsule__fill')?.style
                .width
        ).toBe('42%');
        expect(host.querySelector('.progress-capsule--watched')).toBeNull();
    });

    it('marks an item watched from 90 %', () => {
        expect(
            render(90).querySelector('.progress-capsule--watched')
        ).not.toBeNull();
    });

    // The capsule sits in app chrome (catalog grids, season episodes), so its
    // fill is the theme's watch-progress token, like the dashboard rail card.
    it('draws progress with the app watch-progress token', () => {
        const source = readFileSync(
            resolve(
                process.cwd(),
                'libs/ui/components/src/lib/progress-capsule/progress-capsule.component.ts'
            ),
            'utf8'
        );
        const fill = source.match(/&__fill\s*\{([^}]*)\}/)?.[1] ?? '';

        expect(fill).toMatch(/background:\s*var\(--app-progress-color\);/);
        expect(source).not.toMatch(/#e50914|#ff4d4d/i);
    });
});
