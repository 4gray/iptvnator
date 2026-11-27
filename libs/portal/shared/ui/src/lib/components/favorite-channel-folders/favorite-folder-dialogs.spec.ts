import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import {
    FavoriteChannelFoldersService,
    FavoriteFolderNameError,
} from '@iptvnator/portal/shared/data-access';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { TranslateModule } from '@ngx-translate/core';
import { FavoriteFolderDialogs } from './favorite-folder-dialogs.service';

@Component({ template: '' })
class DialogTestHost {}

const channel: UnifiedCollectionItem = {
    uid: 'xtream::example::live:3',
    name: 'Example News',
    sourceType: 'xtream',
    contentType: 'live',
    playlistId: 'example',
    playlistName: 'Example source',
    xtreamId: 3,
};
const currentFolder = { id: 'current', name: 'News' };
const otherFolder = { id: 'other', name: 'Weather' };
const prefix = 'WORKSPACE.FAVORITE_FOLDERS.';

describe('FavoriteFolderDialogs', () => {
    const folders = {
        folders: signal([currentFolder, otherFolder]),
        folderOf: jest.fn(() => currentFolder.id),
        create: jest.fn(),
        rename: jest.fn(),
        move: jest.fn(),
        remove: jest.fn(),
    };
    let fixture: ComponentFixture<DialogTestHost>;
    let service: FavoriteFolderDialogs;

    beforeEach(() => {
        jest.clearAllMocks();
        folders.folders.set([currentFolder, otherFolder]);
        TestBed.configureTestingModule({
            imports: [NoopAnimationsModule, TranslateModule.forRoot()],
            providers: [
                { provide: FavoriteChannelFoldersService, useValue: folders },
            ],
        });
        fixture = TestBed.createComponent(DialogTestHost);
        service = TestBed.inject(FavoriteFolderDialogs);
    });

    async function dialog() {
        await fixture.whenStable();
        return TestbedHarnessEnvironment.documentRootLoader(fixture).getHarness(
            MatDialogHarness
        );
    }

    it('keeps a rejected name in the form, then saves a corrected name', async () => {
        folders.create
            .mockRejectedValueOnce(new FavoriteFolderNameError('duplicate'))
            .mockResolvedValueOnce('new-id');
        const result = service.create();
        const panel = await dialog();
        const field = await panel.getHarness(MatInputHarness);
        const create = await panel.getHarness(
            MatButtonHarness.with({ text: prefix + 'CREATE_CONFIRM' })
        );

        await field.setValue(currentFolder.name);
        await create.click();
        expect(await panel.getText()).toContain(prefix + 'NAME_DUPLICATE');
        expect(await field.getValue()).toBe(currentFolder.name);

        await field.setValue('Morning News');
        await create.click();
        await expect(result).resolves.toBe('new-id');
        expect(folders.create).toHaveBeenLastCalledWith('Morning News');
    });

    it('disables the current folder and submits a single move to a new folder', async () => {
        folders.move.mockResolvedValueOnce(undefined);
        const result = service.move([channel]);
        const panel = await dialog();
        const picker = await panel.getHarness(MatSelectHarness);
        await picker.open();
        const [current] = await picker.getOptions({ text: currentFolder.name });
        expect(await current.isDisabled()).toBe(true);
        await picker.clickOptions({ text: prefix + 'NEW_FOLDER' });

        const field = await panel.getHarness(MatInputHarness);
        await field.setValue('Morning News');
        await (
            await panel.getHarness(
                MatButtonHarness.with({ text: prefix + 'MOVE_CONFIRM' })
            )
        ).click();

        await expect(result).resolves.toBe(true);
        expect(folders.move).toHaveBeenCalledTimes(1);
        expect(folders.move).toHaveBeenCalledWith(
            [channel],
            { name: 'Morning News' },
            undefined
        );
        expect(folders.create).not.toHaveBeenCalled();
    });

    it('cancels a direct add with Escape before any write', async () => {
        const result = service.move([channel], { add: true });
        const panel = await dialog();
        const picker = await panel.getHarness(MatSelectHarness);

        expect(await picker.getValueText()).toBe(currentFolder.name);
        await panel.close();

        await expect(result).resolves.toBe(false);
        expect(folders.move).not.toHaveBeenCalled();
    });

    it('prepopulates a rename and saves the name for the selected folder', async () => {
        folders.rename.mockResolvedValueOnce(undefined);
        const result = service.rename(currentFolder);
        const panel = await dialog();
        const field = await panel.getHarness(MatInputHarness);
        expect(await field.getValue()).toBe(currentFolder.name);

        await field.setValue('Morning bulletins');
        const save = await panel.getHarness(
            MatButtonHarness.with({ text: 'SETTINGS.UNSAVED_DIALOG_SAVE' })
        );
        await save.click();

        await expect(result).resolves.toBe(true);
        expect(folders.rename).toHaveBeenCalledWith(
            currentFolder.id,
            'Morning bulletins'
        );
        expect(folders.create).not.toHaveBeenCalled();
    });

    it('moves multiple rows to Without folder and retains their per-source identities', async () => {
        const rows = [
            channel,
            { ...channel, uid: 'xtream::second::live:3', playlistId: 'second' },
        ];
        folders.move.mockResolvedValueOnce(undefined);
        const result = service.move(rows);
        const panel = await dialog();
        expect(await panel.getText()).toContain(prefix + 'MOVE_CHANNELS_TITLE');
        const picker = await panel.getHarness(MatSelectHarness);
        expect(await picker.getValueText()).toBe(prefix + 'WITHOUT_FOLDER');
        const move = await panel.getHarness(
            MatButtonHarness.with({ text: prefix + 'MOVE_CONFIRM' })
        );
        await move.click();

        await expect(result).resolves.toBe(true);
        expect(folders.move).toHaveBeenCalledWith(rows, null, undefined);
    });

    it('disables an add when its destination disappears and submits a surviving destination', async () => {
        folders.move.mockResolvedValueOnce(undefined);
        const result = service.move([channel], { add: true });
        const panel = await dialog();
        const picker = await panel.getHarness(MatSelectHarness);
        const add = await panel.getHarness(
            MatButtonHarness.with({ text: prefix + 'ADD_CONFIRM' })
        );
        expect(await picker.getValueText()).toBe(currentFolder.name);
        folders.folders.set([otherFolder]);
        expect(await add.isDisabled()).toBe(true);
        expect(folders.move).not.toHaveBeenCalled();

        await picker.open();
        await picker.clickOptions({ text: otherFolder.name });
        await add.click();
        await expect(result).resolves.toBe(true);
        expect(folders.move).toHaveBeenCalledWith([channel], otherFolder.id, {
            add: true,
        });
    });

    it('keeps an empty selection from opening a move dialog', async () => {
        await expect(service.move([])).resolves.toBe(false);
        expect(TestBed.inject(MatDialog).openDialogs).toHaveLength(0);
        expect(folders.move).not.toHaveBeenCalled();
    });

    it('keeps a pending removal open and lets a failed write be retried', async () => {
        let rejectWrite!: (reason: Error) => void;
        const write = new Promise<void>((_, reject) => {
            rejectWrite = reject;
        });
        folders.remove
            .mockReturnValueOnce(write)
            .mockResolvedValueOnce(undefined);
        const result = service.remove(currentFolder);
        const panel = await dialog();
        const remove = await panel.getHarness(
            MatButtonHarness.with({ text: 'PORTALS.ERROR_VIEW.DELETE' })
        );

        await remove.click();
        expect(TestBed.inject(MatDialog).openDialogs[0].disableClose).toBe(
            true
        );
        expect(await remove.isDisabled()).toBe(true);
        await panel.close();
        expect(TestBed.inject(MatDialog).openDialogs).toHaveLength(1);

        rejectWrite(new Error('Write failed'));
        await expect(write).rejects.toThrow('Write failed');
        await fixture.whenStable();
        expect(await panel.getText()).toContain(prefix + 'SAVE_FAILED');
        expect(TestBed.inject(MatDialog).openDialogs[0].disableClose).toBe(
            false
        );
        expect(await remove.isFocused()).toBe(true);

        await remove.click();
        await expect(result).resolves.toBe(true);
        expect(folders.remove).toHaveBeenCalledTimes(2);
    });
});
