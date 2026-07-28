import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const source = (name: string): string =>
    readFileSync(resolve(process.cwd(), 'src/performance', name), 'utf8');

describe('Xtream scenario driver source wiring', () => {
    it('keeps each scenario module below the repository line limit', () => {
        for (const name of [
            'xtream-scenario-cancellation-observer.ts',
            'xtream-scenario-driver.ts',
            'xtream-scenario-driver.fake-page.ts',
            'xtream-scenario-operation-observer.ts',
            'xtream-scenario-ui.ts',
        ]) {
            assert.ok(
                source(name).split('\n').length <= 400,
                `${name} must stay at or below 400 lines`
            );
        }
    });

    it('uses exact resilient UI selectors and deterministic terminal gates', () => {
        const ui = source('xtream-scenario-ui.ts');

        for (const selector of [
            "'Add playlist'",
            '\'mat-button-toggle[value="xtream"]\'',
            "'#title'",
            "'#serverUrl'",
            "'#username'",
            "'#password'",
            "'app-playlist-item'",
            "'.refresh-btn'",
            "'.delete-btn'",
            "'Yes'",
            "'.busy-state__message'",
            "'.action-spinner'",
            "'.cancel-btn'",
            "'.workspace-loading-overlay'",
        ]) {
            assert.ok(ui.includes(selector), `missing ${selector}`);
        }
        assert.match(ui, /xtream.*credentials/i);
        assert.match(ui, /name:\s*'Add',\s*exact:\s*true/);
        assert.match(ui, /\/workspace\\\/xtreams/);
    });

    it('arms exact operation listeners with no timer-based coordination', () => {
        const cancellation = source('xtream-scenario-cancellation-observer.ts');
        const observer = source('xtream-scenario-operation-observer.ts');
        const driver = source('xtream-scenario-driver.ts');
        const combined = `${cancellation}\n${observer}\n${driver}`;

        assert.ok(observer.includes('onDbOperationEvent'));
        assert.ok(cancellation.includes('onDbOperationEvent'));
        assert.ok(cancellation.includes("'save-content'"));
        assert.ok(observer.includes("'delete-xtream-content'"));
        assert.ok(
            cancellation.includes("'.workspace-loading-overlay__action'")
        );
        assert.match(
            cancellation,
            /Math\.max\(100,\s*Math\.floor\(total \* 0\.1\)\)/
        );
        assert.ok(driver.includes('installXtreamCancellationObserver'));
        assert.ok(driver.includes('installXtreamOperationWindow'));
        assert.ok(driver.includes('runBackgroundProbe'));
        assert.doesNotMatch(combined, /waitForTimeout\s*\(/);
        assert.doesNotMatch(combined, /setTimeout\s*\(/);
        assert.doesNotMatch(combined, /\bsleep\s*\(/);
    });

    it('finishes add-dialog setup before arming a seed capture', () => {
        const support = source('xtream-benchmark-iteration-support.ts');
        const seedStart = support.indexOf(
            'export async function seedXtreamExistingPortal'
        );
        const prepare = support.indexOf(
            'await prepareXtreamScenario',
            seedStart
        );
        const capture = support.indexOf('await startMainCapture', seedStart);
        const trigger = support.indexOf('await seed.trigger()', seedStart);

        assert.ok(seedStart >= 0);
        assert.ok(prepare > seedStart);
        assert.ok(capture > prepare);
        assert.ok(trigger > capture);
    });

    it('fences seed settlement on the exact renderer store terminal', () => {
        const support = source('xtream-benchmark-iteration-support.ts');
        const seedStart = support.indexOf(
            'export async function seedXtreamExistingPortal'
        );
        const install = support.indexOf(
            'await installXtreamRendererProbe',
            seedStart
        );
        const capture = support.indexOf('await startMainCapture', seedStart);
        const begin = support.indexOf(
            'await beginXtreamRendererOperation',
            seedStart
        );
        const trigger = support.indexOf('await seed.trigger()', seedStart);
        const terminal = support.indexOf(
            'await waitForXtreamRendererTerminal',
            seedStart
        );
        const complete = support.indexOf(
            'assertCompleteXtreamRendererProbe',
            terminal
        );
        const settlement = support.indexOf(
            'await assertXtreamSettlementAfterTerminal',
            terminal
        );

        assert.ok(install > seedStart);
        assert.ok(capture > install);
        assert.ok(begin > capture);
        assert.ok(trigger > begin);
        assert.ok(terminal > trigger);
        assert.ok(complete > terminal);
        assert.ok(settlement > complete);
    });

    it('prearms the persistent database worker outside the measured capture', () => {
        const iteration = source('xtream-benchmark-iteration.ts');
        const support = source('xtream-benchmark-iteration-support.ts');
        const install = iteration.indexOf(
            'await installMainCapture(app.electronApp)'
        );
        const prearm = iteration.indexOf(
            'await prearmXtreamDatabaseWorker(app)'
        );
        const captureOptions = iteration.indexOf(
            'const captureOptions: MainCaptureStartOptions'
        );

        assert.match(
            support,
            /export async function prearmXtreamDatabaseWorker/
        );
        const mainDatabaseReady = support.indexOf(
            'window.electron.downloadsGetList()'
        );
        const workerPrearm = support.indexOf(
            'window.electron.dbGetAppPlaylists()'
        );
        assert.ok(mainDatabaseReady >= 0);
        assert.ok(workerPrearm > mainDatabaseReady);
        assert.ok(install >= 0);
        assert.ok(prearm > install);
        assert.ok(captureOptions > prearm);
    });

    it('subscribes the renderer probe before the cancellation observer is armed', () => {
        const iteration = source('xtream-benchmark-iteration.ts');
        const renderer = iteration.indexOf('await startXtreamRendererCapture');
        const operation = iteration.indexOf(
            'await renderer.beginOperation()',
            renderer
        );
        const trigger = iteration.indexOf(
            'trigger = await prepared.trigger()',
            operation
        );

        assert.ok(renderer >= 0);
        assert.ok(operation > renderer);
        assert.ok(trigger > operation);
    });
});
