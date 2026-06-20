import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslatePipe } from '@ngx-translate/core';
import { MockPipe } from 'ng-mocks';
import {
    formatGridRating,
    GridListComponent,
    resolveGridRating,
} from './grid-list.component';

describe('grid list rating helpers', () => {
    it('rounds numeric ratings to a single decimal place', () => {
        expect(formatGridRating(7.243)).toBe('7.2');
        expect(formatGridRating('6.529')).toBe('6.5');
        expect(formatGridRating('6')).toBe('6.0');
    });

    it('prefers imdb ratings before generic ratings when both are present', () => {
        expect(
            resolveGridRating({
                rating: '6.529',
                rating_imdb: '7.243',
            })
        ).toBe('7.2');
    });

    it('falls back to the generic rating when imdb rating is blank', () => {
        expect(
            resolveGridRating({
                rating: '5.67',
                rating_imdb: '  ',
            })
        ).toBe('5.7');
    });
});

describe('GridListComponent', () => {
    let fixture: ComponentFixture<GridListComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [GridListComponent],
        })
            .overrideComponent(GridListComponent, {
                remove: { imports: [TranslatePipe] },
                add: {
                    imports: [
                        MockPipe(
                            TranslatePipe,
                            (value: string | null | undefined) => value ?? ''
                        ),
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(GridListComponent);
    });

    it('renders live logo cards with stream icons and a live badge', () => {
        fixture.componentRef.setInput('items', [
            {
                name: 'Live Channel',
                stream_icon: 'channel-logo.png',
            },
        ]);
        fixture.componentRef.setInput('variant', 'logo');
        fixture.componentRef.setInput('type', 'live');

        fixture.detectChanges();

        const card = fixture.debugElement.query(By.css('mat-card'));
        const image = fixture.debugElement.query(By.css('.stream-icon'));
        const badge = fixture.debugElement.query(By.css('.type-badge'));

        expect(card.nativeElement.classList).toContain('grid-card--logo');
        expect(image.nativeElement.getAttribute('src')).toBe(
            'channel-logo.png'
        );
        expect(badge.nativeElement.classList).toContain('live');
        expect(badge.nativeElement.textContent.trim()).toBe('live');
    });

    it('renders the live placeholder for logo cards without artwork', () => {
        fixture.componentRef.setInput('items', [
            {
                name: 'Live Channel Without Logo',
            },
        ]);
        fixture.componentRef.setInput('variant', 'logo');
        fixture.componentRef.setInput('type', 'live');

        fixture.detectChanges();

        const image = fixture.debugElement.query(By.css('.stream-icon'));
        const placeholder = fixture.debugElement.query(
            By.css('.stream-icon-placeholder')
        );
        const placeholderIcon = fixture.debugElement.query(
            By.css('.stream-icon-placeholder mat-icon')
        );

        expect(image).toBeNull();
        expect(placeholder).not.toBeNull();
        expect(placeholderIcon.nativeElement.textContent.trim()).toBe(
            'live_tv'
        );
    });

    it('treats Xtream blank icon URLs as missing live artwork', () => {
        fixture.componentRef.setInput('items', [
            {
                name: 'Live Channel With Blank Icon',
                stream_icon: 'http://example.test/cs/etc/blank-icon.png',
            },
        ]);
        fixture.componentRef.setInput('variant', 'logo');
        fixture.componentRef.setInput('type', 'live');

        fixture.detectChanges();

        const image = fixture.debugElement.query(By.css('.stream-icon'));
        const placeholderIcon = fixture.debugElement.query(
            By.css('.stream-icon-placeholder mat-icon')
        );

        expect(image).toBeNull();
        expect(placeholderIcon.nativeElement.textContent.trim()).toBe(
            'live_tv'
        );
    });

    it('renders the live placeholder when logo artwork fails to load', () => {
        fixture.componentRef.setInput('items', [
            {
                name: 'Live Channel',
                stream_icon: 'broken-channel-logo.png',
            },
        ]);
        fixture.componentRef.setInput('variant', 'logo');
        fixture.componentRef.setInput('type', 'live');

        fixture.detectChanges();

        const image = fixture.debugElement.query(By.css('.stream-icon'));

        image.nativeElement.dispatchEvent(new Event('error'));
        fixture.detectChanges();

        const imageAfterError = fixture.debugElement.query(
            By.css('.stream-icon')
        );
        const placeholderIcon = fixture.debugElement.query(
            By.css('.stream-icon-placeholder mat-icon')
        );

        expect(imageAfterError).toBeNull();
        expect(placeholderIcon.nativeElement.textContent.trim()).toBe(
            'live_tv'
        );
    });
});
