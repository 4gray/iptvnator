import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DetailSectionHeaderComponent } from './detail-section-header.component';

@Component({
    imports: [DetailSectionHeaderComponent],
    template: `
        <app-detail-section-header
            title="Episodes"
            titleTestId="episodes-heading"
            [count]="count"
        >
            <button section-header-lead class="lead">Season 1</button>
            <span section-header-end class="end">toggle</span>
        </app-detail-section-header>
    `,
})
class HostComponent {
    count: string | number | null = '8 episodes · 3 watched';
}

describe('DetailSectionHeaderComponent', () => {
    function render(count: string | number | null) {
        const fixture = TestBed.createComponent(HostComponent);
        fixture.componentInstance.count = count;
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }

    it('orders title, lead slot, counter and the end slot', () => {
        const host = render('8 episodes · 3 watched');
        const parts = [
            ...host.querySelectorAll('h3, .lead, .section-header__count, .end'),
        ].map((node) => node.textContent?.trim());

        expect(parts).toEqual([
            'Episodes',
            'Season 1',
            '8 episodes · 3 watched',
            'toggle',
        ]);
        expect(host.querySelector('h3')?.getAttribute('data-test-id')).toBe(
            'episodes-heading'
        );
    });

    it('renders no counter without a count', () => {
        expect(render(null).querySelector('.section-header__count')).toBeNull();
        expect(render('').querySelector('.section-header__count')).toBeNull();
        expect(
            render(0).querySelector('.section-header__count')?.textContent
        ).toBe('0');
    });
});
