import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
    PlayerUpNextCardComponent,
    UP_NEXT_COLLAPSE_DELAY_MS,
} from './player-up-next-card.component';

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
                    UP_NEXT_IN_SECONDS: 'in {{seconds}} s',
                    UP_NEXT_DISMISS: 'Hide up next',
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
        fixture.componentRef.setInput('remainingSeconds', 6 * 60 + 40);
        fixture.detectChanges();
    });

    afterEach(() => {
        fixture.destroy();
        jest.useRealTimers();
    });

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

    it('counts whole seconds in the last minute', () => {
        fixture.componentRef.setInput('remainingSeconds', 44.2);
        fixture.detectChanges();

        expect(
            query('.player-up-next__eyebrow')?.textContent?.replace(/\s+/g, ' ')
        ).toContain('Up next · in 45 s');
    });

    it('dismisses from the close button and from Escape without reaching the player', () => {
        const dismissed = jest.fn();
        const selected = jest.fn();
        fixture.componentInstance.dismissed.subscribe(dismissed);
        fixture.componentInstance.selected.subscribe(selected);

        const close = query('[data-test-id="player-controls-up-next-close"]');
        expect(close?.getAttribute('aria-label')).toBe('Hide up next');
        close?.click();
        expect(dismissed).toHaveBeenCalledTimes(1);
        expect(selected).not.toHaveBeenCalled();

        const documentListener = jest.fn();
        document.addEventListener('keydown', documentListener);
        const escape = new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
        });
        query('[data-test-id="player-controls-up-next"]')?.dispatchEvent(
            escape
        );
        document.removeEventListener('keydown', documentListener);

        expect(dismissed).toHaveBeenCalledTimes(2);
        expect(documentListener).not.toHaveBeenCalled();
    });

    it('asks to collapse after a while, pausing the count while hovered', () => {
        jest.useFakeTimers();
        fixture.destroy();
        fixture = TestBed.createComponent(PlayerUpNextCardComponent);
        fixture.componentRef.setInput('item', {
            label: 'S01E03',
            title: 'The Third One',
            thumbnailUrl: null,
            progressPercent: null,
        });
        fixture.componentRef.setInput('remainingSeconds', 100);
        fixture.detectChanges();
        const collapse = jest.fn();
        fixture.componentInstance.collapseRequested.subscribe(collapse);

        jest.advanceTimersByTime(UP_NEXT_COLLAPSE_DELAY_MS - 1000);
        fixture.nativeElement.dispatchEvent(new MouseEvent('mouseenter'));
        fixture.detectChanges();
        jest.advanceTimersByTime(UP_NEXT_COLLAPSE_DELAY_MS * 2);
        expect(collapse).not.toHaveBeenCalled();

        // Leaving resumes the remaining second instead of a fresh delay.
        fixture.nativeElement.dispatchEvent(new MouseEvent('mouseleave'));
        fixture.detectChanges();
        jest.advanceTimersByTime(999);
        expect(collapse).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(collapse).toHaveBeenCalledTimes(1);
    });

    it('renders the collapsed pill with the label and without the still or title', () => {
        fixture.componentRef.setInput('collapsed', true);
        fixture.detectChanges();

        expect(fixture.nativeElement.classList).toContain(
            'player-up-next--collapsed'
        );
        expect(query('.player-up-next__thumb')).toBeNull();
        expect(query('.player-up-next__title')).toBeNull();
        expect(
            query('.player-up-next__eyebrow')?.textContent?.replace(/\s+/g, ' ')
        ).toContain('Up next · S01E03 · in 7 min');
    });

    it('gives a new next episode the full collapse delay', () => {
        jest.useFakeTimers();
        fixture.destroy();
        fixture = TestBed.createComponent(PlayerUpNextCardComponent);
        const item = {
            label: 'S01E03',
            title: 'Three',
            thumbnailUrl: null,
            progressPercent: null,
        };
        fixture.componentRef.setInput('item', item);
        fixture.componentRef.setInput('remainingSeconds', 100);
        fixture.detectChanges();
        const collapse = jest.fn();
        fixture.componentInstance.collapseRequested.subscribe(collapse);

        jest.advanceTimersByTime(UP_NEXT_COLLAPSE_DELAY_MS);
        expect(collapse).toHaveBeenCalledTimes(1);
        fixture.componentRef.setInput('collapsed', true);
        fixture.detectChanges();

        // The mounted card now points at the following episode.
        fixture.componentRef.setInput('item', { ...item, label: 'S01E04' });
        fixture.componentRef.setInput('collapsed', false);
        fixture.detectChanges();
        jest.advanceTimersByTime(UP_NEXT_COLLAPSE_DELAY_MS - 1);
        expect(collapse).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(1);
        expect(collapse).toHaveBeenCalledTimes(2);
    });
});
