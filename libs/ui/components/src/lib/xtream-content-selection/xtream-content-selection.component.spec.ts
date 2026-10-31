import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { XtreamContentType } from '@iptvnator/shared/interfaces';
import { XtreamContentSelectionComponent } from './xtream-content-selection.component';

@Component({
    imports: [XtreamContentSelectionComponent],
    template: '<app-xtream-content-selection [(selected)]="selection" />',
})
class Host {
    readonly selection = signal<XtreamContentType[]>(['live']);
}

describe('Xtream catalog choices', () => {
    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot()],
        });
        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            PORTALS: { MOVIES: 'Movies', LIVE_TV: 'Live TV', SERIES: 'Series' },
            HOME: {
                XTREAM_PLAYLIST: {
                    CONTENT_TO_LOAD: 'Content to load',
                    CONTENT_TO_LOAD_HINT: 'Choose catalogs',
                },
            },
        });
        translate.use('en');
    });

    it('starts with every catalog selected in the same order as navigation', () => {
        const fixture = TestBed.createComponent(
            XtreamContentSelectionComponent
        );
        fixture.detectChanges();
        const checkboxes = [
            ...fixture.nativeElement.querySelectorAll('input[type="checkbox"]'),
        ] as HTMLInputElement[];
        expect(checkboxes).toHaveLength(3);
        expect(checkboxes.every((input) => input.checked)).toBe(true);
        expect(
            [...fixture.nativeElement.querySelectorAll('mat-checkbox')].map(
                (element: Element) => element.textContent?.trim()
            )
        ).toEqual(['Movies', 'Live TV', 'Series']);
        expect(
            fixture.nativeElement.querySelector('legend').textContent.trim()
        ).toBe('Content to load');
    });

    it('roundtrips an empty selection and later choices through the parent binding', () => {
        const fixture = TestBed.createComponent(Host);
        fixture.detectChanges();
        const click = (type: string) => {
            (
                fixture.nativeElement.querySelector(
                    `[data-test-id="xtream-load-${type}"] input`
                ) as HTMLInputElement
            ).click();
            fixture.detectChanges();
        };
        click('live');
        expect(fixture.componentInstance.selection()).toEqual([]);
        expect(
            [
                ...fixture.nativeElement.querySelectorAll(
                    'input[type="checkbox"]'
                ),
            ].every((input: HTMLInputElement) => !input.checked)
        ).toBe(true);
        click('series');
        click('movie');
        expect(fixture.componentInstance.selection()).toEqual([
            'movie',
            'series',
        ]);
        expect(
            (
                fixture.nativeElement.querySelector(
                    '[data-test-id="xtream-load-live"] input'
                ) as HTMLInputElement
            ).checked
        ).toBe(false);
    });
});
