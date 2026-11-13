import { TestBed } from '@angular/core/testing';
import { MULTIVIEW_CONNECTION_BUDGET } from '@iptvnator/playback/multiview/data-access';
import { provideMultiviewWorkspacePorts } from './multiview-workspace-ports';

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
});
