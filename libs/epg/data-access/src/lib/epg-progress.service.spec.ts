import { TestBed } from '@angular/core/testing';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import {
    EpgImportProgress,
    EpgProgressService,
} from './epg-progress.service';

describe('EpgProgressService', () => {
    let runtimeCapabilities: { supportsEpg: boolean };
    const originalElectron = window.electron;

    beforeEach(() => {
        runtimeCapabilities = { supportsEpg: false };
    });

    afterEach(() => {
        window.electron = originalElectron;
        TestBed.resetTestingModule();
        jest.restoreAllMocks();
    });

    function configureService(): EpgProgressService {
        TestBed.configureTestingModule({
            providers: [
                EpgProgressService,
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: runtimeCapabilities,
                },
            ],
        });

        return TestBed.inject(EpgProgressService);
    }

    it('does not subscribe to Electron progress events when runtime EPG support is disabled', () => {
        const onEpgProgress = jest.fn();
        window.electron = {
            ...window.electron,
            onEpgProgress,
        } as unknown as typeof window.electron;

        configureService();

        expect(onEpgProgress).not.toHaveBeenCalled();
    });

    it('does not force retry when runtime EPG support is disabled', () => {
        const forceFetchEpg = jest.fn();
        window.electron = {
            ...window.electron,
            forceFetchEpg,
        } as unknown as typeof window.electron;
        const service = configureService();

        service.retry('https://example.com/epg.xml');

        expect(forceFetchEpg).not.toHaveBeenCalled();
    });

    it('forces retry through the Electron bridge when runtime EPG support is enabled', () => {
        const forceFetchEpg = jest.fn();
        window.electron = {
            ...window.electron,
            forceFetchEpg,
        } as unknown as typeof window.electron;
        runtimeCapabilities.supportsEpg = true;
        const service = configureService();

        service.retry('https://example.com/epg.xml');

        expect(forceFetchEpg).toHaveBeenCalledWith(
            'https://example.com/epg.xml'
        );
    });

    it('updates imports from Electron progress events when runtime EPG support is enabled', () => {
        let listener: ((progress: EpgImportProgress) => void) | undefined;
        window.electron = {
            ...window.electron,
            onEpgProgress: jest.fn((callback) => {
                listener = callback;
            }),
        } as unknown as typeof window.electron;
        runtimeCapabilities.supportsEpg = true;
        const service = configureService();

        listener?.({
            url: 'https://example.com/epg.xml',
            status: 'loading',
        });

        expect(window.electron?.onEpgProgress).toHaveBeenCalledTimes(1);
        expect(service.imports()).toEqual([
            {
                url: 'https://example.com/epg.xml',
                status: 'loading',
            },
        ]);
    });
});
