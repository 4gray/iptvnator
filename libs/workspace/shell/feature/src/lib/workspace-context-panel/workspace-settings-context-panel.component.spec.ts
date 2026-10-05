import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { WorkspaceBackNavigationService } from '@iptvnator/portal/shared/data-access';
import { SettingsContextService } from '@iptvnator/workspace/shell/util/settings-context';
import { WorkspaceSettingsContextPanelComponent } from './workspace-settings-context-panel.component';

describe('WorkspaceSettingsContextPanelComponent', () => {
    function setup() {
        TestBed.configureTestingModule({
            imports: [WorkspaceSettingsContextPanelComponent],
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

        fixture.destroy();
        expect(backNavigation.target()).toBeNull();
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
