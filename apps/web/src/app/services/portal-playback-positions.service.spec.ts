import {
    DestroyableInjector,
    Injector,
    runInInjectionContext,
} from '@angular/core';
import {
    IXtreamDataSource,
    XTREAM_DATA_SOURCE,
} from '@iptvnator/portal/xtream/data-access';
import {
    PlaybackPositionRuntimeBridgeService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { AppPortalPlaybackPositionsService } from './portal-playback-positions.service';

interface PersistenceMocks {
    clearDataSource: jest.Mock;
    clearRuntime: jest.Mock;
    saveDataSource: jest.Mock;
    saveRuntime: jest.Mock;
}

interface PersistenceHarness {
    mocks: PersistenceMocks;
    service: AppPortalPlaybackPositionsService;
}

const position: PlaybackPositionData = {
    contentXtreamId: 101,
    contentType: 'episode',
    playlistId: 'playlist-1',
    positionSeconds: 42,
};

describe('AppPortalPlaybackPositionsService strict persistence', () => {
    let injector: DestroyableInjector;

    function createHarness(
        supportsXtreamSqliteDataSource: boolean
    ): PersistenceHarness {
        const mocks: PersistenceMocks = {
            clearDataSource: jest.fn().mockResolvedValue(undefined),
            clearRuntime: jest.fn().mockResolvedValue(undefined),
            saveDataSource: jest.fn().mockResolvedValue(undefined),
            saveRuntime: jest.fn().mockResolvedValue(undefined),
        };
        const dataSource = {
            clearPlaybackPosition: mocks.clearDataSource,
            savePlaybackPosition: mocks.saveDataSource,
        } as unknown as IXtreamDataSource;
        injector = Injector.create({
            providers: [
                AppPortalPlaybackPositionsService,
                { provide: XTREAM_DATA_SOURCE, useValue: dataSource },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsXtreamSqliteDataSource },
                },
                {
                    provide: PlaybackPositionRuntimeBridgeService,
                    useValue: {
                        clearPlaybackPositionOrThrow: mocks.clearRuntime,
                        savePlaybackPositionOrThrow: mocks.saveRuntime,
                    },
                },
            ],
        });
        return {
            mocks,
            service: runInInjectionContext(injector, () =>
                injector.get(AppPortalPlaybackPositionsService)
            ),
        };
    }

    afterEach(() => injector.destroy());

    describe.each([
        {
            dataSourceMock: (mocks: PersistenceMocks) =>
                mocks.saveDataSource,
            invoke: (service: AppPortalPlaybackPositionsService) =>
                service.savePlaybackPositionOrThrow(
                    'playlist-1',
                    position
                ),
            runtimeMock: (mocks: PersistenceMocks) => mocks.saveRuntime,
        },
        {
            dataSourceMock: (mocks: PersistenceMocks) =>
                mocks.clearDataSource,
            invoke: (service: AppPortalPlaybackPositionsService) =>
                service.clearPlaybackPositionOrThrow(
                    'playlist-1',
                    101,
                    'episode'
                ),
            runtimeMock: (mocks: PersistenceMocks) => mocks.clearRuntime,
        },
    ])('strict operation %#', (operation) => {
        it('propagates Electron bridge rejection', async () => {
            const { mocks, service } = createHarness(true);
            const error = new Error('Electron write failed');
            operation.runtimeMock(mocks).mockRejectedValue(error);

            await expect(operation.invoke(service)).rejects.toBe(error);
            expect(operation.dataSourceMock(mocks)).not.toHaveBeenCalled();
        });

        it('propagates PWA data-source rejection', async () => {
            const { mocks, service } = createHarness(false);
            const error = new Error('localStorage quota exceeded');
            operation.dataSourceMock(mocks).mockRejectedValue(error);

            await expect(operation.invoke(service)).rejects.toBe(error);
            expect(operation.runtimeMock(mocks)).not.toHaveBeenCalled();
        });

        it('keeps a partial bridge on the selected PWA data source', async () => {
            const { mocks, service } = createHarness(false);

            await expect(operation.invoke(service)).resolves.toBeUndefined();
            expect(operation.dataSourceMock(mocks)).toHaveBeenCalledTimes(1);
            expect(operation.runtimeMock(mocks)).not.toHaveBeenCalled();
        });
    });
});
