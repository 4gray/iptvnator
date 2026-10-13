import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
    componentDeclarations,
    findFormFieldsWithoutDefaults,
    listScannedFiles,
    templateRendersFormField,
} from './check-form-field-defaults.mjs';

const lines = (...rows) => rows.join('\n');

const component = ({
    name = 'FieldComponent',
    imports = ['AppFormFieldModule'],
    template,
    templateUrl,
    importLine = "import { AppFormFieldModule } from '@iptvnator/ui/components/form-field';",
}) =>
    lines(
        "import { Component } from '@angular/core';",
        importLine,
        '',
        '@Component({',
        `    selector: 'app-field',`,
        `    imports: [${imports.join(', ')}],`,
        template !== undefined
            ? `    template: \`${template}\`,`
            : `    templateUrl: '${templateUrl}',`,
        '})',
        `export class ${name} {}`
    );

const noTemplates = () => {
    throw new Error('no templateUrl expected');
};

test('accepts a form field in a component that imports the defaults module', async () => {
    const source = component({
        template: '<mat-form-field><input matInput /></mat-form-field>',
    });
    assert.deepEqual(
        await findFormFieldsWithoutDefaults(
            'a.component.ts',
            source,
            noTemplates
        ),
        []
    );
});

test('reports the line of the @Component decorator when the defaults module is missing', async () => {
    const source = component({
        imports: ['MatFormFieldModule'],
        importLine:
            "import { MatFormFieldModule } from '@angular/material/form-field';",
        template: '<mat-form-field><input matInput /></mat-form-field>',
    });
    assert.deepEqual(
        await findFormFieldsWithoutDefaults(
            'a.component.ts',
            source,
            noTemplates
        ),
        [{ file: 'a.component.ts', line: 4, className: 'FieldComponent' }]
    );
});

test('a same-named class from elsewhere does not count as the defaults module', async () => {
    const source = component({
        importLine: "import { AppFormFieldModule } from './local-module';",
        template: '<mat-form-field></mat-form-field>',
    });
    assert.equal(
        (
            await findFormFieldsWithoutDefaults(
                'a.component.ts',
                source,
                noTemplates
            )
        ).length,
        1
    );
});

test('a relative import of the module source counts inside its own library', async () => {
    const source = component({
        importLine:
            "import { AppFormFieldModule } from '../../form-field/app-form-field.module';",
        template: '<mat-form-field></mat-form-field>',
    });
    assert.deepEqual(
        await findFormFieldsWithoutDefaults(
            'a.component.ts',
            source,
            noTemplates
        ),
        []
    );
});

test('reads templateUrl templates and sees form fields inside control flow', async () => {
    const source = component({
        imports: ['MatInputModule'],
        importLine: "import { MatInputModule } from '@angular/material/input';",
        templateUrl: './a.component.html',
    });
    const urls = [];
    const findings = await findFormFieldsWithoutDefaults(
        'dir/a.component.ts',
        source,
        async (url) => {
            urls.push(url);
            return lines(
                '@if (editing()) {',
                '    <mat-form-field appearance="fill">',
                '        <input matInput />',
                '    </mat-form-field>',
                '}'
            );
        }
    );
    assert.deepEqual(urls, ['./a.component.html']);
    assert.equal(findings.length, 1);
});

test('ignores components without a form field and classes without a template', async () => {
    const source = lines(
        component({
            imports: ['MatButtonModule'],
            importLine:
                "import { MatButtonModule } from '@angular/material/button';",
            template: '<button mat-button>Save</button>',
        }),
        '@Injectable({ providedIn: "root" })',
        'export class PlainService {}'
    );
    assert.deepEqual(
        await findFormFieldsWithoutDefaults('a.ts', source, noTemplates),
        []
    );
});

test('templateRendersFormField does not match a form field inside a comment', () => {
    assert.equal(
        templateRendersFormField(
            '<!-- <mat-form-field></mat-form-field> -->',
            'a.html'
        ),
        false
    );
    assert.equal(
        templateRendersFormField(
            '<div><ng-template><mat-form-field /></ng-template></div>',
            'a.html'
        ),
        true
    );
});

test('componentDeclarations flattens nested import arrays and keeps the template url', () => {
    const { components, bindsDefaultsModule } = componentDeclarations(
        lines(
            "import { Component } from '@angular/core';",
            "import { AppFormFieldModule } from '@iptvnator/ui/components/form-field';",
            'const SHARED = [AppFormFieldModule];',
            '@Component({',
            '    imports: [[MatInputModule, SHARED], AppFormFieldModule],',
            "    templateUrl: './x.html',",
            '})',
            'export class XComponent {}'
        ),
        'x.ts'
    );
    assert.equal(bindsDefaultsModule, true);
    assert.deepEqual(components, [
        {
            className: 'XComponent',
            line: 4,
            template: undefined,
            templateUrl: './x.html',
            imports: ['MatInputModule', 'SHARED', 'AppFormFieldModule'],
        },
    ]);
});

test('listScannedFiles returns tracked renderer sources and skips specs', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'form-field-guard-'));
    try {
        await mkdir(path.join(root, 'libs/ui/src'), { recursive: true });
        await mkdir(path.join(root, 'apps/web/src'), { recursive: true });
        await writeFile(path.join(root, 'libs/ui/src/a.component.ts'), '');
        await writeFile(path.join(root, 'libs/ui/src/a.component.spec.ts'), '');
        await writeFile(path.join(root, 'apps/web/src/b.component.ts'), '');
        await writeFile(path.join(root, 'apps/web/src/untracked.ts'), '');
        execFileSync('git', ['init', '-q'], { cwd: root });
        execFileSync(
            'git',
            [
                'add',
                'libs/ui/src/a.component.ts',
                'libs/ui/src/a.component.spec.ts',
                'apps/web/src/b.component.ts',
            ],
            { cwd: root }
        );
        assert.deepEqual(listScannedFiles(root).sort(), [
            'apps/web/src/b.component.ts',
            'libs/ui/src/a.component.ts',
        ]);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
