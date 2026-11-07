import { execFileSync } from 'node:child_process';
import { withRuntimeCoverage } from '@iptvnator/shared/testing/runtime-coverage';
import { ElectronHistoryStore } from './history-local';
import {
    emptyHistoryRecord,
    type HistoryRecord,
    type HistoryScope,
} from '@iptvnator/shared/interfaces/history-sync';
const scope: HistoryScope = {
    instanceId: 'nas',
    sourceId: 'source',
    sourceIncarnation: 'first',
    provider: 'xtream',
};
describe('atomic history local stores', () => {
    it('retries native CAS against a sibling write without dropping its intent', async () => {
        let value: HistoryRecord | null = null;
        let raced = false;
        const bridge = jest.fn(async (request) => {
            if (request.operation === 'read')
                return value === null
                    ? null
                    : JSON.parse(JSON.stringify(value));
            if (!raced) {
                raced = true;
                value = {
                    ...emptyHistoryRecord(),
                    local: [
                        {
                            operationId: 'sibling',
                            deviceId: 'device',
                            kind: 'clear',
                            baseRevision: 0,
                            viewedAt: 1,
                        },
                    ],
                };
                return { conflict: true };
            }
            value = request.value;
            return { value };
        });
        const native = new ElectronHistoryStore(bridge);
        await native.mutate(scope, (current) => ({
            ...current!,
            pending: [
                ...(current?.pending ?? []),
                {
                    consent: 'consent',
                    operation: {
                        operationId: 'own',
                        deviceId: 'device',
                        kind: 'clear',
                        baseRevision: 0,
                        viewedAt: 2,
                    },
                },
            ],
        }));
        expect((await native.read(scope))?.local).toHaveLength(1);
        expect((await native.read(scope))?.pending).toHaveLength(1);
        await expect(
            new ElectronHistoryStore(async () => ({ conflict: true })).mutate(
                scope,
                () => emptyHistoryRecord()
            )
        ).rejects.toThrow('busy');
    });
    it('captures the native CAS baseline before a mutator changes its input', async () => {
        const expected = JSON.stringify(emptyHistoryRecord());
        const bridge = jest.fn(async (request) => {
            if (request.operation === 'read') return JSON.parse(expected);
            expect(request.expected).toBe(expected);
            return { value: request.value };
        });
        await new ElectronHistoryStore(bridge).mutate(scope, (current) => {
            current!.archive = [
                {
                    kind: 'clear',
                    operationId: 'own',
                    deviceId: 'device',
                    baseRevision: 0,
                    viewedAt: 1,
                },
            ];
            return current!;
        });
        expect(bridge).toHaveBeenCalledTimes(2);
    });
    it(
        'serializes two real IDB tabs without Web Locks, rolls back and survives reload',
        async () =>
            withRuntimeCoverage((coverageFile) => {
                const result = execFileSync(
                    process.execPath,
                    [
                        '--import',
                        'tsx',
                        '--input-type=module',
                        '-e',
                        `
            import assert from 'node:assert/strict';
            import {build} from 'esbuild';
            import {chromium} from '@playwright/test';
            import {runtimeCoveragePlugin,writeRuntimeCoverage} from '@iptvnator/shared/testing/runtime-coverage';
            const bundle=(await build({stdin:{contents:"export {IndexedDbHistoryStore} from './libs/services/src/lib/history-sync/history-local';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'historyTest',tsconfig:'tsconfig.base.json',platform:'browser',plugins:[runtimeCoveragePlugin(/history-local[.]ts$/)]})).outputFiles[0].text;
            const browser=await chromium.launch({headless:true});
            try {
                const context=await browser.newContext();const pages=[await context.newPage(),await context.newPage()];
                for(const page of pages){await page.route('http://history.test/**',route=>route.fulfill({contentType:'text/html',body:'Synthetic history test'}));await page.goto('http://history.test');await page.evaluate(()=>Object.defineProperty(navigator,'locks',{value:undefined}));await page.addScriptTag({content:bundle});}
                const scope={instanceId:'nas',sourceId:'source',sourceIncarnation:'first',provider:'xtream'};
                await Promise.all(pages.map((page,tab)=>page.evaluate(async({scope,tab})=>{
                    const store=new window.historyTest.IndexedDbHistoryStore('nas');
                    for(let i=0;i<20;i++)await store.mutate(scope,current=>({base:current?.base??{revision:0,cleared:0,items:[]},local:[],pending:[...(current?.pending??[]),{consent:'consent',operation:{kind:'clear',operationId:'op-'+tab+'-'+i,deviceId:'device',baseRevision:0,viewedAt:i}}]}));
                },{scope,tab})));
                const before=await pages[0].evaluate(async scope=>new window.historyTest.IndexedDbHistoryStore('nas').read(scope),scope);assert.equal(before.pending.length,40);
                const checked=await pages[0].evaluate(async scope=>{const store=new window.historyTest.IndexedDbHistoryStore('nas');let failures=0;try{await store.mutate(scope,current=>{current.pending=[];throw new Error('synthetic rollback');});}catch{failures++;}try{await store.read({...scope,instanceId:'other'});}catch{failures++;}return {value:await store.read(scope),failures};},scope);
                assert.deepEqual(checked.value,before);assert.equal(checked.failures,2);
                const snapshots=await Promise.all(pages.map(page=>page.evaluate(()=>globalThis.__coverage__??{})));
                await pages[1].reload();await pages[1].addScriptTag({content:bundle});assert.deepEqual(await pages[1].evaluate(async scope=>new window.historyTest.IndexedDbHistoryStore('nas').read(scope),scope),before);
                snapshots.push(await pages[1].evaluate(()=>globalThis.__coverage__??{}));writeRuntimeCoverage(process.env.IPTVNATOR_TEST_COVERAGE_FILE,snapshots);await context.close();process.stdout.write('history IDB verified');
            } finally {await browser.close();}
        `,
                    ],
                    {
                        cwd: process.cwd(),
                        encoding: 'utf8',
                        timeout: 60000,
                        env: {
                            ...process.env,
                            TSX_TSCONFIG_PATH: 'tsconfig.base.json',
                            IPTVNATOR_TEST_COVERAGE_FILE: coverageFile,
                        },
                    }
                );
                expect(result).toBe('history IDB verified');
            }),
        70000
    );
});
