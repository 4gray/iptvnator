import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RevealDetailsDirective } from './reveal-details.directive';

@Component({
    imports: [RevealDetailsDirective],
    template: `<details [appRevealDetails]="reveal()">
        <summary>More</summary>
        <input value="kept" />
    </details>`,
})
class Host {
    readonly reveal = signal<boolean | object | null>(false);
}

describe('RevealDetailsDirective', () => {
    it('reveals new feedback while populated fields already requested opening', () => {
        const fixture = TestBed.createComponent(Host);
        fixture.componentInstance.reveal.set(true);
        fixture.detectChanges();
        const details = fixture.nativeElement.querySelector('details');
        details.open = false;
        fixture.componentInstance.reveal.set({ reason: 'login-required' });
        fixture.detectChanges();
        expect(details.open).toBe(true);
    });

    it('reveals requested fields and leaves native user folding in control', () => {
        const fixture = TestBed.createComponent(Host);
        fixture.detectChanges();
        const details = fixture.nativeElement.querySelector(
            'details'
        ) as HTMLDetailsElement;
        expect(details.open).toBe(false);
        fixture.componentInstance.reveal.set(true);
        fixture.detectChanges();
        expect(details.open).toBe(true);
        details.open = false;
        fixture.detectChanges();
        expect(details.open).toBe(false);
        expect(details.querySelector('input')?.value).toBe('kept');
        fixture.componentInstance.reveal.set(false);
        fixture.detectChanges();
        fixture.componentInstance.reveal.set(true);
        fixture.detectChanges();
        expect(details.open).toBe(true);
    });

    it('does not collapse an open editor when its last optional value is cleared', () => {
        const fixture = TestBed.createComponent(Host);
        fixture.componentInstance.reveal.set(true);
        fixture.detectChanges();
        const details = fixture.nativeElement.querySelector(
            'details'
        ) as HTMLDetailsElement;
        fixture.componentInstance.reveal.set(false);
        fixture.detectChanges();
        expect(details.open).toBe(true);
    });
});
