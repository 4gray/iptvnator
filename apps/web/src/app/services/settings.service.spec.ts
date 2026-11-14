import { HttpClientTestingModule } from '@angular/common/http/testing';
import { inject, TestBed } from '@angular/core/testing';
import { StorageMap } from '@ngx-pwa/local-storage';
import { of } from 'rxjs';
import { STORE_KEY, Theme } from '@iptvnator/shared/interfaces';
import { SettingsService } from './settings.service';

describe('Service: Settings', () => {
    let systemThemeListeners: Array<(event: MediaQueryListEvent) => void>;

    beforeEach(() => {
        systemThemeListeners = [];
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: jest.fn().mockImplementation(() => ({
                matches: true,
                addEventListener: jest.fn(
                    (
                        _event: 'change',
                        listener: (event: MediaQueryListEvent) => void
                    ) => {
                        systemThemeListeners.push(listener);
                    }
                ),
                removeEventListener: jest.fn(
                    (
                        _event: 'change',
                        listener: (event: MediaQueryListEvent) => void
                    ) => {
                        systemThemeListeners = systemThemeListeners.filter(
                            (registeredListener) =>
                                registeredListener !== listener
                        );
                    }
                ),
                addListener: jest.fn(),
                removeListener: jest.fn(),
            })),
        });

        TestBed.configureTestingModule({
            providers: [SettingsService],
            imports: [HttpClientTestingModule],
        });
    });

    it('should create a service instance', inject(
        [SettingsService],
        (service: SettingsService) => {
            expect(service).toBeTruthy();
        }
    ));

    it('should set key/value pair', inject(
        [SettingsService, StorageMap],
        (service: SettingsService, storage: StorageMap) => {
            const version = '2.1.0';
            jest.spyOn(storage, 'set').mockReturnValue(of(undefined));
            service.setValueToLocalStorage(STORE_KEY.Version, version);
            expect(storage.set).toHaveBeenCalledWith(
                STORE_KEY.Version,
                version
            );
        }
    ));

    it('should get value from the local storage', inject(
        [SettingsService],
        (service: SettingsService) => {
            const version = '2.1.0';
            service.setValueToLocalStorage(STORE_KEY.Version, version);
            service
                .getValueFromLocalStorage(STORE_KEY.Version)
                .subscribe((value) => {
                    expect(value).toBe(version);
                });
        }
    ));

    describe('Test theme switch', () => {
        let spyOnAdd: jest.SpyInstance<void, [...tokens: string[]]>;
        let spyOnRemove: jest.SpyInstance<void, [...tokens: string[]]>;
        beforeEach(() => {
            document.body.classList.remove('dark-theme', 'light-theme');
            delete document.body.dataset['appTheme'];
            spyOnAdd = jest.spyOn(document.body.classList, 'add');
            spyOnRemove = jest.spyOn(document.body.classList, 'remove');
        });

        afterEach(() => {
            jest.clearAllMocks();
            document.body.classList.remove('dark-theme', 'light-theme');
            delete document.body.dataset['appTheme'];
        });

        it.each([
            ['CREAM_THEME', 'cream', 'light-theme', 'dark-theme'],
            ['MOCHA_THEME', 'mocha', 'dark-theme', 'light-theme'],
            ['NIGHT_OWL_THEME', 'night-owl', 'dark-theme', 'light-theme'],
            ['BLACK_OLED_THEME', 'black-oled', 'dark-theme', 'light-theme'],
            [Theme.LightTheme, 'light', 'light-theme', 'dark-theme'],
            [Theme.DarkTheme, 'dark', 'dark-theme', 'light-theme'],
        ])(
            'applies preset %s with its compatibility class',
            (theme, id, active, inactive) => {
                const service = TestBed.inject(SettingsService);
                service.changeTheme(theme as Theme);
                expect(document.body.dataset['appTheme']).toBe(id);
                expect(document.body.classList.contains(active)).toBe(true);
                expect(document.body.classList.contains(inactive)).toBe(false);
            }
        );

        it('normalizes an unknown theme to the system preference', () => {
            const service = TestBed.inject(SettingsService);
            service.changeTheme('UNKNOWN_THEME' as Theme);
            expect(document.body.dataset['appTheme']).toBe('dark');
            expect(systemThemeListeners).toHaveLength(1);
        });

        it.each([
            ['CREAM_THEME', 'cream'],
            ['MOCHA_THEME', 'mocha'],
            ['NIGHT_OWL_THEME', 'night-owl'],
            ['BLACK_OLED_THEME', 'black-oled'],
        ])('stops following system changes after selecting %s', (theme, id) => {
            const service = TestBed.inject(SettingsService);
            service.changeTheme(Theme.SystemTheme);
            service.changeTheme(theme as Theme);
            expect(systemThemeListeners).toHaveLength(0);
            expect(document.body.dataset['appTheme']).toBe(id);
        });

        it('should switch to the dark theme', inject(
            [SettingsService],
            (service: SettingsService) => {
                service.changeTheme(Theme.DarkTheme);
                expect(spyOnAdd).toHaveBeenCalledWith('dark-theme');
                expect(spyOnRemove).toHaveBeenCalledWith('light-theme');
                expect(document.body.classList.contains('dark-theme')).toBe(
                    true
                );
                expect(document.body.classList.contains('light-theme')).toBe(
                    false
                );
            }
        ));

        it('should switch to the light theme', inject(
            [SettingsService],
            (service: SettingsService) => {
                service.changeTheme(Theme.LightTheme);
                expect(spyOnRemove).toHaveBeenCalledWith('dark-theme');
                expect(spyOnAdd).toHaveBeenCalledWith('light-theme');
                expect(document.body.classList.contains('light-theme')).toBe(
                    true
                );
                expect(document.body.classList.contains('dark-theme')).toBe(
                    false
                );
            }
        ));

        it('should follow the system theme', inject(
            [SettingsService],
            (service: SettingsService) => {
                service.changeTheme(Theme.SystemTheme);

                expect(spyOnAdd).toHaveBeenCalledWith('dark-theme');

                expect(document.body.dataset['appTheme']).toBe('dark');

                systemThemeListeners[0]?.({
                    matches: false,
                } as MediaQueryListEvent);

                expect(spyOnRemove).toHaveBeenCalledWith('dark-theme');
                expect(spyOnAdd).toHaveBeenCalledWith('light-theme');
                expect(document.body.classList.contains('light-theme')).toBe(
                    true
                );
                expect(document.body.dataset['appTheme']).toBe('light');
            }
        ));
    });
    describe('theme accent', () => {
        // jsdom loads no stylesheet; inline tokens stand in for the palette.
        const DARK = [
            '#1e2330',
            '#0d0f12',
            '#111318',
            '#161a22',
            '#252b3a',
            '#d8dce8',
        ];
        const LIGHT = [
            '#ffffff',
            '#eef0f3',
            '#eef0f3',
            '#f5f6f8',
            '#f0f2f5',
            '#1a1d23',
        ];
        const SURFACE_TOKENS = [
            '--app-widget-bg',
            '--app-shell-bg',
            '--app-rail-bg',
            '--app-content-bg',
            '--app-card-hover-bg',
            '--app-heading-color',
        ];
        const setSurfaces = (colors: string[]) =>
            SURFACE_TOKENS.forEach((token, i) =>
                document.body.style.setProperty(token, colors[i])
            );
        const token = (name: string) =>
            document.body.style.getPropertyValue(name);

        afterEach(() => {
            document.body.removeAttribute('style');
            document.body.classList.remove('dark-theme', 'light-theme');
            delete document.body.dataset['appTheme'];
            delete document.body.dataset['themeAccent'];
        });

        it('overrides the selection and primary roles on body', () => {
            const service = TestBed.inject(SettingsService);
            setSurfaces(DARK);
            service.changeTheme(Theme.DarkTheme);
            service.changeThemeAccent('magenta');

            expect(document.body.dataset['themeAccent']).toBe('magenta');
            expect(token('--app-selection-color')).toMatch(/^#[0-9a-f]{6}$/);
            expect(token('--mat-sys-primary')).toBe(
                token('--app-selection-text-color')
            );
            expect(token('--app-list-selected-fg')).toBe(
                token('--app-selection-text-color')
            );
        });

        it('restores the theme colour when the accent is cleared', () => {
            const service = TestBed.inject(SettingsService);
            setSurfaces(DARK);
            service.changeThemeAccent('teal');
            service.changeThemeAccent(null);

            expect(document.body.dataset['themeAccent']).toBeUndefined();
            expect(token('--app-selection-color')).toBe('');
            expect(token('--mat-sys-primary')).toBe('');
        });

        it('ignores an unknown saved accent', () => {
            const service = TestBed.inject(SettingsService);
            setSurfaces(DARK);
            service.changeThemeAccent('chartreuse');

            expect(document.body.dataset['themeAccent']).toBeUndefined();
            expect(token('--app-selection-color')).toBe('');
        });

        it('re-derives the accent for the next theme', () => {
            const service = TestBed.inject(SettingsService);
            setSurfaces(LIGHT);
            service.changeTheme(Theme.LightTheme);
            service.changeThemeAccent('amber');
            const onLight = token('--app-selection-color');

            setSurfaces(DARK);
            service.changeTheme(Theme.DarkTheme);
            const onDark = token('--app-selection-color');
            // Darkened for the white widget, lightened for the dark one.
            expect(onLight).not.toBe(onDark);
            expect(parseInt(onDark.slice(1, 3), 16)).toBeGreaterThan(
                parseInt(onLight.slice(1, 3), 16)
            );
            expect(service.appliedThemePresetId()).toBe('dark');
        });

        it('leaves the theme untouched while its styles are missing', () => {
            const service = TestBed.inject(SettingsService);
            service.changeThemeAccent('blue');

            expect(document.body.dataset['themeAccent']).toBeUndefined();
            expect(token('--app-selection-color')).toBe('');
            expect(service.previewThemeAccentColor('blue')).toBe('#3b82f6');
        });
    });
});
