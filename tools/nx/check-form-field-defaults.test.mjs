import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    DEFAULTS_FILE,
    checkComponentSource,
    listScannedFiles,
} from './check-form-field-defaults.mjs';

const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);
const templates = {
    'libs/a/field.component.html':
        '<mat-form-field><input matInput /></mat-form-field>',
    'libs/a/plain.component.html': '<button mat-button>Save</button>',
};
const readTemplate = async (file) => templates[file];
const check = async (file, source) =>
    (await checkComponentSource(file, source, readTemplate)).map(
        ({ line, reason }) => ({ line, reason })
    );

test('accepts a templateUrl form field with the provider', async () => {
    const source = [
        '@Component({',
        "    selector: 'app-field',",
        '    providers: [provideFormFieldDefaults()],',
        "    templateUrl: './field.component.html',",
        '})',
    ].join('\n');

    assert.deepEqual(await check('libs/a/field.component.ts', source), []);
});

test('accepts the provider next to other providers', async () => {
    const source = [
        '@Component({',
        '    providers: [DatePipe, provideFormFieldDefaults()],',
        "    templateUrl: './field.component.html',",
        '})',
    ].join('\n');

    assert.deepEqual(await check('libs/a/field.component.ts', source), []);
});

test('reports a templateUrl form field without the provider', async () => {
    const source = [
        '@Component({',
        "    selector: 'app-field',",
        "    templateUrl: './field.component.html',",
        '})',
    ].join('\n');

    assert.deepEqual(await check('libs/a/field.component.ts', source), [
        {
            line: 1,
            reason: 'renders <mat-form-field> without providers: [provideFormFieldDefaults()]',
        },
    ]);
});

test('reports an inline template form field without the provider', async () => {
    const source = [
        '@Component({',
        '    template: `',
        '        <mat-form-field appearance="outline"></mat-form-field>',
        '    `,',
        '})',
    ].join('\n');

    assert.equal((await check('libs/a/inline.component.ts', source)).length, 1);
});

test('reads quoted inline templates', async () => {
    const source = [
        '@Component({',
        "    template: '<mat-form-field></mat-form-field>',",
        '})',
        'class Single {}',
        '@Component({',
        '    template: "<mat-form-field></mat-form-field>",',
        '})',
        'class Double {}',
    ].join('\n');

    assert.deepEqual(
        (await check('libs/a/quoted.component.ts', source)).map(
            ({ line }) => line
        ),
        [1, 5]
    );
});

test('checks each component of a file on its own providers', async () => {
    const source = [
        '@Component({',
        '    providers: [provideFormFieldDefaults()],',
        "    templateUrl: './field.component.html',",
        '})',
        'class WithDefaults {}',
        '@Component({',
        "    templateUrl: './field.component.html',",
        '})',
        'class WithoutDefaults {}',
    ].join('\n');

    assert.deepEqual(await check('libs/a/field.component.ts', source), [
        {
            line: 6,
            reason: 'renders <mat-form-field> without providers: [provideFormFieldDefaults()]',
        },
    ]);
});

test('finds the provider after an earlier array-valued provider', async () => {
    const source = [
        '@Component({',
        '    providers: [',
        '        { provide: LIST, useValue: [] },',
        '        provideFormFieldDefaults(),',
        '    ],',
        "    templateUrl: './field.component.html',",
        '})',
    ].join('\n');

    assert.deepEqual(await check('libs/a/field.component.ts', source), []);
});

test('reports the provider outside a component', async () => {
    const appConfig = [
        'export const appConfig = {',
        '    providers: [provideRouter(routes), provideFormFieldDefaults()],',
        '};',
    ].join('\n');
    const routes = [
        'export const routes = [',
        "    { path: 'settings', providers: [provideFormFieldDefaults()] },",
        '];',
    ].join('\n');

    assert.deepEqual(await check('apps/web/src/app/app.config.ts', appConfig), [
        {
            line: 2,
            reason: "calls provideFormFieldDefaults() outside a component's providers; a root or route provider loads Material's form field on startup",
        },
    ]);
    assert.equal(
        (await check('apps/web/src/app/app.routes.ts', routes)).length,
        1
    );
});

test('ignores templates without a form field', async () => {
    const source = [
        '@Component({',
        "    templateUrl: './plain.component.html',",
        '})',
        '@Component({ template: `<mat-icon>add</mat-icon>` })',
    ].join('\n');

    assert.deepEqual(await check('libs/a/plain.component.ts', source), []);
});

test('reports the token outside the shared provider', async () => {
    const source = [
        "import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';",
        'export const appConfig = {',
        '    providers: [{ provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: {} }],',
        '};',
    ].join('\n');

    assert.deepEqual(
        (await check('apps/web/src/app/app.config.ts', source)).map(
            ({ line }) => line
        ),
        [1, 3]
    );
    assert.deepEqual(await check(DEFAULTS_FILE, source), []);
});

test('the shared provider supplies the outline, dynamic defaults', async () => {
    const source = await readFile(path.join(repoRoot, DEFAULTS_FILE), 'utf8');

    assert.match(source, /appearance: 'outline'/);
    assert.match(source, /subscriptSizing: 'dynamic'/);
    assert.match(source, /provide: MAT_FORM_FIELD_DEFAULT_OPTIONS/);
});

test('scans renderer TypeScript and skips specs', () => {
    const files = listScannedFiles(repoRoot);

    assert.ok(files.includes(DEFAULTS_FILE));
    assert.ok(files.includes('apps/web/src/app/app.config.ts'));
    assert.ok(files.every((file) => !/\.spec\.ts$/.test(file)));
});
