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
        let spyOnAdd, spyOnRemove;
        beforeEach(() => {
            spyOnAdd = jest.spyOn(document.body.classList, 'add');
            spyOnRemove = jest.spyOn(document.body.classList, 'remove');
        });

        afterEach(() => {
            jest.clearAllMocks();
        });

        it('should switch to the dark theme', inject(
            [SettingsService],
            (service: SettingsService) => {
                service.changeTheme(Theme.DarkTheme);
                expect(spyOnRemove).toHaveBeenCalledTimes(0);
                expect(spyOnAdd).toHaveBeenCalledTimes(1);
            }
        ));

        it('should switch to the light theme', inject(
            [SettingsService],
            (service: SettingsService) => {
                service.changeTheme(Theme.LightTheme);
                expect(spyOnRemove).toHaveBeenCalledTimes(1);
                expect(spyOnAdd).toHaveBeenCalledTimes(0);
            }
        ));

        it('should follow the system theme', inject(
            [SettingsService],
            (service: SettingsService) => {
                service.changeTheme(Theme.SystemTheme);

                expect(spyOnAdd).toHaveBeenCalledWith('dark-theme');

                systemThemeListeners[0]?.({
                    matches: false,
                } as MediaQueryListEvent);

                expect(spyOnRemove).toHaveBeenCalledWith('dark-theme');
            }
        ));
    });
});
