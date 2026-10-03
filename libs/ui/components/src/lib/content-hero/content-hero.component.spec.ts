import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { HeroTrailerBackdropComponent } from '../detail-ui/hero-trailer-backdrop.component';
import { ContentHeroComponent } from './content-hero.component';

describe('ContentHeroComponent', () => {
    let fixture: ComponentFixture<ContentHeroComponent>;
    const originalResizeObserver = globalThis.ResizeObserver;

    afterEach(() => {
        Object.defineProperty(globalThis, 'ResizeObserver', {
            configurable: true,
            writable: true,
            value: originalResizeObserver,
        });
    });

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ContentHeroComponent, TranslateModule.forRoot()],
        }).compileComponents();

        fixture = TestBed.createComponent(ContentHeroComponent);
        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', { BACK: 'Go back' });
        translate.use('en');
    });

    it('renders description content when ResizeObserver is unavailable', () => {
        Object.defineProperty(globalThis, 'ResizeObserver', {
            configurable: true,
            writable: true,
            value: undefined,
        });

        fixture.componentRef.setInput('title', 'Fallback_Title');
        fixture.componentRef.setInput('description', 'Plain description');

        expect(() => fixture.detectChanges()).not.toThrow();

        const host = fixture.nativeElement as HTMLElement;
        expect(host.textContent).toContain('Fallback Title');
        expect(host.textContent).toContain('Plain description');
    });

    it('resets a poster failure when the poster URL changes', () => {
        fixture.componentRef.setInput('posterUrl', 'broken.jpg');
        fixture.detectChanges();
        const first = (fixture.nativeElement as HTMLElement).querySelector(
            '.poster img[src="broken.jpg"]'
        ) as HTMLImageElement;
        first.dispatchEvent(new Event('error'));
        fixture.detectChanges();
        expect(
            (fixture.nativeElement as HTMLElement).querySelector(
                '.poster img[src="broken.jpg"]'
            )
        ).toBeNull();

        fixture.componentRef.setInput('posterUrl', 'replacement.jpg');
        fixture.detectChanges();
        expect(
            (fixture.nativeElement as HTMLElement).querySelector(
                '.poster img[src="replacement.jpg"]'
            )
        ).toBeTruthy();
    });

    it('keeps an explicit backdrop visible when the poster image fails', () => {
        fixture.componentRef.setInput('posterUrl', 'broken-poster.jpg');
        fixture.componentRef.setInput('backdropUrl', 'working-backdrop.jpg');
        fixture.detectChanges();

        const poster = (fixture.nativeElement as HTMLElement).querySelector(
            'img[src="broken-poster.jpg"]'
        ) as HTMLImageElement;
        poster.dispatchEvent(new Event('error'));
        fixture.detectChanges();

        expect(
            (fixture.nativeElement as HTMLElement).querySelector(
                'img.hero__backdrop-image[src="working-backdrop.jpg"]'
            )
        ).toBeTruthy();
    });

    it('falls back the backdrop independently without hiding a valid poster', () => {
        fixture.componentRef.setInput('posterUrl', 'working-poster.jpg');
        fixture.componentRef.setInput('backdropUrl', 'broken-backdrop.jpg');
        fixture.detectChanges();

        const backdrop = (fixture.nativeElement as HTMLElement).querySelector(
            'img.hero__backdrop-image'
        ) as HTMLImageElement | null;
        expect(backdrop).toBeTruthy();
        backdrop?.dispatchEvent(new Event('error'));
        fixture.detectChanges();

        expect(
            (fixture.nativeElement as HTMLElement).querySelector(
                '.poster img[src="working-poster.jpg"]'
            )
        ).toBeTruthy();
        expect(
            (fixture.nativeElement as HTMLElement).querySelector(
                'img.hero__backdrop-image'
            )
        ).toBeNull();
    });
});

describe('ContentHeroComponent cinematic layout', () => {
    let fixture: ComponentFixture<ContentHeroComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ContentHeroComponent, TranslateModule.forRoot()],
        }).compileComponents();
        fixture = TestBed.createComponent(ContentHeroComponent);
    });

    function host(): HTMLElement {
        return fixture.nativeElement as HTMLElement;
    }

    it('renders the kind label above the title and the resume bar', () => {
        fixture.componentRef.setInput('title', 'Black Harbor');
        fixture.componentRef.setInput('kindLabel', 'Movie · Demo');
        fixture.componentRef.setInput('progress', 63);
        fixture.detectChanges();

        const kind = host().querySelector('[data-test-id="detail-kind"]');
        expect(kind?.textContent?.trim()).toBe('Movie · Demo');
        const title = host().querySelector('.details__title');
        expect(kind?.compareDocumentPosition(title as Node)).toBe(
            Node.DOCUMENT_POSITION_FOLLOWING
        );
        const bar = host().querySelector('[data-test-id="detail-progress"]');
        expect(bar?.getAttribute('aria-valuenow')).toBe('63');
        expect(
            (bar?.querySelector('i') as HTMLElement | null)?.style.width
        ).toBe('63%');
    });

    it('hides the resume bar and kind label when absent', () => {
        fixture.componentRef.setInput('title', 'Black Harbor');
        fixture.detectChanges();
        expect(host().querySelector('[data-test-id="detail-kind"]')).toBeNull();
        expect(
            host().querySelector('[data-test-id="detail-progress"]')
        ).toBeNull();
    });

    it('blurs the poster as backdrop when the backdrop is missing or is the poster', () => {
        fixture.componentRef.setInput('posterUrl', 'poster.jpg');
        fixture.detectChanges();
        expect(
            host().querySelector(
                '.hero__backdrop--blurred img[src="poster.jpg"]'
            )
        ).toBeTruthy();

        fixture.componentRef.setInput('backdropUrl', 'poster.jpg');
        fixture.detectChanges();
        expect(host().querySelector('.hero__backdrop--blurred')).toBeTruthy();

        fixture.componentRef.setInput('backdropUrl', 'wide.jpg');
        fixture.detectChanges();
        expect(host().querySelector('.hero__backdrop--blurred')).toBeNull();
        expect(
            host().querySelector('img.hero__backdrop-image[src="wide.jpg"]')
        ).toBeTruthy();
    });

    it('keeps room for a real backdrop and sizes the hero by content without one', () => {
        fixture.componentRef.setInput('title', 'Poster only');
        fixture.componentRef.setInput('posterUrl', 'poster.jpg');
        fixture.detectChanges();
        expect(host().querySelector('.hero--compact')).toBeTruthy();

        fixture.componentRef.setInput('title', 'With backdrop');
        fixture.componentRef.setInput('backdropUrl', 'wide.jpg');
        fixture.detectChanges();
        expect(host().querySelector('.hero--compact')).toBeNull();

        fixture.componentRef.setInput('title', 'Poster twice');
        fixture.componentRef.setInput('backdropUrl', 'poster.jpg');
        fixture.detectChanges();
        expect(host().querySelector('.hero--compact')).toBeTruthy();
    });

    it('does not grow when enrichment adds a backdrop to the same title', () => {
        fixture.componentRef.setInput('title', 'Late backdrop');
        fixture.componentRef.setInput('posterUrl', 'poster.jpg');
        fixture.detectChanges();
        expect(host().querySelector('.hero--compact')).toBeTruthy();

        fixture.componentRef.setInput('backdropUrl', 'tmdb-wide.jpg');
        fixture.componentRef.setInput('posterUrl', 'tmdb-poster.jpg');
        fixture.detectChanges();
        expect(host().querySelector('.hero--compact')).toBeTruthy();
        expect(
            host().querySelector(
                'img.hero__backdrop-image[src="tmdb-wide.jpg"]'
            )
        ).toBeTruthy();
    });

    it('renders the trailer sound toggle above the content once the trailer plays', () => {
        fixture.componentRef.setInput('title', 'Black Harbor');
        fixture.componentRef.setInput(
            'trailerBackdropUrl',
            'https://www.youtube-nocookie.com/embed/abc123'
        );
        fixture.detectChanges();
        expect(host().querySelector('.hero__trailer-mute')).toBeNull();

        const trailer = fixture.debugElement.query(
            By.directive(HeroTrailerBackdropComponent)
        ).componentInstance as HeroTrailerBackdropComponent;
        trailer.playing.set(true);
        fixture.detectChanges();
        const mute = host().querySelector<HTMLButtonElement>(
            '.hero__trailer-mute'
        );
        expect(mute?.getAttribute('aria-pressed')).toBe('false');
        mute?.click();
        fixture.detectChanges();
        expect(trailer.muted()).toBe(false);
        expect(mute?.getAttribute('aria-pressed')).toBe('true');
    });

    it('keys the layout on the content identity when enrichment renames the title', () => {
        fixture.componentRef.setInput('contentKey', 'm3u:42');
        fixture.componentRef.setInput('title', 'Channel name');
        fixture.componentRef.setInput('posterUrl', 'poster.jpg');
        fixture.detectChanges();
        expect(host().querySelector('.hero--compact')).toBeTruthy();

        // TMDB replaces the title and brings a backdrop: same content.
        fixture.componentRef.setInput('title', 'Proper Title (2021)');
        fixture.componentRef.setInput('backdropUrl', 'wide.jpg');
        fixture.detectChanges();
        expect(host().querySelector('.hero--compact')).toBeTruthy();

        fixture.componentRef.setInput('contentKey', 'm3u:43');
        fixture.detectChanges();
        expect(host().querySelector('.hero--compact')).toBeNull();
    });

    it('places the actions before the credits slot', () => {
        fixture.componentRef.setInput('title', 'Black Harbor');
        fixture.detectChanges();
        const actions = host().querySelector('.action-buttons');
        const meta = host().querySelector('.details__meta');
        expect(actions?.compareDocumentPosition(meta as Node)).toBe(
            Node.DOCUMENT_POSITION_FOLLOWING
        );
    });
});
