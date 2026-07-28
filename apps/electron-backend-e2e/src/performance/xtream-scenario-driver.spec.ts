import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    XTREAM_SCENARIO_ID,
    expectedXtreamWorkerRequestInventory,
    type XtreamScenarioId,
} from './xtream-benchmark-contract';
import {
    XTREAM_SCENARIO_DATABASE_REQUEST_COUNT,
    XTREAM_SYNTHETIC_CREDENTIALS,
    prepareXtreamScenario,
} from './xtream-scenario-driver';
import {
    installXtreamCancellationObserver,
    isXtreamCancellationProgress,
    xtreamCancellationThreshold,
} from './xtream-scenario-cancellation-observer';
import { FakeXtreamScenarioPage as FakePage } from './xtream-scenario-driver.fake-page';

const SOURCE_TITLE = 'Synthetic Xtream performance portal';
const SERVER_URL = 'http://127.0.0.1:43123';

describe('Xtream Playwright scenario driver', () => {
    it('pins local synthetic credentials and exact database request counts', () => {
        assert.deepEqual(XTREAM_SYNTHETIC_CREDENTIALS, {
            password: 'performance',
            username: 'performance',
        });
        assert.deepEqual(XTREAM_SCENARIO_DATABASE_REQUEST_COUNT, {
            'xtream-background-ui': 54,
            'xtream-cancel-import': 24,
            'xtream-delete-large': 2,
            'xtream-initial-import-large': 30,
            'xtream-refresh-large': 51,
        });

        for (const scenarioId of Object.values(XTREAM_SCENARIO_ID)) {
            const inventoryCount = expectedXtreamWorkerRequestInventory(
                scenarioId
            ).reduce((sum, entry) => sum + entry.count, 0);
            assert.equal(
                XTREAM_SCENARIO_DATABASE_REQUEST_COUNT[scenarioId],
                inventoryCount
            );
        }
    });

    it('accepts only the first qualifying live save-content progress event', () => {
        assert.equal(xtreamCancellationThreshold(999), 100);
        assert.equal(xtreamCancellationThreshold(10_000), 1_000);
        assert.equal(
            isXtreamCancellationProgress({
                current: 999,
                operation: 'save-content',
                status: 'progress',
                total: 10_000,
            }),
            false
        );
        assert.equal(
            isXtreamCancellationProgress({
                current: 1_000,
                operation: 'save-content',
                operationId: 'save-content-1',
                status: 'progress',
                total: 10_000,
            }),
            true
        );
        assert.equal(
            isXtreamCancellationProgress({
                current: 10_000,
                operation: 'delete-xtream-content',
                status: 'progress',
                total: 10_000,
            }),
            false
        );
        assert.equal(
            isXtreamCancellationProgress({
                current: 10_000,
                operation: 'save-content',
                status: 'completed',
                total: 10_000,
            }),
            false
        );
    });

    it('retains exact cancellation click identity and rejects anonymous evidence', async () => {
        const fake = new FakePage();
        const observer = await installXtreamCancellationObserver(fake.asPage());

        assert.deepEqual(await observer.waitForClick(), {
            armedEpochMs: 100,
            clickEpochMs: 201,
            current: 1_000,
            operationId: 'save-content-1',
            progressEpochMs: 200,
            threshold: 1_000,
            total: 10_000,
        });

        const anonymous = new FakePage();
        anonymous.cancellationSnapshot = {
            ...anonymous.cancellationSnapshot,
            operationId: null,
        };
        const anonymousObserver = await installXtreamCancellationObserver(
            anonymous.asPage()
        );
        await assert.rejects(
            () => anonymousObserver.waitForClick(),
            /cancellation-evidence-invalid/
        );
    });

    it('prepares initial import without clicking the final Add trigger', async () => {
        const fake = new FakePage();
        const prepared = await prepareXtreamScenario(
            fake.asPage(),
            scenarioOptions(XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE)
        );

        assert.equal(prepared.expectedDatabaseRequestCount, 30);
        assert.equal(prepared.backgroundOperation, null);
        assert.equal(fake.clicksMatching('name=Add;exact=true'), 0);
        assert.ok(
            fake.log.includes('fill:#title:Synthetic Xtream performance portal')
        );
        assert.ok(fake.log.includes('fill:#serverUrl:http://127.0.0.1:43123'));
        assert.ok(fake.log.includes('fill:#username:performance'));
        assert.ok(fake.log.includes('fill:#password:performance'));
        const dashboardReadyIndex = fake.log.indexOf(
            'waitForFunction:empty-dashboard-ready'
        );
        const openDialogIndex = fake.log.findIndex(
            (entry) =>
                entry.startsWith('click:') &&
                entry.includes('name=Add playlist;exact=true')
        );
        const openSourcesIndex = fake.log.findIndex(
            (entry) =>
                entry.startsWith('click:') &&
                entry.includes('name=Sources;exact=true')
        );
        assert.ok(dashboardReadyIndex >= 0);
        assert.ok(openSourcesIndex > dashboardReadyIndex);
        assert.ok(openDialogIndex > openSourcesIndex);
        assert.ok(fake.log.includes('waitFor:app-workspace-sources:visible'));

        const evidence = await prepared.trigger();
        assert.ok(Number.isFinite(evidence.triggerEpochMs));
        assert.equal(fake.clicksMatching('name=Add;exact=true'), 1);
        await assert.rejects(() => prepared.trigger(), /already-triggered/);
    });

    it('does not require a misleading portal-status badge before refresh or delete', async () => {
        for (const [scenarioId, selector] of [
            [XTREAM_SCENARIO_ID.REFRESH_LARGE, '.refresh-btn'],
            [XTREAM_SCENARIO_ID.DELETE_LARGE, '.delete-btn'],
        ] as const) {
            const fake = new FakePage();
            const prepared = await prepareXtreamScenario(
                fake.asPage(),
                scenarioOptions(scenarioId)
            );

            assert.equal(fake.clicksMatching(selector), 1);
            assert.equal(fake.clicksMatching('name=Yes;exact=true'), 0);
            const portalReadyIndex = fake.log.findIndex((entry) =>
                entry.includes('[aria-label="Portal status: active"]:visible')
            );
            const sourceActionIndex = fake.log.findIndex(
                (entry) =>
                    entry.startsWith('click:') && entry.includes(selector)
            );
            assert.equal(portalReadyIndex, -1);
            assert.ok(sourceActionIndex >= 0);
            await prepared.trigger();
            assert.equal(fake.clicksMatching('name=Yes;exact=true'), 1);
        }
    });

    it('arms cancellation after preparation and immediately before the final Add trigger', async () => {
        const fake = new FakePage();
        const prepared = await prepareXtreamScenario(
            fake.asPage(),
            scenarioOptions(XTREAM_SCENARIO_ID.CANCEL_IMPORT)
        );
        const openIndex = fake.log.findIndex(
            (entry) =>
                entry.startsWith('click:') &&
                entry.includes('name=Add playlist;exact=true')
        );

        assert.equal(
            fake.log.indexOf('evaluate:install-cancellation'),
            -1,
            'the renderer probe must be able to subscribe before cancellation'
        );
        await prepared.trigger();
        const installIndex = fake.log.indexOf('evaluate:install-cancellation');
        const triggerIndex = fake.log.findIndex(
            (entry) =>
                entry.startsWith('click:') &&
                entry.includes('name=Add;exact=true')
        );
        assert.ok(installIndex > openIndex);
        assert.ok(triggerIndex > installIndex);
        assert.equal(prepared.expectedDatabaseRequestCount, 24);
    });

    it('uses the exact delete request as the causal start of the full refresh probe', async () => {
        const fake = new FakePage();
        fake.operationSnapshot = {
            active: true,
            operation: 'delete-xtream-content',
            operationId: 'xtream-refresh-1',
            playlistId: 'playlist-1',
            startedEpochMs: 100,
            terminalEpochMs: null,
            terminalStatus: null,
        };
        const prepared = await prepareXtreamScenario(
            fake.asPage(),
            scenarioOptions(XTREAM_SCENARIO_ID.BACKGROUND_UI)
        );
        await prepared.trigger();
        const calls: string[] = [];
        const evidence = await prepared.runBackgroundProbe(
            async ({ operation, page, sourceTitle }) => {
                calls.push('type-filter');
                calls.push('dashboard');
                calls.push('sources');
                calls.push('name-a-z');
                calls.push('global-search');
                assert.equal(operation, 'delete-xtream-content');
                assert.equal(page, fake.asPageReference);
                assert.equal(sourceTitle, SOURCE_TITLE);
                return { samples: 5 };
            }
        );

        assert.deepEqual(calls, [
            'type-filter',
            'dashboard',
            'sources',
            'name-a-z',
            'global-search',
        ]);
        assert.equal(evidence.operation, 'delete-xtream-content');
        assert.deepEqual(evidence.result, { samples: 5 });
        assert.ok(
            fake.log.some(
                (entry) => entry === 'waitForFunction:operation-active'
            )
        );
    });

    it('rejects non-loopback origins before touching the page', async () => {
        const fake = new FakePage();

        await assert.rejects(
            () =>
                prepareXtreamScenario(fake.asPage(), {
                    ...scenarioOptions(XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE),
                    serverUrl: 'https://provider.example',
                }),
            /loopback mock origin/
        );
        assert.deepEqual(fake.log, []);
    });

    it('allows the refresh probe to continue after the delete prelude closes', async () => {
        const fake = new FakePage();
        const active = {
            active: true,
            operation: 'delete-xtream-content',
            operationId: 'xtream-refresh-1',
            playlistId: 'playlist-1',
            startedEpochMs: 100,
            terminalEpochMs: null,
            terminalStatus: null,
        } as const;
        fake.operationSnapshots.push(active, active, {
            ...active,
            active: false,
            terminalEpochMs: 150,
            terminalStatus: 'completed',
        });
        const prepared = await prepareXtreamScenario(
            fake.asPage(),
            scenarioOptions(XTREAM_SCENARIO_ID.BACKGROUND_UI)
        );
        await prepared.trigger();
        let probeCalls = 0;

        await prepared.runBackgroundProbe(async () => {
            probeCalls += 1;
            return null;
        });
        assert.equal(probeCalls, 1);
    });

    it('fails closed before the probe when delete request identity is missing', async () => {
        const fake = new FakePage();
        fake.operationSnapshot = {
            active: true,
            operation: 'delete-xtream-content',
            operationId: null,
            playlistId: null,
            startedEpochMs: 100,
            terminalEpochMs: null,
            terminalStatus: null,
        };
        const prepared = await prepareXtreamScenario(
            fake.asPage(),
            scenarioOptions(XTREAM_SCENARIO_ID.BACKGROUND_UI)
        );
        await prepared.trigger();
        let probeCalls = 0;

        await assert.rejects(
            () =>
                prepared.runBackgroundProbe(async () => {
                    probeCalls += 1;
                }),
            /operation-window-invalid/
        );
        assert.equal(probeCalls, 0);
    });
});

function scenarioOptions(scenarioId: XtreamScenarioId) {
    return {
        scenarioId,
        serverUrl: SERVER_URL,
        sourceTitle: SOURCE_TITLE,
    };
}
