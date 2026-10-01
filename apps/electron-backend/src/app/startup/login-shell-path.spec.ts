const shellPath = jest.fn<Promise<string | undefined>, []>();
const shellPathSync = jest.fn<string | undefined, []>();

jest.mock('shell-path', () => ({ shellPath, shellPathSync }));
jest.mock('../services/debug-trace', () => ({
    traceStartupPhase: jest.fn(),
}));

type LoginShellPathModule = typeof import('./login-shell-path');

function loadModule(): LoginShellPathModule {
    let loaded: LoginShellPathModule | undefined;
    jest.isolateModules(() => {
        loaded = jest.requireActual('./login-shell-path');
    });
    return loaded as LoginShellPathModule;
}

async function flushScheduled(): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
}

describe('login shell PATH', () => {
    const originalPath = process.env.PATH;
    const originalPlatform = process.platform;

    beforeEach(() => {
        shellPath.mockReset();
        shellPathSync.mockReset();
        process.env.PATH = '/usr/bin:/bin';
        Object.defineProperty(process, 'platform', { value: 'darwin' });
    });

    afterAll(() => {
        process.env.PATH = originalPath;
        Object.defineProperty(process, 'platform', {
            value: originalPlatform,
        });
    });

    it('reads the login shell asynchronously, never through the blocking API', async () => {
        let resolveShell: (path: string) => void = () => undefined;
        shellPath.mockReturnValue(
            new Promise((resolve) => {
                resolveShell = resolve;
            })
        );

        loadModule().scheduleDeferredFixPath();
        await flushScheduled();

        // The shell is still starting, and the main thread is free.
        expect(shellPath).toHaveBeenCalledTimes(1);
        expect(shellPathSync).not.toHaveBeenCalled();
        expect(process.env.PATH).toBe('/usr/bin:/bin');

        resolveShell('/opt/homebrew/bin:/usr/bin:/bin');
        await flushScheduled();
        expect(process.env.PATH).toBe('/opt/homebrew/bin:/usr/bin:/bin');
    });

    it('lets spawns wait until the lookup settled, at most the limit', async () => {
        let resolveShell: (path: string) => void = () => undefined;
        const module = loadModule();
        module.scheduleDeferredFixPath(
            () =>
                new Promise((resolve) => {
                    resolveShell = resolve;
                })
        );
        let waited = false;
        const wait = module.waitForLoginShellPath().then(() => {
            waited = true;
        });
        await flushScheduled();
        expect(waited).toBe(false);

        resolveShell('/opt/homebrew/bin');
        await wait;
        expect(process.env.PATH).toBe('/opt/homebrew/bin');

        // A shell that never returns cannot block a launch forever.
        const stuck = loadModule();
        stuck.scheduleDeferredFixPath(() => new Promise(() => undefined));
        await expect(stuck.waitForLoginShellPath(5)).resolves.toBeUndefined();
    });

    it('lets spawns go immediately on Windows', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        await expect(
            loadModule().waitForLoginShellPath(60_000)
        ).resolves.toBeUndefined();
    });

    it('falls back to the paths fix-path used when the shell reports none', async () => {
        await loadModule().hydratePathFromLoginShell(async () => undefined);

        expect(process.env.PATH).toBe(
            './node_modules/.bin:/.nodebrew/current/bin:/usr/local/bin:/usr/bin:/bin'
        );
    });

    it('runs once, and not at all on Windows', async () => {
        const read = jest.fn(async () => '/custom/bin');
        const module = loadModule();
        module.scheduleDeferredFixPath(read);
        module.scheduleDeferredFixPath(read);
        await flushScheduled();
        expect(read).toHaveBeenCalledTimes(1);

        Object.defineProperty(process, 'platform', { value: 'win32' });
        const windowsRead = jest.fn(async () => '/custom/bin');
        loadModule().scheduleDeferredFixPath(windowsRead);
        await flushScheduled();
        expect(windowsRead).not.toHaveBeenCalled();
    });

    it('keeps the current PATH when the lookup fails', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {
            // Expected failure.
        });
        loadModule().scheduleDeferredFixPath(async () => {
            throw new Error('shell exited');
        });
        await flushScheduled();

        expect(process.env.PATH).toBe('/usr/bin:/bin');
        expect(warn).toHaveBeenCalledWith(
            'Login shell PATH lookup failed:',
            expect.any(Error)
        );
        warn.mockRestore();
    });
});
