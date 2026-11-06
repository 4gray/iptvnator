import type { ElectronBridgeApi } from '@iptvnator/shared/interfaces';
import type { LaunchedElectronApp } from './electron-test-fixtures';

type PlayerAvailability = Awaited<
    ReturnType<NonNullable<ElectronBridgeApi['getExternalPlayerAvailability']>>
>;

/** Keep playback routing tests independent of the runner's installed players. */
export async function mockExternalPlayerAvailability(
    app: LaunchedElectronApp,
    availability: PlayerAvailability
): Promise<void> {
    await app.electronApp.evaluate(({ ipcMain }, result) => {
        ipcMain.removeHandler('GET_EXTERNAL_PLAYER_AVAILABILITY');
        ipcMain.handle('GET_EXTERNAL_PLAYER_AVAILABILITY', () => result);
    }, availability);
}
