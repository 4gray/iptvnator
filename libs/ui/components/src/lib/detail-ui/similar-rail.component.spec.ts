import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { SimilarRailComponent } from './similar-rail.component';

describe('SimilarRailComponent', () => {
    let fixture: ComponentFixture<SimilarRailComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [SimilarRailComponent, TranslateModule.forRoot()],
        }).compileComponents();
        fixture = TestBed.createComponent(SimilarRailComponent);
        fixture.componentRef.setInput('title', 'Similar');
        fixture.componentRef.setInput('items', [
            { key: 'a', title: 'Ted K', posterUrl: 'ted.jpg', year: 2021 },
            { key: 'b', title: 'Zodiac', posterUrl: null, year: null, tooltip: 'Backup' },
        ]);
        fixture.detectChanges();
    });

    it('renders the year, no source line, and a letter fallback', () => {
        const host = fixture.nativeElement as HTMLElement;
        const cards = host.querySelectorAll('.similar-card');
        expect(cards).toHaveLength(2);
        expect(cards[0].textContent).toContain('2021');
        expect(cards[1].querySelector('.similar-card__poster--fallback')?.textContent?.trim()).toBe('Z');
        expect(cards[1].getAttribute('title')).toBe('Backup');
        expect(host.textContent).not.toContain('http');
    });

    it('emits the item on click and swaps a broken poster for the fallback', () => {
        const host = fixture.nativeElement as HTMLElement;
        const spy = jest.fn();
        fixture.componentInstance.selected.subscribe(spy);
        host.querySelector<HTMLButtonElement>('.similar-card')!.click();
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ key: 'a' }));

        host.querySelector<HTMLImageElement>('img.similar-card__poster')!.dispatchEvent(new Event('error'));
        fixture.detectChanges();
        expect(host.querySelectorAll('.similar-card__poster--fallback')).toHaveLength(2);
    });
});
