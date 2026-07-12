import * as path from 'path';
import {
    getNativeModuleSearchPaths,
    loadNativeModuleFromSearchPaths,
    registerNativeModuleSearchPaths,
    resolveWorkerRuntimeBootstrap,
} from './worker-runtime-paths';

// The implementation joins candidate paths with the host path module, so the
// expected values are built with path.join too — hardcoded POSIX strings
// would fail on win32 checkouts.
function packagedWorkerPath(root: string, workerFilename: string): string {
    return path.join(
        root,
        'dist',
        'apps',
        'electron-backend',
        'workers',
        workerFilename
    );
}

function unpackedNodeModulesPaths(root: string): string[] {
    return [
        path.join(root, 'app.asar.unpacked', 'node_modules'),
        path.join(
            root,
            'app.asar.unpacked',
            'electron-backend',
            'node_modules'
        ),
        path.join(
            root,
            'app.asar.unpacked',
            'dist',
            'apps',
            'electron-backend',
            'node_modules'
        ),
    ];
}

describe('worker-runtime-paths', () => {
    it('resolves the development worker path when the worker file exists', () => {
        const developmentWorkerDir =
            '/workspace/dist/apps/electron-backend/workers';
        const workerPath = path.join(
            developmentWorkerDir,
            'database.worker.js'
        );
        const bootstrap = resolveWorkerRuntimeBootstrap({
            isPackaged: false,
            workerFilename: 'database.worker.js',
            developmentWorkerDir,
            fileExists: (filePath) => filePath === workerPath,
        });

        expect(bootstrap).toEqual({
            workerPath,
            workerPathCandidates: [workerPath],
        });
    });

    it('prefers process.resourcesPath for packaged worker resolution', () => {
        const resourcesPath = '/Applications/IPTVnator.app/Contents/Resources';
        const resourcesWorkerPath = packagedWorkerPath(
            resourcesPath,
            'epg-parser.worker.js'
        );
        const bootstrap = resolveWorkerRuntimeBootstrap({
            isPackaged: true,
            workerFilename: 'epg-parser.worker.js',
            developmentWorkerDir: '/unused',
            resourcesPath,
            appPath:
                '/Applications/IPTVnator.app/Contents/Resources/app.asar',
            fileExists: (filePath) => filePath === resourcesWorkerPath,
        });

        expect(bootstrap.workerPath).toBe(resourcesWorkerPath);
        expect(bootstrap.nativeModuleSearchPaths).toEqual(
            unpackedNodeModulesPaths(resourcesPath)
        );
    });

    it('falls back to appPath dirname when the resourcesPath candidate is missing', () => {
        const appWorkerPath = packagedWorkerPath(
            '/opt/IPTVnator/resources',
            'database.worker.js'
        );
        const bootstrap = resolveWorkerRuntimeBootstrap({
            isPackaged: true,
            workerFilename: 'database.worker.js',
            developmentWorkerDir: '/unused',
            resourcesPath: '/tmp/runtime-resources',
            appPath: '/opt/IPTVnator/resources/app.asar',
            fileExists: (filePath) => filePath === appWorkerPath,
        });

        expect(bootstrap.workerPath).toBe(appWorkerPath);
        expect(bootstrap.workerPathCandidates).toEqual([
            packagedWorkerPath('/tmp/runtime-resources', 'database.worker.js'),
            appWorkerPath,
        ]);
    });

    it('throws actionable errors when the worker file cannot be resolved', () => {
        expect(() =>
            resolveWorkerRuntimeBootstrap({
                isPackaged: true,
                workerFilename: 'database.worker.js',
                developmentWorkerDir: '/unused',
                resourcesPath: '/resources',
                appPath: '/opt/IPTVnator/resources/app.asar',
                fileExists: () => false,
            })
        ).toThrow(
            [
                'Unable to resolve worker "database.worker.js".',
                'Tried:',
                `- ${packagedWorkerPath('/resources', 'database.worker.js')}`,
                `- ${packagedWorkerPath(
                    '/opt/IPTVnator/resources',
                    'database.worker.js'
                )}`,
            ].join('\n')
        );
    });

    it('de-duplicates native module search paths when resource roots match', () => {
        expect(
            getNativeModuleSearchPaths({
                resourcesPath: '/resources',
                appPath: '/resources/app.asar',
            })
        ).toEqual(unpackedNodeModulesPaths('/resources'));
    });

    it('loads native modules from the first working candidate path', () => {
        const requireFactory = jest.fn((entryPath: string) => {
            if (entryPath === path.join('/second', 'index.js')) {
                return ((moduleName: string) => ({
                    moduleName,
                    entryPath,
                })) as NodeRequire;
            }

            throw new Error('bad path');
        });

        const moduleValue = loadNativeModuleFromSearchPaths({
            moduleName: 'better-sqlite3',
            loggerLabel: '[Worker]',
            searchPaths: ['/first', '/second'],
            fileExists: (searchPath) => searchPath !== '/first-missing',
            requireFactory,
        });

        expect(moduleValue).toEqual({
            moduleName: 'better-sqlite3',
            entryPath: path.join('/second', 'index.js'),
        });
    });

    it('registers native module search paths in NODE_PATH and module globalPaths', () => {
        const env: NodeJS.ProcessEnv = {};
        const moduleApi = {
            globalPaths: ['/global'],
        };

        const registeredPaths = registerNativeModuleSearchPaths(
            ['/first', '/second', '/global'],
            {
                env,
                moduleApi,
            }
        );

        expect(registeredPaths).toEqual(['/first', '/second', '/global']);
        expect(env.NODE_PATH).toBe(
            ['/first', '/second', '/global'].join(path.delimiter)
        );
        expect(moduleApi.globalPaths).toEqual(['/first', '/second', '/global']);
    });

    it('throws aggregated errors when no native module candidate works', () => {
        expect(() =>
            loadNativeModuleFromSearchPaths({
                moduleName: 'better-sqlite3',
                loggerLabel: '[Worker]',
                searchPaths: ['/missing', '/broken'],
                fileExists: (searchPath) => searchPath === '/broken',
                requireFactory: () => {
                    throw new Error('Cannot find module');
                },
                fallbackRequire: () => {
                    throw new Error('fallback failed');
                },
            })
        ).toThrow(
            [
                '[Worker] Unable to load native module "better-sqlite3".',
                'Tried:',
                '- /missing',
                '- /broken',
                'Failures:',
                '- /missing (missing)',
                '- /broken (Cannot find module)',
                '- require(better-sqlite3) (fallback failed)',
            ].join('\n')
        );
    });
});
