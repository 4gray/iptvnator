import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { provideRouter, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { WorkspaceShellRailComponent } from './workspace-shell-rail.component';

@Component({
    selector: 'app-workspace-shell-rail-links',
    template: '',
    standalone: true,
})
class MockWorkspaceShellRailLinksComponent {
    readonly links = input<unknown[]>([]);
    readonly selectedSection = input<string | null>(null);
    readonly activeClass = input('active');
    readonly expanded = input(false);
}

describe('WorkspaceShellRailComponent', () => {
    let fixture: ComponentFixture<WorkspaceShellRailComponent>;
    let languageChanges: Subject<{ lang: string }>;

    beforeEach(async () => {
        languageChanges = new Subject<{ lang: string }>();

        await TestBed.configureTestingModule({
            imports: [WorkspaceShellRailComponent],
            providers: [
                provideRouter([]),
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                        get: (key: string) => of(key),
                        stream: (key: string) => of(key),
                        onLangChange: languageChanges,
                        onTranslationChange: of(null),
                        onDefaultLangChange: of(null),
                        currentLang: 'en',
                        defaultLang: 'en',
                    },
                },
            ],
        })
            .overrideComponent(WorkspaceShellRailComponent, {
                set: {
                    imports: [
                        MatIcon,
                        MatTooltip,
                        MockWorkspaceShellRailLinksComponent,
                        RouterLink,
                        TranslatePipe,
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(WorkspaceShellRailComponent);
    });

    it('renders provider context and the active settings shortcut', () => {
        fixture.componentRef.setInput('primaryContextLinks', [
            {
                icon: 'movie',
                tooltip: 'Movies',
                path: ['/workspace', 'xtreams', 'pl-1', 'vod'],
                section: 'vod',
            },
        ]);
        fixture.componentRef.setInput(
            'railProviderClass',
            'rail-context-region rail-context-region--xtreams'
        );
        fixture.componentRef.setInput('isSettingsRoute', true);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.rail-context-region--xtreams')
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('.rail-shortcut.is-active')
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('.rail-navigation')
        ).not.toBeNull();
    });

    it('uses the triangle control instead of a duplicate dashboard link', () => {
        fixture.detectChanges();

        const toggle = fixture.debugElement.query(By.css('.rail-toggle'));

        expect(toggle.nativeElement.tagName).toBe('BUTTON');
        expect(toggle.nativeElement.getAttribute('href')).toBeNull();
        expect(toggle.nativeElement.getAttribute('aria-expanded')).toBe(
            'false'
        );
        expect(toggle.nativeElement.getAttribute('aria-controls')).toBe(
            'workspace-primary-navigation-content'
        );
        expect(
            fixture.nativeElement
                .querySelector('.rail-toggle-icon')
                .textContent.trim()
        ).toBe('arrow_drop_down');
        expect(fixture.nativeElement.querySelector('.rail-brand')).toBeNull();

        toggle.triggerEventHandler('click');
        fixture.detectChanges();

        expect(fixture.componentInstance.expanded()).toBe(true);
        expect(toggle.nativeElement.getAttribute('aria-expanded')).toBe('true');
        expect(
            fixture.nativeElement
                .querySelector('.rail-toggle-icon')
                .textContent.trim()
        ).toBe('arrow_right');
        expect(
            fixture.nativeElement
                .querySelector('.rail-brand-name')
                .textContent.trim()
        ).toBe('IPTVnator');
        expect(fixture.nativeElement.classList.contains('rail-expanded')).toBe(
            true
        );
    });

    it('rejects an expanded model value while the rail is compact', () => {
        const expandedChanges: boolean[] = [];
        fixture.componentInstance.expanded.subscribe((value) =>
            expandedChanges.push(value)
        );
        fixture.componentInstance.isCompact.set(true);

        fixture.componentRef.setInput('expanded', true);
        fixture.detectChanges();
        TestBed.flushEffects();
        fixture.detectChanges();

        expect(fixture.componentInstance.expanded()).toBe(false);
        expect(expandedChanges).toContain(false);
        expect(
            fixture.nativeElement
                .querySelector('.rail-toggle')
                ?.getAttribute('aria-expanded')
        ).toBeNull();
        expect(
            fixture.nativeElement
                .querySelector('.rail-toggle')
                ?.getAttribute('aria-label')
        ).toBe('WORKSPACE.SHELL.EXPAND_NAVIGATION');
        expect(
            fixture.nativeElement.querySelector<HTMLButtonElement>(
                '.rail-toggle'
            )?.disabled
        ).toBe(true);
    });

    it('aligns navigation from the language direction', () => {
        fixture.detectChanges();
        expect(
            fixture.nativeElement
                .querySelector('.app-rail')
                ?.getAttribute('dir')
        ).toBe('ltr');

        languageChanges.next({ lang: 'ar' });
        fixture.detectChanges();

        expect(
            fixture.nativeElement
                .querySelector('.app-rail')
                ?.getAttribute('dir')
        ).toBe('rtl');
    });
});
