import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { SettingsStore } from '@iptvnator/services';
import { ContentCardComponent } from './content-card.component';

describe('ContentCardComponent', () => {
    let fixture: ComponentFixture<ContentCardComponent>;
    let showCoverTitles: ReturnType<typeof signal<boolean>>;

    beforeEach(async () => {
        showCoverTitles = signal(false);
        await TestBed.configureTestingModule({
            imports: [ContentCardComponent],
            providers: [
                { provide: SettingsStore, useValue: { showCoverTitles } },
                {
                    provide: TranslateService,
                    useValue: {
                        onLangChange: of(),
                        currentLang: 'en',
                        defaultLang: 'en',
                    },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ContentCardComponent);
        fixture.componentRef.setInput('title', 'Blade Runner');
        fixture.componentRef.setInput('posterUrl', 'blade-runner.jpg');
        fixture.componentRef.setInput('type', 'movie');
    });

    const overlay = () =>
        fixture.debugElement.query(By.css('.cover-title-overlay'));
    const info = () => fixture.debugElement.query(By.css('.card-info'));

    it('joins the posters-only wall by default: overlay instead of the info row', () => {
        fixture.detectChanges();

        expect(fixture.nativeElement.classList).toContain(
            'content-card--posters-only'
        );
        expect(info()).toBeNull();
        expect(overlay().nativeElement.textContent.trim()).toBe(
            'Blade Runner'
        );
    });

    it('keeps the info row when the host opts the card out (search results)', () => {
        fixture.componentRef.setInput('allowPostersOnly', false);

        fixture.detectChanges();

        expect(info().nativeElement.textContent).toContain('Blade Runner');
        expect(overlay()).toBeNull();
    });

    it.each(['live', 'radio'])(
        'keeps the info row for %s cards whose logos rarely identify them',
        (type) => {
            fixture.componentRef.setInput('type', type);

            fixture.detectChanges();

            expect(info()).not.toBeNull();
            expect(overlay()).toBeNull();
        }
    );

    it('pins the overlay open for a missing or broken cover', () => {
        fixture.componentRef.setInput('posterUrl', undefined);
        fixture.componentRef.setInput('showPlaceholder', false);
        fixture.detectChanges();
        expect(overlay().nativeElement.classList).toContain(
            'cover-title-overlay--pinned'
        );

        fixture.componentRef.setInput('posterUrl', 'broken.jpg');
        fixture.detectChanges();
        expect(overlay().nativeElement.classList).not.toContain(
            'cover-title-overlay--pinned'
        );

        fixture.debugElement
            .query(By.css('.poster'))
            .nativeElement.dispatchEvent(new Event('error'));
        fixture.detectChanges();

        expect(
            fixture.debugElement
                .query(By.css('.poster'))
                .nativeElement.getAttribute('src')
        ).toContain('default-poster.png');
        expect(overlay().nativeElement.classList).toContain(
            'cover-title-overlay--pinned'
        );
    });

    it('gives a new poster URL a fresh chance after a failed one', () => {
        fixture.componentRef.setInput('posterUrl', 'broken.jpg');
        fixture.detectChanges();
        fixture.debugElement
            .query(By.css('.poster'))
            .nativeElement.dispatchEvent(new Event('error'));
        fixture.detectChanges();

        fixture.componentRef.setInput('posterUrl', 'fixed.jpg');
        fixture.detectChanges();

        expect(
            fixture.debugElement
                .query(By.css('.poster'))
                .nativeElement.getAttribute('src')
        ).toBe('fixed.jpg');
    });

    it('renders the info row while titles are enabled', () => {
        showCoverTitles.set(true);

        fixture.detectChanges();

        expect(fixture.nativeElement.classList).not.toContain(
            'content-card--posters-only'
        );
        expect(info().nativeElement.textContent).toContain('Blade Runner');
        expect(overlay()).toBeNull();
    });

    it('is a keyboard-activatable button named after the item', () => {
        fixture.detectChanges();
        const clicked = jest.fn();
        fixture.componentInstance.cardClick.subscribe(clicked);
        const card = fixture.debugElement.query(By.css('.content-card'));

        expect(card.nativeElement.getAttribute('role')).toBe('button');
        expect(card.nativeElement.getAttribute('tabindex')).toBe('0');
        expect(card.nativeElement.getAttribute('aria-label')).toBe(
            'Blade Runner'
        );

        card.triggerEventHandler('keydown.enter', new KeyboardEvent('keydown'));
        const space = new KeyboardEvent('keydown', {
            key: ' ',
            cancelable: true,
        });
        card.triggerEventHandler('keydown.space', space);

        expect(clicked).toHaveBeenCalledTimes(2);
        expect(space.defaultPrevented).toBe(true);
    });
});
