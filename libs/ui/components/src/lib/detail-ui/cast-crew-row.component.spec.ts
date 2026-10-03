import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import type { TmdbEnrichedCastMember } from '@iptvnator/shared/interfaces';
import { CastCrewRowComponent } from './cast-crew-row.component';

const ACTOR: TmdbEnrichedCastMember = {
    name: 'Ada Vance',
    character: 'Captain',
    tmdbPersonId: 501,
} as TmdbEnrichedCastMember;

describe('CastCrewRowComponent', () => {
    let fixture: ComponentFixture<CastCrewRowComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [CastCrewRowComponent, TranslateModule.forRoot()],
        }).compileComponents();
        fixture = TestBed.createComponent(CastCrewRowComponent);
        fixture.componentRef.setInput('cast', [ACTOR]);
    });

    function person(): HTMLElement {
        const element = (fixture.nativeElement as HTMLElement).querySelector(
            '.person'
        );
        expect(element).not.toBeNull();
        return element as HTMLElement;
    }

    it('offers a person with a TMDB id as a button that opens the actor page', () => {
        const personSelected = jest.fn();
        fixture.componentInstance.personSelected.subscribe(personSelected);
        fixture.detectChanges();

        expect(person().getAttribute('role')).toBe('button');
        expect(person().getAttribute('tabindex')).toBe('0');
        person().click();
        expect(personSelected).toHaveBeenCalledWith(ACTOR);
    });

    it('renders plain entries for a host without an actor page', () => {
        const personSelected = jest.fn();
        fixture.componentInstance.personSelected.subscribe(personSelected);
        fixture.componentRef.setInput('interactive', false);
        fixture.detectChanges();

        // A focusable button that does nothing would mislead mouse and
        // keyboard users alike.
        expect(person().getAttribute('role')).toBeNull();
        expect(person().getAttribute('tabindex')).toBeNull();
        expect(person().classList.contains('person--clickable')).toBe(false);
        person().click();
        expect(personSelected).not.toHaveBeenCalled();
    });
});
