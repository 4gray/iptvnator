import { EnvironmentInjector, inject, type Provider } from '@angular/core';
import {
    MULTIVIEW_CONNECTION_BUDGET,
    type MultiviewConnectionBudgetSource,
} from '@iptvnator/playback/multiview/data-access';

type MultiviewWorkspaceFeature =
    typeof import('@iptvnator/workspace/multiview/feature');

const loadFeature = (): Promise<MultiviewWorkspaceFeature> =>
    import('@iptvnator/workspace/multiview/feature');

/**
 * The multiview ports the workspace implements, provided on the shell so
 * the player views and the stage inside it see them. The feature (picker
 * data, provider budgets) is a lazy chunk loaded on first use; providing
 * the ports loads nothing.
 */
export function provideMultiviewWorkspacePorts(
    load: () => Promise<MultiviewWorkspaceFeature> = loadFeature
): Provider[] {
    return [
        {
            provide: MULTIVIEW_CONNECTION_BUDGET,
            useFactory: (): MultiviewConnectionBudgetSource => {
                const injector = inject(EnvironmentInjector);
                return {
                    async budgetFor(playlistId) {
                        const feature = await load();
                        return injector
                            .get(feature.ConnectionBudgetService)
                            .budgetFor(playlistId);
                    },
                };
            },
        },
    ];
}
