import { NgxWhatsNewModule } from 'ngx-whats-new';
import {
    ComponentFixture,
    inject,
    TestBed,
    waitForAsync,
} from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { AppComponent } from './app.component';
import {
    TranslateModule,
    TranslatePipe,
    TranslateService,
} from '@ngx-translate/core';
import { ElectronService } from './services/electron.service';
import { ElectronServiceStub } from './services/electron.service.stub';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MockModule, MockPipe } from 'ng-mocks';
import { of } from 'rxjs';
import { WhatsNewService } from './services/whats-new.service';
import { Theme } from './settings/theme.enum';
import { SettingsService } from './services/settings.service';
import { Router } from '@angular/router';
import { ChannelStore } from './state';
import { STORE_KEY } from './shared/enums/store-keys.enum';
import { WhatsNewServiceStub } from './services/whats-new.service.stub';

jest.mock('custom-electron-titlebar', () => {
    return {
        Titlebar: jest.fn().mockImplementation(() => {
            return {};
        }),
        Color: {
            fromHex: jest.fn(),
        },
    };
});

class MatSnackBarStub {
    open(): void {}
}

describe('AppComponent', () => {
    let component: AppComponent;
    let electronService: ElectronService;
    let fixture: ComponentFixture<AppComponent>;
    let settingsService: SettingsService;
    let translateService: TranslateService;
    let whatsNewService: WhatsNewService;
    const defaultLanguage = 'en';

    beforeEach(
        waitForAsync(() => {
            TestBed.configureTestingModule({
                declarations: [AppComponent, MockPipe(TranslatePipe)],
                providers: [
                    { provide: ElectronService, useClass: ElectronServiceStub },
                    { provide: MatSnackBar, useClass: MatSnackBarStub },
                    { provide: WhatsNewService, useClass: WhatsNewServiceStub },
                    TranslateService,
                    SettingsService, // TODO: stub
                ],
                imports: [
                    MockModule(MatSnackBarModule),
                    MockModule(NgxWhatsNewModule),
                    RouterTestingModule,
                    TranslateModule.forRoot(),
                ],
            }).compileComponents();
        })
    );

    beforeEach(() => {
        electronService = TestBed.inject(ElectronService);
        fixture = TestBed.createComponent(AppComponent);
        settingsService = TestBed.inject(SettingsService);
        translateService = TestBed.inject(TranslateService);
        whatsNewService = TestBed.inject(WhatsNewService);
        component = fixture.componentInstance;
        component.modals = [];
        fixture.detectChanges();
    });

    it('should create the component and set default language', () => {
        spyOn(translateService, 'setDefaultLang');
        spyOn(component, 'setRendererListeners');
        const fixture = TestBed.createComponent(AppComponent);
        const app = fixture.debugElement.componentInstance;
        expect(app).toBeTruthy();
        expect(component.commandsList.length).toEqual(5);
    });

    it('should init component', () => {
        spyOn(translateService, 'setDefaultLang');
        spyOn(component, 'setRendererListeners');
        spyOn(component, 'initSettings');
        spyOn(component, 'handleWhatsNewDialog');
        component.ngOnInit();
        expect(translateService.setDefaultLang).toHaveBeenCalledWith(
            defaultLanguage
        );
        expect(component.setRendererListeners).toHaveBeenCalledTimes(1);
        expect(component.initSettings).toHaveBeenCalledTimes(1);
        expect(component.handleWhatsNewDialog).toHaveBeenCalledTimes(1);
    });

    describe('Test ipc listeners and commands', () => {
        it('should set IPC listeners', () => {
            spyOn(electronService.ipcRenderer, 'on');
            component.setRendererListeners();
            expect(electronService.ipcRenderer.on).toHaveBeenCalledTimes(5);
        });

        it('should remove all ipc listeners on destroy', () => {
            spyOn(electronService.ipcRenderer, 'removeAllListeners');
            component.ngOnDestroy();
            expect(
                electronService.ipcRenderer.removeAllListeners
            ).toHaveBeenCalledTimes(4);
        });

        it('should navigate to the provided route', inject(
            [Router],
            (router: Router) => {
                const route = '/add-playlists';
                spyOn(router, 'navigateByUrl');
                component.navigateToRoute(route);
                expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
                expect(router.navigateByUrl).toHaveBeenCalledWith(
                    route,
                    expect.anything()
                );
            }
        ));

        it('should show a notification on epg error', inject(
            [MatSnackBar],
            (snackbar: MatSnackBar) => {
                spyOn(snackbar, 'open');
                component.onEpgError();
                expect(snackbar.open).toHaveBeenCalledTimes(1);
            }
        ));

        it('should handle epg download success', inject(
            [MatSnackBar, ChannelStore],
            (snackbar: MatSnackBar, channelStore: ChannelStore) => {
                spyOn(snackbar, 'open');
                spyOn(channelStore, 'setEpgAvailableFlag');
                component.onEpgFetchDone();
                expect(snackbar.open).toHaveBeenCalledTimes(1);
                expect(channelStore.setEpgAvailableFlag).toHaveBeenCalledWith(
                    true
                );
            }
        ));

        it('show show whats new dialog', () => {
            spyOn(whatsNewService, 'getModalsByVersion');
            spyOn(component, 'setDialogVisibility');
            component.showWhatsNewDialog();
            expect(whatsNewService.getModalsByVersion).toHaveBeenCalledTimes(1);
            expect(component.setDialogVisibility).toHaveBeenCalledWith(true);
        });
    });

    describe('Test version handling', () => {
        it('should get actual app version which is outdated and show updates dialog', () => {
            const currentAppVersion = '0.0.1';
            const spyOnSettingsGet = spyOn(
                settingsService,
                'getValueFromLocalStorage'
            ).and.returnValue(of(currentAppVersion));
            spyOn(whatsNewService, 'getModalsByVersion').and.returnValue([{}]);
            spyOn(whatsNewService, 'changeDialogVisibleState');

            component.handleWhatsNewDialog();
            expect(spyOnSettingsGet).toHaveBeenCalled();
            expect(whatsNewService.getModalsByVersion).toHaveBeenCalled();
            expect(
                whatsNewService.changeDialogVisibleState
            ).toHaveBeenCalledWith(true);
        });

        it('should get actual app version which is not outdated and do not shop updates dialog', () => {
            const currentAppVersion = '1.0.0';
            const spyOnSettingsGet = spyOn(
                settingsService,
                'getValueFromLocalStorage'
            ).and.returnValue(of(currentAppVersion));
            spyOn(whatsNewService, 'getModalsByVersion').and.returnValue([{}]);
            spyOn(whatsNewService, 'changeDialogVisibleState');

            component.handleWhatsNewDialog();
            expect(spyOnSettingsGet).toHaveBeenCalled();
            expect(whatsNewService.getModalsByVersion).toHaveBeenCalledTimes(0);
            expect(
                whatsNewService.changeDialogVisibleState
            ).toHaveBeenCalledTimes(0);
        });

        it('should change the visibility of the whats new dialog', () => {
            spyOn(whatsNewService, 'changeDialogVisibleState');
            component.modals = [{}, {}];
            const visibilityFlag = true;
            component.setDialogVisibility(true);

            expect(
                whatsNewService.changeDialogVisibleState
            ).toHaveBeenCalledWith(visibilityFlag);
            expect(
                whatsNewService.changeDialogVisibleState
            ).toHaveBeenCalledTimes(1);
        });

        it('should not change the visibility of the whats new dialog', () => {
            spyOn(whatsNewService, 'changeDialogVisibleState');
            component.modals = [];
            component.setDialogVisibility(true);
            expect(
                whatsNewService.changeDialogVisibleState
            ).toHaveBeenCalledTimes(0);
        });
    });

    describe('Set initial settings', () => {
        const theme = Theme.DarkTheme;
        const language = 'es';
        const epgUrl = 'http://localhost/epg.xml';

        beforeEach(() => {
            spyOn(electronService.ipcRenderer, 'send');
            spyOn(settingsService, 'changeTheme');
            spyOn(component, 'handleWhatsNewDialog');
            spyOn(translateService, 'use');
        });

        it('should get and init settings (all settings are defined)', () => {
            const spyOnSettingsGet = spyOn(
                settingsService,
                'getValueFromLocalStorage'
            ).and.returnValue(of({ theme, epgUrl, language }));

            component.initSettings();

            expect(spyOnSettingsGet).toHaveBeenCalledWith(STORE_KEY.Settings);
            expect(settingsService.changeTheme).toHaveBeenCalledWith(theme);
            expect(electronService.ipcRenderer.send).toHaveBeenCalledTimes(1);
            expect(translateService.use).toHaveBeenCalledWith(language);
        });

        it('should get and init settings (nothing is defined)', () => {
            const spyOnSettingsGet = spyOn(
                settingsService,
                'getValueFromLocalStorage'
            ).and.returnValue(of());

            component.initSettings();

            expect(spyOnSettingsGet).toHaveBeenCalledWith(STORE_KEY.Settings);
            expect(settingsService.changeTheme).toHaveBeenCalledTimes(0);
            expect(electronService.ipcRenderer.send).toHaveBeenCalledTimes(0);
            expect(translateService.use).toHaveBeenCalledTimes(0);
        });

        it('should get and init settings (only theme is defined)', () => {
            const spyOnSettingsGet = spyOn(
                settingsService,
                'getValueFromLocalStorage'
            ).and.returnValue(of({ theme }));

            component.initSettings();

            expect(spyOnSettingsGet).toHaveBeenCalledWith(STORE_KEY.Settings);
            expect(settingsService.changeTheme).toHaveBeenCalledWith(theme);
            expect(electronService.ipcRenderer.send).toHaveBeenCalledTimes(0);
            expect(translateService.use).toHaveBeenCalledWith(defaultLanguage);
        });
    });
});
