import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MockPipe } from 'ng-mocks';
import { of } from 'rxjs';
import { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { SettingsStore } from '@iptvnator/services';
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
            .compileComponents();

        fixture = TestBed.createComponent(UnifiedGridTabComponent);
        fixture.componentRef.setInput('items', ITEMS);
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
