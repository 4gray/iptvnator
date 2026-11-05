import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, of } from 'rxjs';
import { EpgGuideScope } from './epg-guide-source';
import { EpgGuideToolbarComponent } from './epg-guide-toolbar.component';

const SCOPES: EpgGuideScope[] = [
    { id: 'all', label: 'All channels', kind: 'all' },
    { id: 'favorites', label: 'Favorites', kind: 'favorites' },
    { id: 'group:news', label: 'News', kind: 'group' },
];

describe('EpgGuideToolbarComponent scope menu', () => {
    function render(scopeId: string) {
        TestBed.configureTestingModule({
            imports: [EpgGuideToolbarComponent],
            providers: [
                {
                    provide: TranslateService,
                    useValue: {
                        currentLang: 'en',
                        defaultLang: 'en',
                        onLangChange: new BehaviorSubject(null),
                        onTranslationChange: new BehaviorSubject(null),
                        onDefaultLangChange: new BehaviorSubject(null),
                        instant: (key: string) => key,
                        get: (key: string) => of(key),
                        stream: (key: string) => of(key),
                    },
                },
            ],
        });
        const fixture = TestBed.createComponent(EpgGuideToolbarComponent);
        fixture.componentRef.setInput('dayMs', Date.UTC(2026, 9, 14));
        fixture.componentRef.setInput('scopes', SCOPES);
        fixture.componentRef.setInput('scopeId', scopeId);
        fixture.detectChanges();
        const trigger = fixture.nativeElement.querySelector(
            '.guide-toolbar__scope'
        ) as HTMLButtonElement;
        trigger.click();
        fixture.detectChanges();
        const rows = Array.from(
            document.querySelectorAll<HTMLElement>(
                '.cdk-overlay-container [mat-menu-item]'
            )
        );
        return { fixture, rows };
    }

    it('marks the chosen scope as the checked single-choice row', () => {
        const { rows } = render('favorites');

        expect(rows.map((row) => row.getAttribute('role'))).toEqual([
            'menuitemradio',
            'menuitemradio',
            'menuitemradio',
        ]);
        expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual([
            'false',
            'true',
            'false',
        ]);
        expect(rows.map((row) => row.textContent?.trim())).toEqual([
            'check All channels',
            'check Favorites',
            'check News',
        ]);
    });

    it('shows the check on the chosen row only, keeping every label on one edge', () => {
        const { rows } = render('group:news');

        const checks = rows.map(
            (row) =>
                (row.querySelector('.app-menu-item-radio-check') as HTMLElement)
                    .style.visibility
        );
        expect(checks).toEqual(['hidden', 'hidden', '']);
    });

    it('names the trigger with the scope it shows', () => {
        const { fixture } = render('favorites');

        const trigger = fixture.nativeElement.querySelector(
            '.guide-toolbar__scope'
        ) as HTMLButtonElement;
        expect(trigger.getAttribute('aria-label')).toBe(
            'EPG.GUIDE.SCOPE: Favorites'
        );
        expect(trigger.textContent).toContain('Favorites');
    });

    it('reports the picked scope', () => {
        const { fixture, rows } = render('all');
        const picked: string[] = [];
        fixture.componentInstance.scopeChange.subscribe((id) =>
            picked.push(id)
        );

        rows[2].click();

        expect(picked).toEqual(['group:news']);
    });
});
