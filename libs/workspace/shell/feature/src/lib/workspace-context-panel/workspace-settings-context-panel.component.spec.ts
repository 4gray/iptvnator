import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import {
    WORKSPACE_HISTORY_NAVIGATION,
    WorkspaceBackNavigationService,
    WorkspaceHistoryNavigation,
} from '@iptvnator/portal/shared/data-access';
import { WorkspaceStartupPreferencesService } from '@iptvnator/workspace/shell/util';
import { SettingsContextService } from '@iptvnator/workspace/shell/util/settings-context';
import { WorkspaceSettingsContextPanelComponent } from './workspace-settings-context-panel.component';

/** Navigation API state of a session that opened on the settings page. */
const firstPageHistory = {
    currentEntry: { index: 0 },
    entries: () => [{ index: 0, sameDocument: true }],
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
} as unknown as WorkspaceHistoryNavigation;

describe('WorkspaceSettingsContextPanelComponent', () => {
    const resolveDashboardPath = jest.fn();

    // Without a Navigation API (jsdom's default) history is unknown, so
    // Back stays the browser's.
    function setup(history: WorkspaceHistoryNavigation | null = null) {
        resolveDashboardPath
            .mockReset()
            .mockResolvedValue('/workspace/dashboard');
        TestBed.configureTestingModule({
            imports: [WorkspaceSettingsContextPanelComponent],
            providers: [
                provideRouter([]),
                { provide: WORKSPACE_HISTORY_NAVIGATION, useValue: history },
                {
                    provide: WorkspaceStartupPreferencesService,
                    useValue: { resolveDashboardPath },
                },
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
        });
        const ctx = TestBed.inject(SettingsContextService);
        ctx.setSections([
            {
                id: 'general',
                label: 'SETTINGS.NAV_GENERAL',
                icon: 'tune',
                group: 'app',
            },
            {
                id: 'playback',
                label: 'SETTINGS.NAV_PLAYBACK',
                icon: 'play_circle',
                group: 'app',
            },
            {
                id: 'backup',
                label: 'SETTINGS.NAV_BACKUP',
                icon: 'backup',
                group: 'data',
            },
            { id: 'about', label: 'SETTINGS.NAV_ABOUT', icon: 'info' },
        ]);
        const fixture = TestBed.createComponent(
            WorkspaceSettingsContextPanelComponent
        );
        fixture.detectChanges();
        const element = fixture.nativeElement as HTMLElement;
        const link = (id: string) =>
            element.querySelector(
                `[data-test-id="settings-section-${id}"]`
            ) as HTMLElement;
        return { ctx, fixture, element, link };
    }

    afterEach(() => {
        TestBed.inject(SettingsContextService).reset();
    });

    it('offers Back in the header, beside the phone drawer toggle', () => {
        const { fixture } = setup();
        const back = jest
            .spyOn(TestBed.inject(Location), 'back')
            .mockImplementation(() => undefined);
        const backNavigation = TestBed.inject(WorkspaceBackNavigationService);

        // The panel carries no footer arrow of its own.
        expect(
            (fixture.nativeElement as HTMLElement).querySelector('button')
        ).toBeNull();
        const target = backNavigation.target();
        // The drawer holds the sections, so its toggle must stay reachable.
        expect(target?.phoneDrawerToggle).toBe('beside');
        expect(target?.label()).toBeNull();
        // Esc leaves settings; the header advertises it on the Back button.
        expect(target?.escapeShortcut()).toBe(true);

        backNavigation.goBack();
        expect(back).toHaveBeenCalledTimes(1);
        expect(resolveDashboardPath).not.toHaveBeenCalled();

        fixture.destroy();
        expect(backNavigation.target()).toBeNull();
    });

    it('leads to the first workspace view when settings opened the session', async () => {
        setup(firstPageHistory);
        const back = jest
            .spyOn(TestBed.inject(Location), 'back')
            .mockImplementation(() => undefined);
        const navigateByUrl = jest
            .spyOn(TestBed.inject(Router), 'navigateByUrl')
            .mockResolvedValue(true);
        resolveDashboardPath.mockResolvedValue('/workspace/sources');

        TestBed.inject(WorkspaceBackNavigationService).goBack();
        await Promise.resolve();
        await Promise.resolve();

        // Location.back() would do nothing in Electron or leave the PWA.
        expect(back).not.toHaveBeenCalled();
        expect(navigateByUrl).toHaveBeenCalledWith('/workspace/sources', {
            replaceUrl: true,
        });
    });

    it('groups the sections and pins ungrouped ones to the footer', () => {
        const { element, link } = setup();

        const groups = Array.from(
            element.querySelectorAll('.settings-nav__group')
        ).map((group) => group.getAttribute('data-group'));
        // Empty groups (library, devices) are left out.
        expect(groups).toEqual(['app', 'data']);
        expect(
            element.querySelector('.settings-nav__footer')?.contains(link('about'))
        ).toBe(true);
        expect(
            element.querySelector('[data-group="app"]')?.contains(link('playback'))
        ).toBe(true);
    });

    it('shows the version beside About, replaced by a badge once an update waits', () => {
        const { ctx, fixture, link } = setup();

        ctx.setVersion('0.25.0');
        fixture.detectChanges();
        expect(
            link('about').querySelector('[data-test-id="settings-nav-version"]')
                ?.textContent
        ).toBe('0.25.0');
        // A long nightly string is truncated; the tooltip keeps all of it.
        expect(
            link('about')
                .querySelector('[data-test-id="settings-nav-version"]')
                ?.getAttribute('title')
        ).toBe('0.25.0');
        expect(link('general').querySelector('.nav-item-version')).toBeNull();

        ctx.setUpdateAvailable(true);
        fixture.detectChanges();
        expect(
            link('about').querySelector(
                '[data-test-id="settings-nav-update-badge"]'
            )
        ).not.toBeNull();
        expect(
            link('about').querySelector('[data-test-id="settings-nav-version"]')
        ).toBeNull();
    });

    it('marks pages holding staged edits', () => {
        const { ctx, fixture, link } = setup();

        ctx.setDirtySections(new Set(['playback']));
        fixture.detectChanges();

        expect(
            link('playback').querySelector(
                '[data-test-id="settings-section-dirty-playback"]'
            )
        ).not.toBeNull();
        expect(link('general').querySelector('.nav-item-dot')).toBeNull();
    });

    it('shows no counts while settings search is idle', () => {
        const { link } = setup();

        expect(link('general').querySelector('.nav-item-meta')).toBeNull();
        expect(link('general').classList).not.toContain('has-no-matches');
    });

    it('shows per-section match counts and mutes sections without matches', () => {
        const { ctx, fixture, link } = setup();

        ctx.setMatchCounts({ general: 2 });
        fixture.detectChanges();

        expect(
            link('general').querySelector('.nav-item-meta')?.textContent
        ).toBe('2');
        expect(
            link('playback').querySelector('.nav-item-meta')?.textContent
        ).toBe('0');
        expect(link('general').classList).not.toContain('has-no-matches');
        expect(link('playback').classList).toContain('has-no-matches');

        ctx.reset();
        fixture.detectChanges();
        expect(ctx.matchCounts()).toBeNull();
    });

    describe('Escape', () => {
        function pressEscape(
            init: KeyboardEventInit = {},
            target?: Element,
            handled = false
        ) {
            const event = new KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
                ...init,
            });
            // An earlier listener (the shell closing its drawer) consumed it.
            if (handled) event.preventDefault();
            (target ?? document.body).dispatchEvent(event);
            return event;
        }

        it('leaves settings like the header Back', () => {
            setup();
            const back = jest
                .spyOn(TestBed.inject(Location), 'back')
                .mockImplementation(() => undefined);

            const event = pressEscape();

            expect(event.defaultPrevented).toBe(true);
            expect(back).toHaveBeenCalledTimes(1);
        });

        it('yields to handled keys, chords, open overlays and text fields', () => {
            setup();
            const back = jest
                .spyOn(TestBed.inject(Location), 'back')
                .mockImplementation(() => undefined);

            pressEscape({}, undefined, true);
            pressEscape({ shiftKey: true });

            const input = document.createElement('input');
            document.body.appendChild(input);
            pressEscape({}, input);
            input.remove();

            const backdrop = document.createElement('div');
            backdrop.className = 'cdk-overlay-backdrop';
            document.body.appendChild(backdrop);
            pressEscape();
            backdrop.remove();

            expect(back).not.toHaveBeenCalled();
        });
    });
});
