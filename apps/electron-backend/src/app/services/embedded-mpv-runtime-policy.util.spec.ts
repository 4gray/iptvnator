const mockElectronApp = {
    isPackaged: false,
};

jest.mock('electron', () => ({ app: mockElectronApp }));

import { isEmbeddedMpvFeatureEnabled } from './embedded-mpv-runtime-policy.util';

describe('embedded-mpv-runtime-policy.util', () => {
    const originalExperiment =
        process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT;

    afterEach(() => {
        mockElectronApp.isPackaged = false;
        if (originalExperiment === undefined) {
            delete process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT;
        } else {
            process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT =
                originalExperiment;
        }
    });

    it('enables embedded MPV for packaged apps', () => {
        mockElectronApp.isPackaged = true;
        delete process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT;

        expect(isEmbeddedMpvFeatureEnabled()).toBe(true);
    });

    it.each(['1', 'true', 'yes', 'on'])(
        'enables embedded MPV for a truthy development opt-in: %s',
        (value) => {
            mockElectronApp.isPackaged = false;
            process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT = value;

            expect(isEmbeddedMpvFeatureEnabled()).toBe(true);
        }
    );

    it.each([undefined, '0', 'false', 'off'])(
        'keeps embedded MPV disabled for an unpackaged run with opt-in %s',
        (value) => {
            mockElectronApp.isPackaged = false;
            if (value === undefined) {
                delete process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT;
            } else {
                process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT = value;
            }

            expect(isEmbeddedMpvFeatureEnabled()).toBe(false);
        }
    );
});
