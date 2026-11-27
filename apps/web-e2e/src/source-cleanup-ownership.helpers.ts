import type { Browser } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';
import { expect } from './fixtures';

/** Run the production owner implementation in real independent browser tabs. */
export async function verifySourceCleanupOwnership(
    browser: Browser,
    ending: 'complete' | 'close' | 'reject'
) {
    const source = await readFile(
        resolve(
            __dirname,
            '../../../libs/services/src/lib/indexeddb-exclusive-access.ts'
        ),
        'utf8'
    );
    const code = ts.transpileModule(source, {
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ES2022,
        },
    }).outputText;
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const ownerUrl = 'http://cleanup.fixture.invalid/__cleanup-owner__';
    await context.route(ownerUrl, (route) =>
        route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html>',
        })
    );
    const first = await context.newPage();
    const second = await context.newPage();
    await first.goto(ownerUrl);
    await second.goto(ownerUrl);
    expect(
        await first.evaluate(() => window.isSecureContext || !!navigator.locks)
    ).toBe(false);
    const firstTask = first
        .evaluate(
            async ({ code, ending }) => {
                const url = URL.createObjectURL(
                    new Blob([code], { type: 'text/javascript' })
                );
                const { withIndexedDbExclusiveAccess: own } = await import(url);
                URL.revokeObjectURL(url);
                await own('iptvnator-source-cleanup:profile', async () => {
                    localStorage.setItem('first-entered', '1');
                    await new Promise<void>((resolve) =>
                        Reflect.set(globalThis, 'releaseCleanup', resolve)
                    );
                    if (ending === 'reject')
                        throw new Error('synthetic hook failure');
                    localStorage.setItem('first-completed', '1');
                });
                return 'completed';
            },
            { code, ending }
        )
        .catch((error: Error) => error.message);
    let secondTask: Promise<string> | undefined;
    try {
        await expect
            .poll(() =>
                second.evaluate(() => localStorage.getItem('first-entered'))
            )
            .toBe('1');
        secondTask = second
            .evaluate(async (code) => {
                const original = indexedDB.open;
                indexedDB.open = (name, version) => {
                    const request =
                        version === undefined
                            ? original.call(indexedDB, name)
                            : original.call(indexedDB, name, version);
                    request.addEventListener('blocked', () =>
                        localStorage.setItem('second-blocked', '1')
                    );
                    return request;
                };
                const url = URL.createObjectURL(
                    new Blob([code], { type: 'text/javascript' })
                );
                const { withIndexedDbExclusiveAccess: own } = await import(url);
                URL.revokeObjectURL(url);
                await own('iptvnator-source-cleanup:profile', async () => {
                    localStorage.setItem('second-entered', '1');
                });
                return 'completed';
            }, code)
            .catch((error: Error) => error.message);
        await expect
            .poll(() =>
                second.evaluate(() => localStorage.getItem('second-blocked'))
            )
            .toBe('1');
        expect(
            await second.evaluate(() => localStorage.getItem('second-entered'))
        ).toBeNull();
        // Another profile is independent while this profile's owner is held.
        await second.evaluate(async (code) => {
            const url = URL.createObjectURL(
                new Blob([code], { type: 'text/javascript' })
            );
            const { withIndexedDbExclusiveAccess: own } = await import(url);
            URL.revokeObjectURL(url);
            await own(
                'iptvnator-source-cleanup:other-profile',
                async () => undefined
            );
        }, code);
        if (ending === 'close') await first.close();
        else
            await first.evaluate(() =>
                Reflect.get(globalThis, 'releaseCleanup')()
            );
        expect(await secondTask).toBe('completed');
        const firstResult = await firstTask;
        if (ending === 'complete') expect(firstResult).toBe('completed');
        if (ending === 'reject')
            expect(firstResult).toContain('synthetic hook failure');
        expect(
            await second.evaluate(() => localStorage.getItem('second-entered'))
        ).toBe('1');
    } finally {
        await context.close();
        await firstTask;
        await secondTask;
    }
}
