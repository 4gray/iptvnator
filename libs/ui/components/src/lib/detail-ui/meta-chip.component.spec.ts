import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MetaChipComponent } from './meta-chip.component';

@Component({
    imports: [MetaChipComponent],
    template: `
        <app-meta-chip data-test-id="plain">2026</app-meta-chip>
        <app-meta-chip variant="rating" data-test-id="rating">★ 7.3</app-meta-chip>
        <app-meta-chip variant="status" data-test-id="status">
            <button type="button" class="meta-chip__facet">Returning</button>
        </app-meta-chip>
    `,
})
class HostComponent {}

describe('MetaChipComponent', () => {
    it('applies the variant classes on the host element', async () => {
        await TestBed.configureTestingModule({
            imports: [HostComponent],
        }).compileComponents();
        const fixture = TestBed.createComponent(HostComponent);
        fixture.detectChanges();
        const host = fixture.nativeElement as HTMLElement;
        const plain = host.querySelector('[data-test-id="plain"]')!;
        const rating = host.querySelector('[data-test-id="rating"]')!;
        const status = host.querySelector('[data-test-id="status"]')!;
        expect(plain.classList.contains('meta-chip')).toBe(true);
        expect(plain.classList.contains('meta-chip--rating')).toBe(false);
        expect(rating.classList.contains('meta-chip--rating')).toBe(true);
        expect(status.classList.contains('meta-chip--status')).toBe(true);
        expect(status.querySelector('button.meta-chip__facet')?.textContent?.trim()).toBe(
            'Returning'
        );
    });
});
