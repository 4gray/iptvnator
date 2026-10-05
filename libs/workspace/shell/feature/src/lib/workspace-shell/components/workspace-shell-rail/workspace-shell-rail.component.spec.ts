import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
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
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: true,
})
class MockWorkspaceShellRailLinksComponent {
    readonly links = input<unknown[]>([]);
    readonly selectedSection = input<string | null>(null);
    readonly activeClass = input('active');
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
    });

    describe('macOS zoom inset', () => {
        const setWindowWidths = (outer: number, inner: number) => {
            Object.defineProperty(window, 'outerWidth', {
                configurable: true,
                value: outer,
            });
            Object.defineProperty(window, 'innerWidth', {
                configurable: true,
                value: inner,
            });
        };
        const zoomVar = () =>
            (
                fixture.nativeElement.querySelector('.app-rail') as HTMLElement
            ).style.getPropertyValue('--rail-zoom-factor');

        afterEach(() => setWindowWidths(1024, 1024));

        it('publishes the page zoom factor on macOS and follows resize', () => {
            setWindowWidths(1200, 1200);
            fixture.componentRef.setInput('isMacOS', true);
            fixture.detectChanges();
            TestBed.tick();
            fixture.detectChanges();
            expect(zoomVar()).toBe('1');

            // Zoomed out to 50%: the viewport holds twice the CSS pixels.
            setWindowWidths(1200, 2400);
            window.dispatchEvent(new Event('resize'));
            fixture.detectChanges();
            expect(zoomVar()).toBe('0.5');
        });

        it('leaves the inset alone off macOS', () => {
            setWindowWidths(1200, 2400);
            fixture.detectChanges();
            TestBed.tick();
            fixture.detectChanges();
            expect(zoomVar()).toBe('');
        });
    });

    it('has no brand mark duplicating the first workspace link', () => {
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('img')).toBeNull();
        expect(
            fixture.nativeElement.querySelector('.app-rail')?.firstElementChild
                ?.tagName
        ).toBe('APP-WORKSPACE-SHELL-RAIL-LINKS');
    });
});
