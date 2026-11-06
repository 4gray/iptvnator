import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DashboardRailSkeletonComponent } from './dashboard-rail-skeleton.component';
import { SKELETON_CARDS_PER_RAIL } from './dashboard-rail.utils';

function geometryMixins(file: string): Set<string> {
    const source = readFileSync(resolve(__dirname, file), 'utf8');
    return new Set(
        [...source.matchAll(/@include geometry\.([\w-]+)/g)].map(
            ([, name]) => name
        )
    );
}

describe('DashboardRailSkeletonComponent', () => {
    let fixture: ComponentFixture<DashboardRailSkeletonComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [DashboardRailSkeletonComponent],
        }).compileComponents();
        fixture = TestBed.createComponent(DashboardRailSkeletonComponent);
    });

    const cards = (selector: string): HTMLElement[] => [
        ...fixture.nativeElement.querySelectorAll(selector),
    ];

    it('stands in for a cover rail with artwork, a title line and a meta line', () => {
        fixture.componentRef.setInput(
            'testId',
            'dashboard-xtream-recently-added-rail-skeleton'
        );
        fixture.detectChanges();

        const section: HTMLElement =
            fixture.nativeElement.querySelector('.rail-skeleton');
        expect(section.getAttribute('aria-hidden')).toBe('true');
        expect(section.dataset['testId']).toBe(
            'dashboard-xtream-recently-added-rail-skeleton'
        );
        const covers = cards('.rail-skeleton__card');
        expect(covers).toHaveLength(SKELETON_CARDS_PER_RAIL.length);
        expect(
            covers.every(
                (card) =>
                    (card.querySelector('.rail-skeleton__art') as HTMLElement)
                        .style.aspectRatio === '2 / 3' &&
                    card.querySelector('.rail-skeleton__line--title') &&
                    card.querySelector('.rail-skeleton__line--meta')
            )
        ).toBe(true);
    });

    it('takes the artwork ratio of the rail it precedes', () => {
        fixture.componentRef.setInput('aspectRatio', '16 / 9');
        fixture.detectChanges();

        expect(
            cards('.rail-skeleton__art').map((art) => art.style.aspectRatio)
        ).toEqual(SKELETON_CARDS_PER_RAIL.map(() => '16 / 9'));
    });

    it('draws channel cards for a live channel rail', () => {
        fixture.componentRef.setInput('layout', 'channel');
        fixture.detectChanges();

        expect(cards('.rail-skeleton__card--channel')).toHaveLength(
            SKELETON_CARDS_PER_RAIL.length
        );
        expect(cards('.rail-skeleton__art')).toHaveLength(0);
        expect(
            fixture.nativeElement
                .querySelector('.rail-skeleton__track')
                .getAttribute('data-layout')
        ).toBe('channel');
    });

    // The skeleton is only as tall as the rail while both take their boxes
    // from the shared geometry partial; a value inlined in either drifts.
    it('sizes every box with the geometry mixins the rail itself uses', () => {
        const rail = geometryMixins('dashboard-rail.component.scss');
        const skeleton = geometryMixins(
            'dashboard-rail-skeleton.component.scss'
        );

        expect(skeleton.size).toBeGreaterThan(10);
        expect([...skeleton].filter((name) => !rail.has(name))).toEqual([]);
    });
});
