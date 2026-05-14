import * as path from 'path';
import {
    getNativeModuleSearchPaths,
    loadNativeModuleFromSearchPaths,
    registerNativeModuleSearchPaths,
    resolveWorkerRuntimeBootstrap,
} from './worker-runtime-paths';

describe('worker-runtime-paths', () => {
    it('resolves the development worker path when the worker file exists', () => {
        const expectedWorkerPath = path.join(
            '/workspace/dist/apps/electron-backend/workers',
            'database.worker.js'
        );
        const bootstrap = resolveWorkerRuntimeBootstrap({
            isPackaged: false,
            workerFilename: 'database.worker.js',
            developmentWorkerDir:
                '/workspace/dist/apps/electron-backend/workers',
            fileExists: (filePath) => filePath === expectedWorkerPath,
        });

        expect(bootstrap).toEqual({
            workerPath: expectedWorkerPath,
            workerPathCandidates: [expectedWorkerPath],
        });
    });

    it('prefers process.resourcesPath for packaged worker resolution', () => {
        const resourcesPath = '/Applications/IPTVnator.app/Contents/Resources';
        const expectedWorkerPath = path.join(
            resourcesPath,
            'dist/apps/electron-backend/workers/epg-parser.worker.js'
        );
        const bootstrap = resolveWorkerRuntimeBootstrap({
            isPackaged: true,
            workerFilename: 'epg-parser.worker.js',
            developmentWorkerDir: '/unused',
            resourcesPath,
            appPath: '/Applications/IPTVnator.app/Contents/Resources/app.asar',
            fileExists: (filePath) => filePath === expectedWorkerPath,
        });

        expect(bootstrap.workerPath).toBe(expectedWorkerPath);
        expect(bootstrap.nativeModuleSearchPaths).toEqual([
            path.join(resourcesPath, 'app.asar.unpacked/node_modules'),
            path.join(
                resourcesPath,
                'app.asar.unpacked/electron-backend/node_modules'
            ),
            path.join(
                resourcesPath,
                'app.asar.unpacked/dist/apps/electron-backend/node_modules'
            ),
        ]);
    });

    it('falls back to appPath dirname when the resourcesPath candidate is missing', () => {
        const expectedResourcesPath = path.join(
            '/tmp/runtime-resources',
            'dist/apps/electron-backend/workers/database.worker.js'
        );
        const expectedAppPath = path.join(
            '/opt/IPTVnator/resources',
            'dist/apps/electron-backend/workers/database.worker.js'
        );
        const bootstrap = resolveWorkerRuntimeBootstrap({
            isPackaged: true,
            workerFilename: 'database.worker.js',
            developmentWorkerDir: '/unused',
            resourcesPath: '/tmp/runtime-resources',
            appPath: '/opt/IPTVnator/resources/app.asar',
            fileExists: (filePath) => filePath === expectedAppPath,
        });

        expect(bootstrap.workerPath).toBe(expectedAppPath);
        expect(bootstrap.workerPathCandidates).toEqual([
            expectedResourcesPath,
            expectedAppPath,
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
                `- ${path.join('/resources', 'dist/apps/electron-backend/workers/database.worker.js')}`,
                `- ${path.join('/opt/IPTVnator/resources', 'dist/apps/electron-backend/workers/database.worker.js')}`,
            ].join('\n')
        );
    });

    it('de-duplicates native module search paths when resource roots match', () => {
        expect(
            getNativeModuleSearchPaths({
                resourcesPath: '/resources',
                appPath: '/resources/app.asar',
            })
        ).toEqual([
            path.join('/resources', 'app.asar.unpacked/node_modules'),
            path.join(
                '/resources',
                'app.asar.unpacked/electron-backend/node_modules'
            ),
            path.join(
                '/resources',
                'app.asar.unpacked/dist/apps/electron-backend/node_modules'
            ),
        ]);
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
