jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn(),
    },
}));

jest.mock('../services/dlna-renderer.service', () => ({
    DlnaRendererService: jest.fn().mockImplementation(() => ({
        discover: jest.fn(),
        startPlayback: jest.fn(),
    })),
}));

import { ipcMain } from 'electron';
import CastingEvents from './casting.events';

describe('CastingEvents', () => {
    it('registers DLNA handlers during bootstrap', () => {
        CastingEvents.bootstrapCastingEvents();

        expect(ipcMain.handle).toHaveBeenCalledWith(
            'CAST:DLNA_DISCOVER',
            expect.any(Function)
        );
        expect(ipcMain.handle).toHaveBeenCalledWith(
            'CAST:DLNA_START',
            expect.any(Function)
        );
    });
});
