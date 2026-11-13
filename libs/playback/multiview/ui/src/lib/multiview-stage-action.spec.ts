import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    MULTIVIEW_SOURCE_PICKER,
    MultiviewEntryService,
} from '@iptvnator/playback/multiview/data-access';
import { SettingsStore } from '@iptvnator/services';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import { stageMultiviewAction } from './multiview-stage-action';

describe('stageMultiviewAction', () => {
    function action(pick?: jest.Mock) {
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: SettingsStore,
                    useValue: { player: signal(VideoPlayer.VideoJs) },
                },
                ...(pick
                    ? [{ provide: MULTIVIEW_SOURCE_PICKER, useValue: { pick } }]
                    : []),
            ],
        });
        return TestBed.runInInjectionContext(stageMultiviewAction);
    }

    it('offers nothing without a picker', () => {
        expect(action()).toBeNull();
    });

    it('opens the picker in add context', () => {
        const pick = jest.fn().mockResolvedValue(null);
        const result = action(pick);

        result?.run();

        expect(pick).toHaveBeenCalledWith({ context: 'add' });
        expect(result?.enabled).toBe(
            TestBed.inject(MultiviewEntryService).canAdd
        );
    });
});
