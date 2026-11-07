import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { SettingsStore } from '@iptvnator/services';
import { BulkImportComponent } from './bulk-import.component';
import {
    BulkImportRunnerService,
    type BulkImportRowStatus,
} from './bulk-import-runner.service';

describe('BulkImportComponent', () => {
    let component: BulkImportComponent;
    let fixture: ComponentFixture<BulkImportComponent>;
    let runner: {
        run: jest.Mock;
        running: ReturnType<typeof signal<boolean>>;
        statuses: ReturnType<
            typeof signal<Record<string, BulkImportRowStatus>>
        >;
    };

    beforeEach(waitForAsync(() => {
        runner = {
            run: jest
                .fn()
                .mockResolvedValue({ imported: 1, slow: 0, failed: 0 }),
            running: signal(false),
            statuses: signal({}),
        };
        TestBed.configureTestingModule({
            imports: [BulkImportComponent, TranslateModule.forRoot()],
            providers: [
                provideNoopAnimations(),
                { provide: BulkImportRunnerService, useValue: runner },
                {
                    provide: SettingsStore,
                    useValue: { disableVod: () => false },
                },
            ],
        }).compileComponents();
    }));

    beforeEach(() => {
        fixture = TestBed.createComponent(BulkImportComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    /** Picks a bulk list file the way the hidden input does. */
    async function pickFile(name: string, contents: string): Promise<void> {
        await component.onFilePicked(createFileInput(name, contents));
    }

    function createFileInput(name: string, contents: string): HTMLInputElement {
        const file = {
            name,
            text: jest.fn().mockResolvedValue(contents),
        };
        const input = document.createElement('input');
        Object.defineProperty(input, 'files', {
            value: [file],
        });
        return input;
    }

    it('detects several sources from one file', async () => {
        await pickFile(
            'sources.txt',
            'http://lists.example.com/a.m3u\nhttp://lists.example.com/b.m3u'
        );

        expect(component.entries()).toHaveLength(2);
        expect(component.importableEntries()).toHaveLength(2);
        expect(component.loadedFileName()).toBe('sources.txt');
        expect(component.fileError()).toBeNull();
    });

    it('maps each get.php portal link to one xtream row without an m3u duplicate', async () => {
        await pickFile(
            'portals.txt',
            [
                'http://panel.example/get.php?username=user&password=pass&type=m3u_plus',
                'http://other.example/get.php?username=u2&password=p2&type=m3u_plus',
            ].join('\n')
        );

        expect(component.entries()).toHaveLength(2);
        expect(component.entries().map((entry) => entry.kind)).toEqual([
            'xtream',
            'xtream',
        ]);
        expect(component.importableEntries()).toHaveLength(2);
    });

    it('parses a structured JSON source list', async () => {
        await pickFile(
            'sources.json',
            JSON.stringify({
                sources: [
                    {
                        type: 'xtream',
                        title: 'Gold',
                        serverUrl: 'http://panel.example',
                        username: 'user',
                        password: 'pass',
                        importVod: false,
                    },
                ],
            })
        );

        expect(component.entries()).toHaveLength(1);
        expect(component.entries()[0]).toMatchObject({
            kind: 'xtream',
            title: 'Gold',
            importVod: false,
            valid: true,
        });
    });

    it('starts every row with VOD off until it is selected', async () => {
        await pickFile(
            'sources.txt',
            'http://lists.example.com/a.m3u\nhttp://lists.example.com/b.m3u'
        );

        expect(component.entries().map((entry) => entry.importLive)).toEqual([
            true,
            true,
        ]);
        expect(component.entries().map((entry) => entry.importVod)).toEqual([
            false,
            false,
        ]);
    });

    it('reports JSON that is not a source list instead of guessing', async () => {
        await pickFile('sources.json', '{"oops": true}');

        expect(component.entries()).toHaveLength(0);
        // TranslateModule.forRoot() ships no translations in tests, so the
        // service echoes the key — the dialog shows the translated message.
        expect(component.fileError()).toBe(
            'HOME.ADD_PLAYLIST.BULK_INVALID_JSON'
        );
    });

    it('treats a well-shaped list with no usable items as empty', async () => {
        await pickFile('sources.json', '{"sources": [42]}');

        expect(component.entries()).toHaveLength(0);
        expect(component.fileError()).toBeNull();
    });

    it('keeps at least one section per row', async () => {
        await pickFile('sources.txt', 'http://lists.example.com/a.m3u');
        const [entry] = component.entries();

        component.setEntryVod(entry.id, false);
        component.setEntryLive(entry.id, false);

        const updated = component.entries()[0];
        expect(updated.importVod).toBe(false);
        expect(updated.importLive).toBe(true);
    });

    it('keeps row scope stable after parsing', async () => {
        await pickFile(
            'sources.json',
            JSON.stringify({
                sources: [
                    {
                        type: 'm3u-url',
                        title: 'Live Only',
                        url: 'http://lists.example.com/a.m3u',
                        importVod: false,
                    },
                ],
            })
        );
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const row = fixture.nativeElement.querySelector('.bulk__row');
        const boxes: HTMLInputElement[] = Array.from(
            row.querySelectorAll('input[type="checkbox"]')
        );
        expect(component.entries()[0]).toMatchObject({
            importLive: true,
            importVod: false,
        });
        expect(boxes).toHaveLength(2);
        expect(boxes[0].checked).toBe(true);
        expect(boxes[1].checked).toBe(false);
    });

    it('hands the importable rows to the runner and closes when it finishes', async () => {
        await pickFile(
            'sources.json',
            JSON.stringify({
                sources: [
                    {
                        type: 'xtream',
                        title: 'Gold',
                        serverUrl: 'http://panel.example',
                        username: 'user',
                        password: 'pass',
                    },
                    { type: 'xtream', title: 'Incomplete' },
                ],
            })
        );
        const emitted: void[] = [];
        component.imported.subscribe(() => emitted.push(undefined));

        await component.importAll();

        expect(runner.run).toHaveBeenCalledWith([
            expect.objectContaining({ title: 'Gold', valid: true }),
        ]);
        expect(emitted).toHaveLength(1);
    });

    it('stays open when the runner refused to replace the sources', async () => {
        runner.run.mockResolvedValue(null);
        await pickFile('sources.txt', 'http://lists.example.com/a.m3u');
        const emitted: void[] = [];
        component.imported.subscribe(() => emitted.push(undefined));

        await component.importAll();

        expect(emitted).toHaveLength(0);
    });

    it("shows each row's import progress", async () => {
        await pickFile('sources.txt', 'http://lists.example.com/a.m3u');
        const [row] = component.entries();
        runner.statuses.set({ [row.id]: 'slow' });
        fixture.detectChanges();

        const status = fixture.nativeElement.querySelector(
            '[data-test-id="bulk-row-status"]'
        );
        expect(status.dataset.status).toBe('slow');
        expect(status.textContent.trim()).toBe(
            'HOME.ADD_PLAYLIST.BULK_STATUS_SLOW'
        );
    });

    it('does nothing without importable rows', async () => {
        await pickFile('sources.txt', 'hello world');

        await component.importAll();

        expect(runner.run).not.toHaveBeenCalled();
    });

    it('names why a row cannot be imported', async () => {
        await pickFile('sources.txt', '00:1A:79:00:00:01');

        const [row] = component.entries();
        expect(row.valid).toBe(false);
        expect(component.entryIssueKey(row)).toBe(
            'HOME.ADD_PLAYLIST.BULK_ROW_NO_PORTAL'
        );
    });

    it('labels a portal row that has no MAC address', async () => {
        await pickFile(
            'sources.json',
            JSON.stringify({
                sources: [
                    { type: 'stalker', portalUrl: 'http://panel.example/c' },
                ],
            })
        );

        expect(component.entryIssueKey(component.entries()[0])).toBe(
            'HOME.ADD_PLAYLIST.BULK_ROW_NO_MAC'
        );
    });

    it('says a file has nothing to import when no row is usable', async () => {
        await pickFile(
            'sources.json',
            JSON.stringify({ sources: [{ type: 'xtream', title: 'Broken' }] })
        );
        fixture.detectChanges();

        expect(component.nothingImportable()).toBe(true);
        // TranslateModule.forRoot() ships no translations in tests, so the
        // translate pipe echoes the key the dialog translates at runtime.
        const notice = fixture.nativeElement.querySelector(
            '[data-test-id="bulk-nothing-importable"]'
        );
        expect(notice.textContent.trim()).toBe(
            'HOME.ADD_PLAYLIST.BULK_NOTHING_IMPORTABLE'
        );
    });

    it('imports every row of a multi-panel portal|MAC list file', async () => {
        const contents = readFileSync(
            resolve(__dirname, 'top-stalker.example.txt'),
            'utf8'
        );

        await pickFile('top_stalker.txt', contents);

        const rows = component.entries();
        expect(rows).toHaveLength(9);
        expect(rows.every((row) => row.valid)).toBe(true);
        expect(rows.map((row) => row.candidate.portalUrl)).toEqual([
            'http://panel-a.example/c',
            'http://panel-a.example/c',
            'http://panel-a.example/c',
            'http://panel-b.example/c',
            'http://panel-c.example:80/c',
            'http://203.0.113.10/c',
            'http://203.0.113.10/c',
            'http://203.0.113.10/c',
            'http://panel-d.example:80/c',
        ]);

        await component.importAll();

        expect(runner.run).toHaveBeenCalledTimes(1);
        expect(runner.run.mock.calls[0][0]).toHaveLength(9);
    });
});
