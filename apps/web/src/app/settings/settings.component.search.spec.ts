import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { Router } from '@angular/router';
import { SettingsContextService } from '@iptvnator/workspace/shell/util/settings-context';
import {
    SETTINGS_SEARCH_ENTRIES,
    SettingsSearchEntry,
    SettingsSearchService,
} from '@iptvnator/workspace/shell/util/settings-search';
import { SettingsComponent } from './settings.component';
import { SETTINGS_REVEALED_CLASS } from './settings-search.facade';
import {
    configureSettingsComponentTestBed,
    createElectronStub,
    createEpgBridgeStub,
    MockRouter,
    setSettingsSearchQuery,
    setSettingsSection,
    stubSettingsSideEffects,
} from './test-stubs/settings-test-harness.stub';

function entry(id: string): SettingsSearchEntry {
    const found = SETTINGS_SEARCH_ENTRIES.find((item) => item.id === id);
    if (!found) {
        throw new Error(`unknown settings entry ${id}`);
    }
    return found;
}

/**
 * Settings search on the page: the shell writes the header term to `q`,
 * the page swaps the section for ranked results, and a chosen result (or a
 * command palette pick) scrolls to and highlights the row. The labels are
 * translation keys here (no translations are loaded), which the index
 * searches like any other text.
 */
describe('SettingsComponent search', () => {
    let fixture: ComponentFixture<SettingsComponent>;
    let component: SettingsComponent;
    let settingsSearch: SettingsSearchService;
    let settingsCtx: SettingsContextService;
    let scrollIntoView: jest.Mock;
    const originalElectron = window.electron;
    const originalScrollIntoView = Element.prototype.scrollIntoView;

    const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const query = (selector: string) => element().querySelector(selector);

    beforeEach(waitForAsync(() => {
        configureSettingsComponentTestBed(createEpgBridgeStub());
    }));

    beforeEach(async () => {
        window.electron = createElectronStub();
        scrollIntoView = jest.fn();
        Element.prototype.scrollIntoView = scrollIntoView;

        fixture = TestBed.createComponent(SettingsComponent);
        component = fixture.componentInstance;
        settingsSearch = TestBed.inject(SettingsSearchService);
        settingsCtx = TestBed.inject(SettingsContextService);
        stubSettingsSideEffects(component);
        const loadSettings = jest.spyOn(component.form, 'loadSettings');
        fixture.detectChanges();
        await loadSettings.mock.results[0].value;
        await fixture.whenStable();
        fixture.detectChanges();
    });

    afterEach(() => {
        jest.useRealTimers();
        window.electron = originalElectron;
        Element.prototype.scrollIntoView = originalScrollIntoView;
    });

    it('replaces the section page with ranked results while searching', () => {
        expect(query('app-settings-general-section')).not.toBeNull();

        setSettingsSearchQuery('theme');
        fixture.detectChanges();

        expect(query('app-settings-general-section')).toBeNull();
        expect(
            query('[data-test-id="settings-search-result-theme"]')
        ).not.toBeNull();
        expect(
            query('[data-test-id="settings-search-summary"]')?.getAttribute(
                'aria-live'
            )
        ).toBe('polite');

        setSettingsSearchQuery('');
        fixture.detectChanges();

        expect(query('[data-test-id="settings-search-results"]')).toBeNull();
        expect(query('app-settings-general-section')).not.toBeNull();
    });

    it('follows Embedded MPV support only while the page is open', () => {
        const stopFollowing = jest.fn();
        const follow = jest
            .spyOn(settingsSearch, 'followEmbeddedMpvSupport')
            .mockReturnValue(stopFollowing);

        const page = TestBed.createComponent(SettingsComponent);
        expect(follow).toHaveBeenCalledTimes(1);
        expect(stopFollowing).not.toHaveBeenCalled();

        // Closing the page ends it: nothing shows these rows any more.
        page.destroy();
        expect(stopFollowing).toHaveBeenCalledTimes(1);
    });

    it('shows an empty state when nothing matches', () => {
        setSettingsSearchQuery('zzzz-no-such-setting');
        fixture.detectChanges();

        expect(query('[data-test-id="settings-search-empty"]')).not.toBeNull();
        expect(query('.settings-search-result')).toBeNull();
    });

    it('publishes match counts per section for the navigation', () => {
        setSettingsSearchQuery('dark');
        fixture.detectChanges();

        expect(settingsCtx.matchCounts()).toEqual(
            expect.objectContaining({ general: 1 })
        );

        setSettingsSearchQuery('');
        fixture.detectChanges();
        expect(settingsCtx.matchCounts()).toBeNull();
    });

    it('reveals the chosen result through the settings search service', () => {
        const reveal = jest.spyOn(settingsSearch, 'reveal');
        setSettingsSearchQuery('theme');
        fixture.detectChanges();

        (
            query(
                '[data-test-id="settings-search-result-theme"]'
            ) as HTMLButtonElement
        ).click();

        expect(reveal).toHaveBeenCalledWith(entry('theme'));
        expect(
            (TestBed.inject(Router) as unknown as MockRouter).navigate
        ).toHaveBeenCalledWith(['/workspace/settings', 'general']);
    });

    it('scrolls to, focuses and briefly highlights a revealed row', () => {
        jest.useFakeTimers();

        settingsSearch.reveal(entry('show-captions'));
        fixture.detectChanges();

        const row = query('[data-setting-id="show-captions"]') as HTMLElement;
        expect(scrollIntoView).toHaveBeenCalled();
        expect(scrollIntoView.mock.contexts[0]).toBe(row);
        expect(row.classList).toContain(SETTINGS_REVEALED_CLASS);
        expect(document.activeElement).toBe(row);
        expect(settingsSearch.pendingReveal()).toBeNull();

        jest.runOnlyPendingTimers();
        expect(row.classList).not.toContain(SETTINGS_REVEALED_CLASS);
    });

    it('waits for the section page before revealing a row on it', () => {
        settingsSearch.reveal(entry('epg-offset'));
        fixture.detectChanges();

        expect(scrollIntoView).not.toHaveBeenCalled();
        expect(settingsSearch.pendingReveal()?.id).toBe('epg-offset');

        setSettingsSection('epg');
        fixture.detectChanges();

        expect(query('[data-setting-id="epg-offset"]')?.classList).toContain(
            SETTINGS_REVEALED_CLASS
        );
    });

    it('falls back to the controlling row when the searched row is hidden', () => {
        // The API key row only renders while TMDB is enabled.
        setSettingsSection('tmdb');
        fixture.detectChanges();
        expect(query('[data-setting-id="tmdb-api-key"]')).toBeNull();

        settingsSearch.reveal(entry('tmdb-api-key'));
        fixture.detectChanges();

        expect(query('[data-setting-id="tmdb-enable"]')?.classList).toContain(
            SETTINGS_REVEALED_CLASS
        );
    });
});
