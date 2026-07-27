import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import { SettingsContextService } from '@iptvnator/workspace/shell/util';
import { SettingsComponent } from './settings.component';
import { SettingsSectionScrollDirective } from './settings-section-scroll.directive';
import {
    configureSettingsComponentTestBed,
    createElectronStub,
    createEpgBridgeStub,
    stubSettingsSideEffects,
} from './test-stubs/settings-test-harness.stub';

interface SettingsSectionScrollDirectiveTestApi {
    getScrollRoot(): HTMLElement | null;
}

/**
 * The directive only makes sense against a real settings page, so this is an
 * integration spec: it renders the component and drives the section
 * navigation the workspace shell would trigger.
 */
describe('SettingsSectionScrollDirective', () => {
    let fixture: ComponentFixture<SettingsComponent>;
    let epgBridge: Partial<EpgRuntimeBridgeService>;
    const originalElectron = window.electron;

    beforeEach(waitForAsync(() => {
        epgBridge = createEpgBridgeStub();
        configureSettingsComponentTestBed(epgBridge);
    }));

    beforeEach(() => {
        window.electron = createElectronStub();
    });

    afterEach(() => {
        window.electron = originalElectron;
    });

    it('should scroll the selected navigation target within the workspace viewport', async () => {
        jest.useFakeTimers();

        try {
            fixture = TestBed.createComponent(SettingsComponent);
            const component = fixture.componentInstance;
            const settingsContext = TestBed.inject(SettingsContextService);
            const originalGetElementById =
                document.getElementById.bind(document);
            const scrollTo = jest.fn();
            const scrollRoot = {
                scrollTop: 96,
                clientHeight: 885,
                scrollHeight: 2469,
                getBoundingClientRect: () =>
                    ({
                        top: 56,
                    }) as DOMRect,
                scrollTo,
            } as unknown as HTMLElement;

            stubSettingsSideEffects(component);
            fixture.detectChanges();
            const scrollDirective = fixture.debugElement
                .query(By.directive(SettingsSectionScrollDirective))
                .injector.get(SettingsSectionScrollDirective);
            jest.spyOn(
                scrollDirective as unknown as SettingsSectionScrollDirectiveTestApi,
                'getScrollRoot'
            ).mockReturnValue(scrollRoot);

            const getElementByIdSpy = jest
                .spyOn(document, 'getElementById')
                .mockImplementation((id: string) => {
                    if (id === 'about') {
                        return {
                            getBoundingClientRect: () =>
                                ({
                                    top: 2050,
                                    height: 159,
                                }) as DOMRect,
                        } as HTMLElement;
                    }

                    return originalGetElementById(id);
                });

            await fixture.whenStable();
            fixture.detectChanges();
            settingsContext.navigateToSection('about');
            fixture.detectChanges();

            expect(getElementByIdSpy).toHaveBeenCalledWith('about');
            expect(scrollTo).toHaveBeenCalledWith({
                behavior: 'smooth',
                top: 1488,
            });
            expect(settingsContext.pendingScrollTarget()).toBe('about');

            jest.advanceTimersByTime(600);

            expect(settingsContext.pendingScrollTarget()).toBeNull();
        } finally {
            jest.useRealTimers();
        }
    });
});
