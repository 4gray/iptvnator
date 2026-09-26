import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PlayerUpNextCardComponent } from './player-up-next-card.component';

describe('PlayerUpNextCardComponent', () => {
    let fixture: ComponentFixture<PlayerUpNextCardComponent>;

    const query = (selector: string) =>
        fixture.nativeElement.querySelector(selector) as HTMLElement | null;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [PlayerUpNextCardComponent, TranslateModule.forRoot()],
        }).compileComponents();
        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            EMBEDDED_MPV: {
                PLAYER: {
                    UP_NEXT: 'Up next',
                    UP_NEXT_IN: 'in {{minutes}} min',
                },
            },
        });
        translate.use('en');
        fixture = TestBed.createComponent(PlayerUpNextCardComponent);
        fixture.componentRef.setInput('item', {
            label: 'S01E03',
            title: 'The Third One',
            thumbnailUrl: 'https://img.example/still.jpg',
            progressPercent: 40,
        });
        fixture.componentRef.setInput('minutesLeft', 7);
        fixture.detectChanges();
    });

    afterEach(() => fixture.destroy());

    it('renders the still, progress, countdown and title, and names itself', () => {
        expect(query('.player-up-next__image')?.getAttribute('src')).toBe(
            'https://img.example/still.jpg'
        );
        expect(query('.player-up-next__progress-bar')?.style.width).toBe('40%');
        expect(
            query('.player-up-next__eyebrow')?.textContent?.replace(/\s+/g, ' ')
        ).toContain('Up next · in 7 min');
        expect(query('.player-up-next__title')?.textContent?.trim()).toBe(
            'The Third One'
        );
        expect(
            query('[data-test-id="player-controls-up-next"]')?.getAttribute(
                'aria-label'
            )
        ).toBe('Up next: S01E03 – The Third One');
        expect(query('.player-up-next__icon')).not.toBeNull();
    });

    it('falls back to the label tile without a still and hides the icon when compact', () => {
        fixture.componentRef.setInput('item', {
            label: 'S02E01',
            title: '',
            thumbnailUrl: null,
            progressPercent: null,
        });
        fixture.componentRef.setInput('compact', true);
        fixture.detectChanges();

        expect(query('.player-up-next__image')).toBeNull();
        expect(query('.player-up-next__placeholder')?.textContent?.trim()).toBe(
            'S02E01'
        );
        expect(query('.player-up-next__progress')).toBeNull();
        expect(query('.player-up-next__title')?.textContent?.trim()).toBe(
            'S02E01'
        );
        expect(query('.player-up-next__icon')).toBeNull();
        expect(fixture.nativeElement.classList).toContain(
            'player-up-next--compact'
        );
    });

    it('falls back to the label tile when the still fails, and retries a new URL', () => {
        query('.player-up-next__image')?.dispatchEvent(new Event('error'));
        fixture.detectChanges();
        expect(query('.player-up-next__image')).toBeNull();
        expect(query('.player-up-next__placeholder')?.textContent?.trim()).toBe(
            'S01E03'
        );

        fixture.componentRef.setInput('item', {
            label: 'S01E04',
            title: 'Four',
            thumbnailUrl: 'https://img.example/other.jpg',
            progressPercent: null,
        });
        fixture.detectChanges();
        expect(query('.player-up-next__image')?.getAttribute('src')).toBe(
            'https://img.example/other.jpg'
        );
    });

    it('emits on click', () => {
        const selected = jest.fn();
        fixture.componentInstance.selected.subscribe(selected);

        query('[data-test-id="player-controls-up-next"]')?.click();

        expect(selected).toHaveBeenCalledTimes(1);
    });
});
