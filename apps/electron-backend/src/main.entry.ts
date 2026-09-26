/**
 * Process entry of the Electron main process. It becomes
 * `dist/apps/electron-backend/main.js`: the file Electron, `nx serve`, the E2E
 * fixtures and the packaged app launch.
 *
 * It enables the V8 compile cache and only then requires the application
 * bundle, `main.app.js` (built from `main.ts`). V8 writes a code cache for
 * the script being compiled, so a call inside the bundle would leave the
 * bundle itself uncached; only this small file pays the uncached compile.
 * Keep it free of imports beyond `electron`, Node built-ins and the guard
 * helper: anything imported here is compiled before the cache is on.
 */
import { app } from 'electron';
import * as nodeModule from 'node:module';
import {
    enableStartupCompileCache,
    publishCompileCacheOutcome,
    type CompileCacheModule,
} from './app/services/compile-cache';

declare const __non_webpack_require__: NodeJS.Require;

publishCompileCacheOutcome(
    enableStartupCompileCache({
        module: nodeModule as CompileCacheModule,
        // Read before main.ts calls app.setName(), deliberately: renaming
        // here would move every path derived from the app name, including
        // the settings store's, for existing Linux profiles. On macOS and
        // Windows the directory is the same either way.
        userDataPath: () => app.getPath('userData'),
    })
);

// Resolved next to this file at run time; webpack must not inline it.
__non_webpack_require__('./main.app.js');
