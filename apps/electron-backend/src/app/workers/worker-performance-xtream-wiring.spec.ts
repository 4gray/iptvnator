import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readCase(source: string, operation: string, nextOperation: string) {
    return source.slice(
        source.indexOf(`case '${operation}':`),
        source.indexOf(`case '${nextOperation}':`)
    );
}

describe('Xtream database performance phase wiring', () => {
    const source = readFileSync(
        join(
            process.cwd(),
            'apps/electron-backend/src/app/workers/database.worker.ts'
        ),
        'utf8'
    );
    const executeRequestSource = source.slice(
        source.indexOf('async function executeRequest')
    );

    it.each([
        ['DB_GET_CATEGORIES', 'DB_SAVE_CATEGORIES', 'getCategories'],
        ['DB_SAVE_CATEGORIES', 'DB_GET_ALL_CATEGORIES', 'saveCategories'],
        ['DB_GET_CONTENT', 'DB_GET_GLOBAL_RECENTLY_ADDED', 'getContent'],
        ['DB_SAVE_CONTENT', 'DB_CLEAR_XTREAM_IMPORT_CACHE', 'saveContent'],
        [
            'DB_CLEAR_XTREAM_IMPORT_CACHE',
            'DB_GET_CONTENT_BY_XTREAM_ID',
            'clearXtreamImportCache',
        ],
        ['DB_SEARCH_CONTENT', 'DB_GLOBAL_SEARCH', 'searchContent'],
        ['DB_DELETE_PLAYLIST', 'DB_GET_APP_STATE', 'deletePlaylist'],
        [
            'DB_DELETE_XTREAM_CONTENT',
            'DB_RESTORE_XTREAM_USER_DATA',
            'deleteXtreamContent',
        ],
    ])('passes the optional adapter through %s', (operation, next, call) => {
        const branch = readCase(executeRequestSource, operation, next);

        expect(branch).toContain('createWorkerPerformancePhaseAdapter');
        expect(branch).toContain('performanceCapture');
        expect(branch).toContain(call);
    });

    it('leaves mixed global search uninstrumented', () => {
        const branch = readCase(
            executeRequestSource,
            'DB_GLOBAL_SEARCH',
            'DB_CREATE_PLAYLIST'
        );

        expect(branch).not.toContain('createWorkerPerformancePhaseAdapter');
        expect(branch).not.toContain('performanceCapture');
    });
});
