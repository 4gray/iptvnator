import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { provideRouter } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
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

    beforeEach(async () => {
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
                        onLangChange: of(null),
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

    it('renders provider context region and active settings shortcut state', () => {
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

    it('uses the brand control to toggle the rail instead of navigating', () => {
        fixture.detectChanges();

        const brand = fixture.debugElement.query(By.css('.brand'));

        expect(brand.nativeElement.tagName).toBe('BUTTON');
        expect(brand.nativeElement.getAttribute('href')).toBeNull();
        expect(brand.nativeElement.getAttribute('aria-expanded')).toBe('false');

        brand.triggerEventHandler('click');
        fixture.detectChanges();

        expect(fixture.componentInstance.expanded()).toBe(true);
        expect(brand.nativeElement.getAttribute('aria-expanded')).toBe('true');
    });

    it('keeps the horizontal mobile navigation compact', () => {
        const originalMatchMedia = Object.getOwnPropertyDescriptor(
            window,
            'matchMedia'
        );
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: jest.fn().mockReturnValue({ matches: true }),
        });

        try {
            fixture.destroy();
            fixture = TestBed.createComponent(WorkspaceShellRailComponent);
            fixture.detectChanges();

            const brand = fixture.debugElement.query(By.css('.brand'));
            brand.triggerEventHandler('click');
            fixture.detectChanges();

            expect(fixture.componentInstance.expanded()).toBe(false);
            expect(brand.nativeElement.disabled).toBe(true);
            expect(
                brand.nativeElement.getAttribute('aria-expanded')
            ).toBeNull();
            expect(brand.nativeElement.getAttribute('aria-label')).toBeNull();
            expect(brand.injector.get(MatTooltip).disabled).toBe(true);
        } finally {
            if (originalMatchMedia) {
                Object.defineProperty(window, 'matchMedia', originalMatchMedia);
            } else {
                Reflect.deleteProperty(window, 'matchMedia');
            }
        }
    });

    it('closes an expanded rail when the viewport becomes compact', () => {
        let mediaListener: ((event: { matches: boolean }) => void) | undefined;
        const removeEventListener = jest.fn();
        const originalMatchMedia = Object.getOwnPropertyDescriptor(
            window,
            'matchMedia'
        );
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: jest.fn().mockReturnValue({
                matches: false,
                addEventListener: (
                    _type: string,
                    listener: (event: { matches: boolean }) => void
                ) => {
                    mediaListener = listener;
                },
                removeEventListener,
            }),
        });

        try {
            fixture.destroy();
            fixture = TestBed.createComponent(WorkspaceShellRailComponent);
            fixture.componentRef.setInput('expanded', true);
            fixture.detectChanges();

            mediaListener?.({ matches: true });
            fixture.detectChanges();

            expect(fixture.componentInstance.expanded()).toBe(false);
            expect(
                fixture.nativeElement
                    .querySelector('.brand')
                    ?.getAttribute('aria-expanded')
            ).toBeNull();

            fixture.destroy();
            expect(removeEventListener).toHaveBeenCalledWith(
                'change',
                mediaListener
            );
        } finally {
            if (originalMatchMedia) {
                Object.defineProperty(window, 'matchMedia', originalMatchMedia);
            } else {
                Reflect.deleteProperty(window, 'matchMedia');
            }
        }
    });

    it('shows the application and navigation labels while expanded', () => {
        fixture.componentRef.setInput('expanded', true);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.brand-label')?.textContent
        ).toContain('IPTVnator');
        expect(
            fixture.nativeElement
                .querySelector('.rail-shortcut-label')
                ?.textContent.trim()
        ).toBe('WORKSPACE.SHELL.RAIL_SETTINGS');
        expect(
            fixture.nativeElement
                .querySelector('.rail-shortcut-label')
                ?.getAttribute('dir')
        ).toBe('auto');
        expect(
            fixture.nativeElement
                .querySelector('.app-rail')
                ?.classList.contains('is-expanded')
        ).toBe(true);
    });
});
