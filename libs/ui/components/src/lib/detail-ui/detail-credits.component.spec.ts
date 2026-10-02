import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DetailCreditsComponent } from './detail-credits.component';

describe('DetailCreditsComponent', () => {
    let fixture: ComponentFixture<DetailCreditsComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [DetailCreditsComponent, TranslateModule.forRoot()],
        }).compileComponents();
        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            PORTALS: { DETAIL: { STARRING: 'Starring', AND_MORE: 'and more' } },
            XTREAM: { DIRECTOR: 'Director' },
        });
        translate.use('en');
        fixture = TestBed.createComponent(DetailCreditsComponent);
    });

    it('shows three lead names, an "and more" link and the director', () => {
        fixture.componentRef.setInput('cast', ['A', 'B', 'C', 'D']);
        fixture.componentRef.setInput('directors', ['Janus Metz']);
        fixture.detectChanges();
        const host = fixture.nativeElement as HTMLElement;
        const castLine = host.querySelector(
            '[data-test-id="detail-credits-cast"]'
        )?.textContent;
        expect(castLine).toContain('A, B, C');
        expect(castLine).not.toContain('A, B, C, D');
        const more = host.querySelector<HTMLButtonElement>('.credits__more')!;
        const spy = jest.fn();
        fixture.componentInstance.moreRequested.subscribe(spy);
        more.click();
        expect(spy).toHaveBeenCalled();
        expect(
            host.querySelector('[data-test-id="detail-credits-director"]')
                ?.textContent
        ).toContain('Janus Metz');
    });

    it('hides the link when three or fewer names exist and renders nothing when empty', () => {
        fixture.componentRef.setInput('cast', ['A', 'B']);
        fixture.detectChanges();
        const host = fixture.nativeElement as HTMLElement;
        expect(host.querySelector('.credits__more')).toBeNull();
        expect(host.querySelector('[data-test-id="detail-credits-director"]')).toBeNull();
    });
});
