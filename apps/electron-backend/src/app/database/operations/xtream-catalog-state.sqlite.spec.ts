import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const scenarios = [
    'normalized-live-completion',
    'normalized-movie-completion',
    'normalized-series-completion',
    'changed-serverUrl-completion',
    'changed-username-completion',
    'changed-password-completion',
    'changed-userAgent-completion',
    'changed-serverUrl-ack',
    'changed-username-ack',
    'changed-password-ack',
    'changed-userAgent-ack',
    'current-connection-ack',
    'column-user-agent-wins-payload',
    'old-payload-user-agent-rejected',
    'empty-column-user-agent-clears-payload',
    'cleared-payload-user-agent-rejected',
    'readonly-matching-connection',
    'readonly-mismatching-connection',
    'malformed-json',
    'scalar-payload',
    'array-payload',
    'null-payload',
    'missing-playlist',
    'wrong-playlist-type',
    'unrelated-conditional-key',
    'foreign-conditional-key',
    'invalid-conditional-value',
    'completion-write-rollback',
    'ack-write-rollback',
    'ordinary-setting-write',
] as const;

describe('conditional Xtream state with historical SQLite tables', () => {
    let results: Record<string, boolean>;

    beforeAll(() => {
        const url = (path: string) => pathToFileURL(resolve(path)).href;
        const script = `
            const { default: Database } = await import('better-sqlite3');
            const { drizzle } = await import('drizzle-orm/better-sqlite3');
            const schema = await import('@iptvnator/shared/database/schema');
            const { __databaseConnectionTestHooks: hooks } = await import(${JSON.stringify(url('libs/shared/database/src/lib/connection.ts'))});
            const { setAppState, getAppState, updatePlaylist } = await import(${JSON.stringify(url(resolve(__dirname, 'playlist.operations.ts')))});
            const { checkXtreamCatalogConnection } = await import(${JSON.stringify(url(resolve(__dirname, 'xtream-catalog-state.ts')))});
            const sqlite = new Database(':memory:');
            sqlite.pragma('foreign_keys = ON');
            for (const statement of [...hooks.createTableStatements, ...hooks.columnMigrationStatements]) {
                try { sqlite.exec(statement); } catch (error) {
                    if (!String(error).includes('duplicate column name')) throw error;
                }
            }
            const db = drizzle(sqlite, { schema });
            const { eq } = await import('drizzle-orm');
            const results = {};
            const playlistId = 'synthetic-source';
            const marker = 'xtream-import-status:' + playlistId + ':movie';
            const journalKey = 'xtream-history-recovery:' + playlistId;
            const condition = {
                playlistId,
                serverUrl: 'https://synthetic.example.invalid/catalog',
                username: 'synthetic-user',
                password: 'synthetic-placeholder',
                userAgent: 'SyntheticAgent'
            };
            const changed = {
                serverUrl: 'https://changed.example.invalid/catalog',
                username: 'changed-synthetic-user',
                password: 'changed-synthetic-placeholder',
                userAgent: 'ChangedSyntheticAgent'
            };
            const journal = JSON.stringify({ version: 1, contentTypes: ['movie'], recentlyViewed: [] });
            const reset = async () => {
                db.delete(schema.appState).run();
                db.delete(schema.playlists).run();
                db.insert(schema.playlists).values({
                    id: playlistId, name: 'Synthetic source', type: 'xtream',
                    serverUrl: ' https://synthetic.example.invalid:443/catalog/player_api.php/ ',
                    username: ' synthetic-user ', password: ' synthetic-placeholder ',
                    payload: JSON.stringify({ userAgent: ' SyntheticAgent ' })
                }).run();
                await setAppState(db, marker, 'failed');
                await setAppState(db, journalKey, journal);
            };
            const rejectedCondition = result => result.success === false && result.conditionChecked === true && result.connectionChanged === true;
            const acceptedCondition = result => result.success === true && result.conditionChecked === true;
            for (const type of ['live', 'movie', 'series']) {
                await reset();
                const key = 'xtream-import-status:' + playlistId + ':' + type;
                const result = await setAppState(db, key, 'completed', condition);
                results['normalized-' + type + '-completion'] = acceptedCondition(result) && (await getAppState(db, key)) === 'completed';
            }
            for (const field of Object.keys(changed)) {
                await reset();
                db.update(schema.playlists).set(field === 'userAgent'
                    ? { payload: JSON.stringify({ userAgent: changed[field] }) }
                    : { [field]: changed[field] }).where(eq(schema.playlists.id, playlistId)).run();
                const beforeJournal = await getAppState(db, journalKey);
                const completion = await setAppState(db, marker, 'completed', condition);
                results['changed-' + field + '-completion'] = rejectedCondition(completion) && (await getAppState(db, marker)) === 'failed';
                const acknowledgement = await setAppState(db, journalKey, '', condition);
                results['changed-' + field + '-ack'] = rejectedCondition(acknowledgement) && (await getAppState(db, journalKey)) === beforeJournal;
            }
            const current = { ...condition, userAgent: changed.userAgent };
            const acknowledged = await setAppState(db, journalKey, '', current);
            results['current-connection-ack'] = acceptedCondition(acknowledged) && (await getAppState(db, journalKey)) === '';
            await reset();
            await updatePlaylist(db, playlistId, { userAgent: ' ColumnSyntheticAgent ' });
            const columnCondition = { ...condition, userAgent: 'ColumnSyntheticAgent' };
            const columnAccepted = await setAppState(db, marker, 'completed', columnCondition);
            results['column-user-agent-wins-payload'] = acceptedCondition(columnAccepted) && (await getAppState(db, marker)) === 'completed';
            const oldPayloadRejected = await setAppState(db, marker, 'completed', condition);
            results['old-payload-user-agent-rejected'] = rejectedCondition(oldPayloadRejected) && (await getAppState(db, marker)) === 'completed';
            await reset();
            await updatePlaylist(db, playlistId, { userAgent: '' });
            const clearedAccepted = await setAppState(db, marker, 'completed', { ...condition, userAgent: undefined });
            results['empty-column-user-agent-clears-payload'] = acceptedCondition(clearedAccepted) && (await getAppState(db, marker)) === 'completed';
            const clearedRejected = await setAppState(db, marker, 'completed', condition);
            results['cleared-payload-user-agent-rejected'] = rejectedCondition(clearedRejected) && (await getAppState(db, marker)) === 'completed';
            await reset();
            const readonlyDb = { select: db.select.bind(db) };
            const stateBeforeCheck = JSON.stringify(db.select().from(schema.appState).all());
            const changesBeforeCheck = sqlite.prepare('SELECT total_changes() AS count').get().count;
            const readonlyMatch = checkXtreamCatalogConnection(readonlyDb, condition);
            const readonlyMismatch = checkXtreamCatalogConnection(readonlyDb, { ...condition, username: changed.username });
            const unchanged = stateBeforeCheck === JSON.stringify(db.select().from(schema.appState).all()) && changesBeforeCheck === sqlite.prepare('SELECT total_changes() AS count').get().count;
            results['readonly-matching-connection'] = acceptedCondition(readonlyMatch) && unchanged;
            results['readonly-mismatching-connection'] = rejectedCondition(readonlyMismatch) && unchanged;
            for (const [name, payload] of [
                ['malformed-json', '{broken'],
                ['scalar-payload', '17'],
                ['array-payload', '[]'],
                ['null-payload', 'null']
            ]) {
                await reset();
                db.update(schema.playlists).set({ payload }).where(eq(schema.playlists.id, playlistId)).run();
                const result = await setAppState(db, marker, 'completed', condition);
                results[name] = rejectedCondition(result) && (await getAppState(db, marker)) === 'failed';
            }
            await reset();
            db.delete(schema.playlists).run();
            const deletedMarker = await getAppState(db, marker);
            results['missing-playlist'] = rejectedCondition(await setAppState(db, marker, 'completed', condition)) && (await getAppState(db, marker)) === deletedMarker;
            await reset();
            db.update(schema.playlists).set({ type: 'm3u-url' }).where(eq(schema.playlists.id, playlistId)).run();
            results['wrong-playlist-type'] = rejectedCondition(await setAppState(db, marker, 'completed', condition)) && (await getAppState(db, marker)) === 'failed';
            for (const [name, key, value] of [
                ['unrelated-conditional-key', 'unrelated-setting', 'completed'],
                ['foreign-conditional-key', 'xtream-import-status:other-source:movie', 'completed'],
                ['invalid-conditional-value', marker, 'failed']
            ]) {
                await reset();
                const before = await getAppState(db, key);
                let rejected = false;
                try { await setAppState(db, key, value, condition); } catch { rejected = true; }
                results[name] = rejected && (await getAppState(db, key)) === before;
            }
            for (const [name, key, value] of [
                ['completion-write-rollback', marker, 'completed'],
                ['ack-write-rollback', journalKey, '']
            ]) {
                await reset();
                const before = await getAppState(db, key);
                const beforeJournal = await getAppState(db, journalKey);
                sqlite.exec("CREATE TRIGGER synthetic_state_write_fault BEFORE UPDATE ON app_state BEGIN SELECT RAISE(ABORT, 'synthetic state write fault'); END");
                let rejected = false;
                try { await setAppState(db, key, value, condition); } catch { rejected = true; }
                sqlite.exec('DROP TRIGGER synthetic_state_write_fault');
                results[name] = rejected && (await getAppState(db, key)) === before && (await getAppState(db, journalKey)) === beforeJournal;
            }
            await reset();
            const ordinary = await setAppState(db, 'unrelated-setting', 'synthetic-value');
            results['ordinary-setting-write'] = ordinary.success === true && ordinary.conditionChecked === undefined && (await getAppState(db, 'unrelated-setting')) === 'synthetic-value';
            sqlite.close();
            console.log(JSON.stringify(results));
        `;
        try {
            results = JSON.parse(
                execFileSync(
                    createRequire(__filename)('electron'),
                    ['--import', 'tsx', '--eval', script],
                    {
                        cwd: process.cwd(),
                        encoding: 'utf8',
                        stdio: 'pipe',
                        env: {
                            ...process.env,
                            ELECTRON_RUN_AS_NODE: '1',
                            TSX_TSCONFIG_PATH: resolve(
                                process.cwd(),
                                'tsconfig.base.json'
                            ),
                        },
                    }
                )
            );
        } catch {
            // Native query errors can include bound values. Keep fixture
            // diagnostics abstract instead of forwarding the child output.
            throw new Error('Synthetic conditional SQLite fixture failed.');
        }
    });

    it.each(scenarios)('%s', (name) => {
        expect(results[name]).toBe(true);
    });
});
