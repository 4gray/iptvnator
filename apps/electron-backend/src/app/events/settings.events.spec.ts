import type { Settings } from '@iptvnator/shared/interfaces';

type ExternalPlayerArgumentsSetting = string | readonly unknown[];
type SettingsUpdatePayload = Omit<
    Partial<Settings>,
    | 'embeddedMpvFrameCopy'
    | 'language'
    | 'mpvPlayerArguments'
    | 'startupWindowMode'
    | 'vlcPlayerArguments'
> & {
    embeddedMpvFrameCopy?: boolean | number;
    language?: string;
    mpvPlayerArguments?: ExternalPlayerArgumentsSetting;
    startupWindowMode?: string;
    vlcPlayerArguments?: ExternalPlayerArgumentsSetting;
};
type SettingsUpdateHandler = (
    event: unknown,
    settings: SettingsUpdatePayload
) => unknown;

const SETTINGS_UPDATE = 'SETTINGS_UPDATE';
const STORE_KEYS = {
    EMBEDDED_MPV_AUTO_RECONNECT: 'EMBEDDED_MPV_AUTO_RECONNECT',
    EMBEDDED_MPV_EXTRA_OPTIONS: 'EMBEDDED_MPV_EXTRA_OPTIONS',
    EMBEDDED_MPV_FRAME_COPY: 'EMBEDDED_MPV_FRAME_COPY',
    MPV_PLAYER_ARGUMENTS: 'MPV_PLAYER_ARGUMENTS',
    MPV_REUSE_INSTANCE: 'MPV_REUSE_INSTANCE',
    STARTUP_WINDOW_MODE: 'STARTUP_WINDOW_MODE',
    VLC_PLAYER_ARGUMENTS: 'VLC_PLAYER_ARGUMENTS',
    VLC_REUSE_INSTANCE: 'VLC_REUSE_INSTANCE',
} as const;

const handlers = new Map<string, SettingsUpdateHandler>();
const mockStoreGet = jest.fn();
const mockStoreSet = jest.fn();
const mockUpdateSettings = jest.fn();
const mockIpcHandle = jest.fn(
    (channel: string, handler: SettingsUpdateHandler): void => {
        handlers.set(channel, handler);
    }
);

jest.mock('electron', () => ({
    ipcMain: {
        handle: mockIpcHandle,
    },
}));

jest.mock('../services/store.service', () => ({
    EMBEDDED_MPV_AUTO_RECONNECT: STORE_KEYS.EMBEDDED_MPV_AUTO_RECONNECT,
    EMBEDDED_MPV_EXTRA_OPTIONS: STORE_KEYS.EMBEDDED_MPV_EXTRA_OPTIONS,
    EMBEDDED_MPV_FRAME_COPY: STORE_KEYS.EMBEDDED_MPV_FRAME_COPY,
    MPV_PLAYER_ARGUMENTS: STORE_KEYS.MPV_PLAYER_ARGUMENTS,
    MPV_REUSE_INSTANCE: STORE_KEYS.MPV_REUSE_INSTANCE,
    STARTUP_WINDOW_MODE: STORE_KEYS.STARTUP_WINDOW_MODE,
    VLC_PLAYER_ARGUMENTS: STORE_KEYS.VLC_PLAYER_ARGUMENTS,
    VLC_REUSE_INSTANCE: STORE_KEYS.VLC_REUSE_INSTANCE,
    store: {
        get: mockStoreGet,
        set: mockStoreSet,
    },
}));

jest.mock('../server/http-server', () => ({
    httpServer: {
        updateSettings: mockUpdateSettings,
    },
}));

describe('SETTINGS_UPDATE', () => {
    let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
    let settingsUpdateHandler: SettingsUpdateHandler;

    beforeEach(async () => {
        handlers.clear();
        jest.resetModules();
        mockIpcHandle.mockClear();
        mockStoreGet.mockReset();
        mockStoreSet.mockReset();
        mockUpdateSettings.mockReset();
        mockStoreGet.mockImplementation(
            (_key: string, fallbackValue: unknown): unknown => fallbackValue
        );
        consoleLogSpy = jest
            .spyOn(console, 'log')
            .mockImplementation(() => undefined);

        await import('./settings.events');

        const registeredHandler = handlers.get(SETTINGS_UPDATE);
        if (!registeredHandler) {
            throw new Error(`Missing ipcMain handler for ${SETTINGS_UPDATE}`);
        }
        settingsUpdateHandler = registeredHandler;
    });

    afterEach(() => {
        jest.useRealTimers();
        consoleLogSpy.mockRestore();
    });

    it('normalizes external-player arguments and preserves explicit false reuse settings', () => {
        settingsUpdateHandler(
            {},
            {
                mpvPlayerArguments: [' --screen=1 ', '', ' --hwdec=auto-safe '],
                mpvReuseInstance: false,
                vlcPlayerArguments:
                    ' --network-caching=1000 \r\n\n --fullscreen ',
                vlcReuseInstance: false,
            }
        );

        expect(mockStoreSet.mock.calls).toEqual([
            [STORE_KEYS.MPV_PLAYER_ARGUMENTS, '--screen=1\n--hwdec=auto-safe'],
            [
                STORE_KEYS.VLC_PLAYER_ARGUMENTS,
                '--network-caching=1000\n--fullscreen',
            ],
            [STORE_KEYS.MPV_REUSE_INSTANCE, false],
            [STORE_KEYS.VLC_REUSE_INSTANCE, false],
        ]);
        expect(mockUpdateSettings).not.toHaveBeenCalled();
    });

    it('does not persist or reconcile an empty settings update', () => {
        settingsUpdateHandler({}, {});

        expect(mockStoreGet).not.toHaveBeenCalled();
        expect(mockStoreSet).not.toHaveBeenCalled();
        expect(mockUpdateSettings).not.toHaveBeenCalled();
    });

    it('coerces an enabled embedded-MPV frame-copy value to boolean true', () => {
        settingsUpdateHandler({}, { embeddedMpvFrameCopy: 1 });

        expect(mockStoreSet).toHaveBeenCalledTimes(1);
        expect(mockStoreSet).toHaveBeenCalledWith(
            STORE_KEYS.EMBEDDED_MPV_FRAME_COPY,
            true
        );
        expect(mockUpdateSettings).not.toHaveBeenCalled();
    });

    it('mirrors the embedded MPV extra options in canonical form', () => {
        settingsUpdateHandler(
            {},
            { embeddedMpvExtraOptions: ' --hwdec = auto \r\n\nvo=null\n' }
        );

        expect(mockStoreSet.mock.calls).toEqual([
            [STORE_KEYS.EMBEDDED_MPV_EXTRA_OPTIONS, 'hwdec=auto\nvo=null'],
        ]);
        expect(mockUpdateSettings).not.toHaveBeenCalled();
    });

    it('mirrors the embedded MPV auto-reconnect toggle as a boolean', () => {
        settingsUpdateHandler({}, { embeddedMpvAutoReconnect: false });
        expect(mockStoreSet.mock.calls).toEqual([
            [STORE_KEYS.EMBEDDED_MPV_AUTO_RECONNECT, false],
        ]);

        mockStoreSet.mockClear();
        settingsUpdateHandler({}, { embeddedMpvAutoReconnect: true });
        expect(mockStoreSet.mock.calls).toEqual([
            [STORE_KEYS.EMBEDDED_MPV_AUTO_RECONNECT, true],
        ]);
    });

    it('mirrors the startup window mode into the main-process store', () => {
        settingsUpdateHandler({}, { startupWindowMode: 'fullscreen' });

        expect(mockStoreSet.mock.calls).toEqual([
            [STORE_KEYS.STARTUP_WINDOW_MODE, 'fullscreen'],
        ]);
        expect(mockUpdateSettings).not.toHaveBeenCalled();
    });

    it('normalizes an unknown startup window mode to normal instead of storing junk', () => {
        settingsUpdateHandler({}, { startupWindowMode: 'kiosk' });

        expect(mockStoreSet.mock.calls).toEqual([
            [STORE_KEYS.STARTUP_WINDOW_MODE, 'normal'],
        ]);
    });

    it('reconciles an enabled remote-control update with the stored port', () => {
        mockStoreGet.mockImplementation(
            (key: string, fallbackValue: unknown): unknown =>
                key === 'remoteControlPort' ? 9988 : fallbackValue
        );

        settingsUpdateHandler({}, { remoteControl: true });

        expect(mockStoreGet.mock.calls).toEqual([['remoteControlPort', 8765]]);
        expect(mockStoreSet.mock.calls).toEqual([['remoteControl', true]]);
        expect(mockUpdateSettings).toHaveBeenCalledTimes(1);
        expect(mockUpdateSettings).toHaveBeenCalledWith(true, 9988);
    });

    it('reconciles a remote-control port update with the stored enabled state', () => {
        mockStoreGet.mockImplementation(
            (key: string, fallbackValue: unknown): unknown =>
                key === 'remoteControl' ? true : fallbackValue
        );

        settingsUpdateHandler({}, { remoteControlPort: 9123 });

        expect(mockStoreGet.mock.calls).toEqual([['remoteControl', false]]);
        expect(mockStoreSet.mock.calls).toEqual([['remoteControlPort', 9123]]);
        expect(mockUpdateSettings).toHaveBeenCalledTimes(1);
        expect(mockUpdateSettings).toHaveBeenCalledWith(true, 9123);
    });

    it('preserves explicit false and zero remote-control values', () => {
        settingsUpdateHandler(
            {},
            { remoteControl: false, remoteControlPort: 0 }
        );

        expect(mockStoreGet).not.toHaveBeenCalled();
        expect(mockStoreSet.mock.calls).toEqual([
            ['remoteControl', false],
            ['remoteControlPort', 0],
        ]);
        expect(mockUpdateSettings).toHaveBeenCalledTimes(1);
        expect(mockUpdateSettings).toHaveBeenCalledWith(false, 0);
    });

    it('does not print a TMDB apiKey while retaining useful fields', () => {
        const apiKey = 'tmdb-settings-api-key-secret';

        settingsUpdateHandler(
            {},
            {
                language: 'de',
                tmdb: { apiKey, enabled: true },
            }
        );

        const output = JSON.stringify(consoleLogSpy.mock.calls);
        expect(output).not.toContain(apiKey);
        expect(output).toContain('language');
        expect(output).toContain('de');
        expect(output).toContain('enabled');
    });

    it('does not print credentials embedded in external player arguments', () => {
        const authorizationSecret = 'player-authorization-secret';
        const cookieSecret = 'player-cookie-secret';

        settingsUpdateHandler(
            {},
            {
                language: 'de',
                mpvPlayerArguments: `--http-header-fields=Authorization: Bearer ${authorizationSecret}`,
                vlcPlayerArguments: `--http-referrer=https://example.com --http-cookie=Cookie: ${cookieSecret}`,
            }
        );

        const output = JSON.stringify(consoleLogSpy.mock.calls);
        expect(output).not.toContain(authorizationSecret);
        expect(output).not.toContain(cookieSecret);
        expect(output).toContain('language');
        expect(output).toContain('de');
    });
});
