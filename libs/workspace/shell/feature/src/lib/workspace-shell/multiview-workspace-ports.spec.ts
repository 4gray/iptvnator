import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    MULTIVIEW_CONNECTION_BUDGET,
    MultiviewEntryService,
} from '@iptvnator/playback/multiview/data-access';
import {
    installMultiviewPicker,
    provideMultiviewWorkspacePorts,
} from './multiview-workspace-ports';

describe('provideMultiviewWorkspacePorts', () => {
    it('loads the feature only when a budget is asked for', async () => {
        const budgetFor = jest.fn().mockResolvedValue({
            playlistName: 'Synthetic Provider',
            maxConnections: 1,
            activeConnections: 1,
        });
        class ConnectionBudgetService {
            budgetFor = budgetFor;
        }
        const load = jest.fn().mockResolvedValue({ ConnectionBudgetService });
        TestBed.configureTestingModule({
            providers: [
                provideMultiviewWorkspacePorts(load),
                {
                    provide: ConnectionBudgetService,
                    useClass: ConnectionBudgetService,
                },
            ],
        });

        const port = TestBed.inject(MULTIVIEW_CONNECTION_BUDGET);
        expect(load).not.toHaveBeenCalled();

        await expect(port.budgetFor('playlist-1')).resolves.toMatchObject({
            maxConnections: 1,
        });
        expect(load).toHaveBeenCalledTimes(1);
        expect(budgetFor).toHaveBeenCalledWith('playlist-1');
    });

    it('installs the picker for the host life and loads it on first pick', async () => {
        const pick = jest.fn().mockResolvedValue(null);
        class MultiviewPickerLauncher {
            pick = pick;
        }
        const load = jest.fn().mockResolvedValue({ MultiviewPickerLauncher });
        @Component({ template: '' })
        class HostComponent {
            constructor() {
                installMultiviewPicker(load);
            }
        }
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: MultiviewPickerLauncher,
                    useClass: MultiviewPickerLauncher,
                },
            ],
        });
        const entry = TestBed.inject(MultiviewEntryService);
        const useChannelResolver = jest.spyOn(entry, 'useChannelResolver');
        expect(entry.hasPicker).toBe(false);

        const fixture = TestBed.createComponent(HostComponent);
        expect(entry.hasPicker).toBe(true);
        expect(useChannelResolver).toHaveBeenCalledTimes(1);
        expect(load).not.toHaveBeenCalled();

        await entry.pick({ context: 'add' });
        expect(pick).toHaveBeenCalledWith({ context: 'add' });

        fixture.destroy();
        expect(entry.hasPicker).toBe(false);
    });
});
