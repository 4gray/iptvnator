import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { provideRouter } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ServerStorageStatusService } from '@iptvnator/services';
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

    it('has no brand mark duplicating the first workspace link', () => {
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('img')).toBeNull();
        expect(
            fixture.nativeElement.querySelector('.app-rail')?.firstElementChild
                ?.tagName
        ).toBe('APP-WORKSPACE-SHELL-RAIL-LINKS');
    });

    describe('server status', () => {
        const instance = {
            service: 'iptvnator',
            apiVersion: 1,
            instanceId: 'i',
            storage: 'server',
            auth: 'none',
        } as const;
        const indicator = (): HTMLElement | null =>
            fixture.nativeElement.querySelector(
                '[data-test-id="rail-server-status"]'
            );

        it('hides the indicator without server storage', () => {
            fixture.detectChanges();

            expect(indicator()).toBeNull();
        });

        it('shows the connection state and links to Settings → Server', () => {
            const status = TestBed.inject(ServerStorageStatusService);
            status.activate(instance, () => undefined);
            fixture.detectChanges();

            expect(indicator()?.dataset['state']).toBe('online');
            expect(indicator()?.getAttribute('href')).toBe(
                '/workspace/settings/server'
            );

            status.reportOffline();
            fixture.detectChanges();

            expect(indicator()?.dataset['state']).toBe('offline');
            expect(indicator()?.textContent).toContain('cloud_off');
            expect(indicator()?.getAttribute('aria-label')).toBe(
                'SERVER_STORAGE.STATUS_OFFLINE'
            );
        });
    });
});
