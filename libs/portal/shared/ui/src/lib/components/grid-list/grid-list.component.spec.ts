import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslatePipe } from '@ngx-translate/core';
import { MockPipe } from 'ng-mocks';
import { SettingsStore } from '@iptvnator/services';
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

    it('renders live logo cards with stream icons', () => {
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

        expect(card.nativeElement.classList).toContain('grid-card--logo');
        expect(image.nativeElement.getAttribute('src')).toBe(
            'channel-logo.png'
        );
    });

    it.each(['live', 'vod', 'series'] as const)(
        'does not render a redundant %s type badge in homogeneous grids',
        (type) => {
            fixture.componentRef.setInput('items', [
                { name: 'Catalog item', stream_icon: 'catalog-item.png' },
            ]);
            fixture.componentRef.setInput('type', type);
            fixture.detectChanges();
            expect(
                fixture.debugElement.query(By.css('.type-badge'))
            ).toBeNull();
        }
    );

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

    it('shows the catch-up badge on live cards with a playable archive', () => {
        fixture.componentRef.setInput('items', [
            {
                name: 'Archive Channel',
                stream_icon: 'channel-logo.png',
                tv_archive: 1,
                tv_archive_duration: 7,
            },
        ]);
        fixture.componentRef.setInput('variant', 'logo');
        fixture.componentRef.setInput('type', 'live');

        fixture.detectChanges();

        const badge = fixture.debugElement.query(
            By.css('[data-test-id="grid-catchup-badge"]')
        );
        expect(badge).not.toBeNull();
        expect(badge.nativeElement.textContent).toContain('history');

        // The icon is aria-hidden — the status must also exist as
        // visually-hidden text for assistive technology.
        const srText = badge.query(By.css('.visually-hidden'));
        expect(srText.nativeElement.textContent).toContain(
            'CATCHUP_AVAILABLE'
        );
    });

    it('hides the catch-up badge for live cards without a playable archive', () => {
        fixture.componentRef.setInput('items', [
            { name: 'Flag Only', tv_archive: 1, tv_archive_duration: 0 },
            { name: 'No Archive', tv_archive: 0, tv_archive_duration: 7 },
            { name: 'Legacy Row' },
        ]);
        fixture.componentRef.setInput('type', 'live');

        fixture.detectChanges();

        expect(
            fixture.debugElement.queryAll(
                By.css('[data-test-id="grid-catchup-badge"]')
            )
        ).toHaveLength(0);
    });

    it('never shows the catch-up badge on VOD grids', () => {
        fixture.componentRef.setInput('items', [
            {
                title: 'Some Movie',
                tv_archive: 1,
                tv_archive_duration: 7,
            },
        ]);
        fixture.componentRef.setInput('type', 'vod');

        fixture.detectChanges();

        expect(
            fixture.debugElement.query(
                By.css('[data-test-id="grid-catchup-badge"]')
            )
        ).toBeNull();
    });

    it('renders raw titles while prefix stripping is disabled', () => {
        fixture.componentRef.setInput('items', [{ name: 'US | CNN' }]);
        fixture.componentRef.setInput('type', 'live');

        fixture.detectChanges();

        const title = fixture.debugElement.query(By.css('.title'));
        expect(title.nativeElement.textContent.trim()).toBe('US | CNN');
    });

    it('falls back to a placeholder title for items without a name', () => {
        fixture.componentRef.setInput('items', [{}]);

        fixture.detectChanges();

        const title = fixture.debugElement.query(By.css('.title'));
        expect(title.nativeElement.textContent.trim()).toBe('No name');
    });
});

describe('GridListComponent with strip country prefix enabled', () => {
    let fixture: ComponentFixture<GridListComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [GridListComponent],
            providers: [
                {
                    provide: SettingsStore,
                    useValue: { stripCountryPrefix: signal(true) },
                },
            ],
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

    const renderedTitle = () =>
        fixture.debugElement
            .query(By.css('.title'))
            .nativeElement.textContent.trim();

    it('strips prefixes from live grid titles', () => {
        fixture.componentRef.setInput('items', [{ name: 'US | CNN' }]);
        fixture.componentRef.setInput('type', 'live');

        fixture.detectChanges();

        expect(renderedTitle()).toBe('CNN');
    });

    it('keeps VOD titles untouched', () => {
        fixture.componentRef.setInput('items', [
            { title: 'US | Some Movie' },
        ]);
        fixture.componentRef.setInput('type', 'vod');

        fixture.detectChanges();

        expect(renderedTitle()).toBe('US | Some Movie');
    });
});

describe('GridListComponent posters-only wall', () => {
    let fixture: ComponentFixture<GridListComponent>;
    let showCoverTitles: ReturnType<typeof signal<boolean>>;

    beforeEach(async () => {
        showCoverTitles = signal(false);
        await TestBed.configureTestingModule({
            imports: [GridListComponent],
            providers: [
                {
                    provide: SettingsStore,
                    useValue: { showCoverTitles },
                },
            ],
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

    const overlay = () =>
        fixture.debugElement.query(By.css('.cover-title-overlay'));

    it('replaces the title row with a hover overlay on VOD covers', () => {
        fixture.componentRef.setInput('items', [
            { title: 'Blade Runner', poster_url: 'blade-runner.jpg' },
        ]);
        fixture.componentRef.setInput('type', 'vod');

        fixture.detectChanges();

        expect(fixture.nativeElement.classList).toContain(
            'grid-list--posters-only'
        );
        expect(fixture.debugElement.query(By.css('.title'))).toBeNull();
        expect(overlay().nativeElement.textContent.trim()).toBe(
            'Blade Runner'
        );
        expect(overlay().nativeElement.classList).not.toContain(
            'cover-title-overlay--pinned'
        );
    });

    it('pins the overlay open when the item has no cover to identify it', () => {
        fixture.componentRef.setInput('items', [{ title: 'No Poster Film' }]);
        fixture.componentRef.setInput('type', 'vod');

        fixture.detectChanges();

        expect(overlay().nativeElement.classList).toContain(
            'cover-title-overlay--pinned'
        );
    });

    it('pins the overlay once the cover fails to load', () => {
        fixture.componentRef.setInput('items', [
            { title: 'Broken Poster Film', poster_url: 'broken.jpg' },
        ]);
        fixture.componentRef.setInput('type', 'vod');
        fixture.detectChanges();
        expect(overlay().nativeElement.classList).not.toContain(
            'cover-title-overlay--pinned'
        );

        fixture.debugElement
            .query(By.css('.stream-icon'))
            .nativeElement.dispatchEvent(new Event('error'));
        fixture.detectChanges();

        // The template re-renders the default poster, and the overlay
        // stays open because that poster identifies nothing.
        expect(
            fixture.debugElement
                .query(By.css('.stream-icon'))
                .nativeElement.getAttribute('src')
        ).toContain('default-poster.png');
        expect(overlay().nativeElement.classList).toContain(
            'cover-title-overlay--pinned'
        );
    });

    it('keeps the title row on live channel grids regardless of the setting', () => {
        fixture.componentRef.setInput('items', [
            { name: 'CNN', stream_icon: 'cnn.png' },
        ]);
        fixture.componentRef.setInput('type', 'live');
        fixture.componentRef.setInput('variant', 'logo');

        fixture.detectChanges();

        expect(fixture.nativeElement.classList).not.toContain(
            'grid-list--posters-only'
        );
        expect(
            fixture.debugElement.query(By.css('.title')).nativeElement
                .textContent
        ).toContain('CNN');
        expect(overlay()).toBeNull();
    });

    it('keeps the title row while an in-section search filters the grid', () => {
        fixture.componentRef.setInput('items', [
            { title: 'Blade Runner', poster_url: 'blade-runner.jpg' },
        ]);
        fixture.componentRef.setInput('type', 'vod');
        fixture.componentRef.setInput('searchTerm', 'blade');

        fixture.detectChanges();

        expect(fixture.nativeElement.classList).not.toContain(
            'grid-list--posters-only'
        );
        expect(
            fixture.debugElement.query(By.css('.title')).nativeElement
                .textContent
        ).toContain('Blade Runner');
        expect(overlay()).toBeNull();

        fixture.componentRef.setInput('searchTerm', '   ');
        fixture.detectChanges();

        expect(fixture.debugElement.query(By.css('.title'))).toBeNull();
        expect(overlay()).not.toBeNull();
    });

    it('restores the title row as soon as the setting is switched back on', () => {
        fixture.componentRef.setInput('items', [
            { title: 'Blade Runner', poster_url: 'blade-runner.jpg' },
        ]);
        fixture.componentRef.setInput('type', 'vod');
        fixture.detectChanges();
        expect(fixture.debugElement.query(By.css('.title'))).toBeNull();

        showCoverTitles.set(true);
        fixture.detectChanges();

        expect(
            fixture.debugElement.query(By.css('.title')).nativeElement
                .textContent
        ).toContain('Blade Runner');
        expect(overlay()).toBeNull();
    });
});

describe('GridListComponent keyboard access', () => {
    let fixture: ComponentFixture<GridListComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [GridListComponent],
            providers: [{ provide: SettingsStore, useValue: {} }],
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
        fixture.componentRef.setInput('items', [
            { title: 'Blade Runner', poster_url: 'blade-runner.jpg' },
        ]);
        fixture.componentRef.setInput('type', 'vod');
        fixture.detectChanges();
    });

    it('exposes each card as a focusable button named after the item', () => {
        const card = fixture.debugElement.query(By.css('mat-card'))
            .nativeElement as HTMLElement;

        expect(card.getAttribute('role')).toBe('button');
        expect(card.getAttribute('tabindex')).toBe('0');
        expect(card.getAttribute('aria-label')).toBe('Blade Runner');
        expect(
            fixture.debugElement
                .query(By.css('.stream-icon'))
                .nativeElement.getAttribute('alt')
        ).toBe('Blade Runner');
    });

    it('activates a card with Enter and Space without scrolling the grid', () => {
        const clicked = jest.fn();
        fixture.componentInstance.itemClicked.subscribe(clicked);
        const card = fixture.debugElement.query(By.css('mat-card'));

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
