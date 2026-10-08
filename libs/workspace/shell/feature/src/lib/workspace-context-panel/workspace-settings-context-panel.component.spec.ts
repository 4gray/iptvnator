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
            { id: 'general', label: 'SETTINGS.NAV_GENERAL', icon: 'tune' },
            {
                id: 'playback',
                label: 'SETTINGS.NAV_PLAYBACK',
                icon: 'play_circle',
            },
        ]);
        const fixture = TestBed.createComponent(
            WorkspaceSettingsContextPanelComponent
        );
        fixture.detectChanges();
        const link = (id: string) =>
            (fixture.nativeElement as HTMLElement).querySelector(
                `[data-test-id="settings-section-${id}"]`
            ) as HTMLElement;
        return { ctx, fixture, link };
    }

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
});
