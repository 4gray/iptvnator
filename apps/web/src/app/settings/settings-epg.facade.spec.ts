import { TestBed } from '@angular/core/testing';
import { UntypedFormBuilder } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
    EpgRuntimeBridgeService,
    EpgService,
} from '@iptvnator/epg/data-access';
import { DialogService } from '@iptvnator/ui/components';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MockProvider } from 'ng-mocks';
import { SettingsStore } from '../services/settings-store.service';
import { SettingsService } from '../services/settings.service';
import { SettingsEpgFacade } from './settings-epg.facade';
import { SettingsFormFacade } from './settings-form.facade';
import { SettingsSnackbarService } from './settings-snackbar.service';
import {
    createElectronStub,
    createEpgBridgeStub,
    MatSnackBarStub,
    MockSettingsService,
    MockSettingsStore,
} from './settings-test-harness.stub';

describe('SettingsEpgFacade', () => {
    let facade: SettingsEpgFacade;
    let formFacade: SettingsFormFacade;
    let epgBridge: Partial<EpgRuntimeBridgeService>;
    let epgService: EpgService;
    let dialogService: DialogService;
    let snackBar: MatSnackBarStub;
    let translate: TranslateService;
    const originalElectron = window.electron;

    /** The confirm dialog is a mock, so tests trigger its callback directly */
    const confirmImmediately = () => {
        (dialogService.openConfirmDialog as jest.Mock).mockImplementation(
            ({ onConfirm }: { onConfirm: () => Promise<void> }) => {
                void onConfirm();
            }
        );
    };

    beforeEach(() => {
        window.electron = createElectronStub();
        epgBridge = createEpgBridgeStub();

        TestBed.configureTestingModule({
            providers: [
                UntypedFormBuilder,
                SettingsEpgFacade,
                SettingsFormFacade,
                SettingsSnackbarService,
                { provide: EpgRuntimeBridgeService, useValue: epgBridge },
                MockProvider(EpgService, { fetchEpg: jest.fn() }),
                MockProvider(DialogService, { openConfirmDialog: jest.fn() }),
                { provide: MatSnackBar, useClass: MatSnackBarStub },
                { provide: SettingsService, useClass: MockSettingsService },
                { provide: SettingsStore, useClass: MockSettingsStore },
            ],
            imports: [TranslateModule.forRoot()],
        });

        facade = TestBed.inject(SettingsEpgFacade);
        formFacade = TestBed.inject(SettingsFormFacade);
        epgService = TestBed.inject(EpgService);
        dialogService = TestBed.inject(DialogService);
        snackBar = TestBed.inject(MatSnackBar) as unknown as MatSnackBarStub;
        translate = TestBed.inject(TranslateService);
        jest.spyOn(translate, 'instant').mockImplementation((key) => key);
    });

    afterEach(() => {
        window.electron = originalElectron;
    });

    it('should force-fetch EPG for a single URL (bypassing freshness cache)', () => {
        const url = 'http://epg-url-here/data.xml';

        facade.refresh(url);

        expect(epgBridge.forceFetchEpg).toHaveBeenCalledWith(url, {
            trustedPrivateNetworkEpgUrls: [],
            trustedInsecureTlsHosts: [],
        });
    });

    it('skips the refresh when the URL is empty or EPG is unmanaged', () => {
        facade.refresh('');
        epgBridge.supportsDataManagement = false;
        facade.refresh('http://epg-url-here/data.xml');

        expect(epgBridge.forceFetchEpg).not.toHaveBeenCalled();
    });

    it('force-fetches every configured source, skipping blank entries', () => {
        formFacade.setEpgUrls([
            'http://first.example/guide.xml',
            'http://second.example/guide.xml',
        ]);
        formFacade.addEpgSource();

        facade.refreshAll();

        expect(epgBridge.forceFetchEpg).toHaveBeenCalledTimes(2);
        expect(epgBridge.forceFetchEpg).toHaveBeenCalledWith(
            'http://first.example/guide.xml',
            expect.anything()
        );
        expect(epgBridge.forceFetchEpg).toHaveBeenCalledWith(
            'http://second.example/guide.xml',
            expect.anything()
        );
    });

    it('clears EPG data with a busy state and refreshes all sources on success', async () => {
        let resolveClear: () => void = () => undefined;
        const clearPromise = new Promise<{ success: boolean }>((resolve) => {
            resolveClear = () => resolve({ success: true });
        });
        (epgBridge.clearEpgData as jest.Mock).mockReturnValue(clearPromise);
        confirmImmediately();
        const refreshSpy = jest.spyOn(facade, 'refreshAll');

        facade.clear();

        expect(facade.isClearing()).toBe(true);
        expect(refreshSpy).not.toHaveBeenCalled();

        resolveClear();
        await clearPromise;
        await Promise.resolve();

        expect(facade.isClearing()).toBe(false);
        expect(snackBar.open).toHaveBeenCalledWith(
            'SETTINGS.EPG_DATA_CLEARED',
            undefined,
            expect.objectContaining({ panelClass: ['settings-snackbar'] })
        );
        expect(refreshSpy).toHaveBeenCalled();
    });

    it('shows a failure snackbar and skips refresh when clearing EPG data rejects', async () => {
        (epgBridge.clearEpgData as jest.Mock).mockRejectedValueOnce(
            new Error('boom')
        );
        confirmImmediately();
        const refreshSpy = jest.spyOn(facade, 'refreshAll');
        jest.spyOn(console, 'error').mockImplementation();

        facade.clear();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(facade.isClearing()).toBe(false);
        expect(snackBar.open).toHaveBeenCalledWith(
            'SETTINGS.EPG_DATA_CLEAR_FAILED',
            undefined,
            expect.objectContaining({ panelClass: ['settings-snackbar'] })
        );
        expect(refreshSpy).not.toHaveBeenCalled();
    });

    it('re-fetches the saved sources after the settings are stored', () => {
        formFacade.setEpgUrls(['http://saved.example/guide.xml']);

        facade.fetchConfiguredEpg();

        expect(epgService.fetchEpg).toHaveBeenCalledWith([
            'http://saved.example/guide.xml',
        ]);
    });

    it('does not re-fetch when no EPG source is configured', () => {
        facade.fetchConfiguredEpg();

        expect(epgService.fetchEpg).not.toHaveBeenCalled();
    });
});
