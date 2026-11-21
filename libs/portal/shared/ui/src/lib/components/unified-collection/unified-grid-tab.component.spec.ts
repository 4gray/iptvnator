import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MockPipe } from 'ng-mocks';
import { EMPTY, of } from 'rxjs';
import { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { SettingsStore } from '@iptvnator/services';
import { ContentCardComponent } from '../content-card/content-card.component';
import { UnifiedGridTabComponent } from './unified-grid-tab.component';

const ITEMS: UnifiedCollectionItem[] = [
    {
        uid: 'x:1:movie:1',
        name: 'Blade Runner',
        contentType: 'movie',
        posterUrl: 'blade-runner.jpg',
    } as UnifiedCollectionItem,
    {
        uid: 'x:1:movie:2',
        name: 'Alien',
        contentType: 'movie',
        posterUrl: 'alien.jpg',
    } as UnifiedCollectionItem,
];

describe('UnifiedGridTabComponent posters-only wall', () => {
    let fixture: ComponentFixture<UnifiedGridTabComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [UnifiedGridTabComponent],
            providers: [
                {
                    provide: SettingsStore,
                    useValue: { showCoverTitles: signal(false) },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        onLangChange: of(),
                        onDefaultLangChange: EMPTY,
                        onTranslationChange: EMPTY,
                        currentLang: 'en',
                        defaultLang: 'en',
                    },
                },
            ],
        })
            .overrideComponent(UnifiedGridTabComponent, {
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
            // The card's favourite toggle translates its own label.
            .overrideComponent(ContentCardComponent, {
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

        fixture = TestBed.createComponent(UnifiedGridTabComponent);
        fixture.componentRef.setInput('items', ITEMS);
    });

    it('offers the favourite toggle only on recent M3U cards', () => {
        const film = {
            uid: 'm3u::pl-1::http://h.example/movie/u/p/1.mkv',
            name: 'Sandline',
            contentType: 'movie',
            sourceType: 'm3u',
            streamUrl: 'http://h.example/movie/u/p/1.mkv',
        } as UnifiedCollectionItem;
        const portalFilm = { ...ITEMS[0], sourceType: 'xtream' };
        const toggles = () =>
            fixture.debugElement.queryAll(
                By.css('[data-testid="content-card-favorite-toggle"]')
            );
        fixture.componentRef.setInput('items', [film, portalFilm]);
        fixture.detectChanges();
        // Favorites mode already has Remove; a second control would be noise.
        expect(toggles()).toHaveLength(0);

        fixture.componentRef.setInput('mode', 'recent');
        fixture.detectChanges();
        const toggled = jest.fn();
        const selected = jest.fn();
        fixture.componentInstance.favoriteToggled.subscribe(toggled);
        fixture.componentInstance.itemSelected.subscribe(selected);

        expect(toggles()).toHaveLength(1);
        const button = toggles()[0].nativeElement as HTMLButtonElement;
        expect(button.getAttribute('aria-pressed')).toBe('false');
        expect(button.getAttribute('aria-label')).toBe(
            'PORTALS.ADD_TO_FAVORITES'
        );
        button.click();
        expect(toggled).toHaveBeenCalledWith(film);
        // The toggle must not double as opening the card.
        expect(selected).not.toHaveBeenCalled();

        fixture.componentRef.setInput('favoriteUids', new Set([film.uid]));
        fixture.detectChanges();
        expect(button.getAttribute('aria-pressed')).toBe('true');
        expect(button.getAttribute('aria-label')).toBe(
            'PORTALS.REMOVE_FROM_FAVORITES'
        );
    });

    it('retains the title and removal action while blocking an unavailable favorite', () => {
        const item = {
            ...ITEMS[0],
            catalogStatus: 'missing',
        } as UnifiedCollectionItem;
        fixture.componentRef.setInput('items', [item]);
        fixture.detectChanges();
        const selected = jest.fn();
        const removed = jest.fn();
        fixture.componentInstance.itemSelected.subscribe(selected);
        fixture.componentInstance.removeItem.subscribe(removed);

        fixture.componentInstance.onCardClick(item);
        fixture.componentInstance.onRemove(item);

        expect(selected).not.toHaveBeenCalled();
        expect(removed).toHaveBeenCalledWith(item);
        expect(fixture.nativeElement.textContent).toContain(
            'WORKSPACE.GLOBAL_FAVORITES.CATALOG_MISSING'
        );
        expect(fixture.debugElement.query(By.css('.card-info'))).not.toBeNull();
    });

    const cardInfos = () => fixture.debugElement.queryAll(By.css('.card-info'));
    const overlays = () =>
        fixture.debugElement.queryAll(By.css('.cover-title-overlay'));

    it('hides titles behind the overlay while nothing is being searched', () => {
        fixture.detectChanges();

        expect(cardInfos()).toHaveLength(0);
        expect(overlays()).toHaveLength(2);
    });

    it('keeps titles visible while a search term filters the collection', () => {
        fixture.componentRef.setInput('searchTerm', 'blade');
        fixture.detectChanges();

        expect(cardInfos()).toHaveLength(1);
        expect(cardInfos()[0].nativeElement.textContent).toContain(
            'Blade Runner'
        );
        expect(overlays()).toHaveLength(0);

        fixture.componentRef.setInput('searchTerm', '  ');
        fixture.detectChanges();

        expect(cardInfos()).toHaveLength(0);
        expect(overlays()).toHaveLength(2);
    });
});
