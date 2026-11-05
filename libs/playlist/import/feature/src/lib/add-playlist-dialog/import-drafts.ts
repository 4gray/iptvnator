import { signal, type Signal } from '@angular/core';
import type { UrlUploadComponent } from '../url-upload/url-upload.component';
import type { XtreamCodeImportComponent } from '../xtream-code-import/xtream-code-import.component';
import type { StalkerPortalImportComponent } from '../stalker-portal-import/stalker-portal-import.component';
import type { TextImportComponent } from '../text-import/text-import.component';
import type { FileUploadComponent } from '../file-upload/file-upload.component';
import type { PlaylistType } from '@iptvnator/playlist/shared/ui';

type Values<T extends { getRawValue(): unknown }> = ReturnType<
    T['getRawValue']
>;

/** Drafts never leave the dialog; recreated provider forms start masked. */
export function createImportDrafts(children: {
    url: Signal<UrlUploadComponent | undefined>;
    xtream: Signal<XtreamCodeImportComponent | undefined>;
    stalker: Signal<StalkerPortalImportComponent | undefined>;
    text: Signal<TextImportComponent | undefined>;
    file: Signal<FileUploadComponent | undefined>;
}) {
    const pending = signal<PlaylistType | null>(null);
    let url: Values<UrlUploadComponent['form']> | undefined;
    let xtream: Values<XtreamCodeImportComponent['form']> | undefined;
    let stalker: Values<StalkerPortalImportComponent['form']> | undefined;
    let derivesIds = false;
    let text: Values<TextImportComponent['textForm']> | undefined;
    let file: File | null | undefined;

    function capture(method: PlaylistType): void {
        switch (method) {
            case 'url':
                url = children.url()?.form.getRawValue() ?? url;
                break;
            case 'xtream':
                xtream = children.xtream()?.form.getRawValue() ?? xtream;
                break;
            case 'stalker':
                stalker = children.stalker()?.form.getRawValue() ?? stalker;
                derivesIds =
                    children.stalker()?.derivesDeviceIds() ?? derivesIds;
                break;
            case 'text':
                text = children.text()?.textForm.getRawValue() ?? text;
                break;
            case 'file': {
                const child = children.file();
                if (child) file = child.selectedFile();
                break;
            }
        }
    }

    function restore(): void {
        switch (pending()) {
            case 'url': {
                const child = children.url();
                if (!child) return;
                if (url) child.form.patchValue(url);
                break;
            }
            case 'xtream': {
                const child = children.xtream();
                if (!child) return;
                if (xtream) child.form.patchValue(xtream);
                break;
            }
            case 'stalker': {
                const child = children.stalker();
                if (!child) return;
                if (stalker) {
                    child.form.patchValue(stalker);
                    if (derivesIds) void child.toggleDeriveDeviceIds(true);
                }
                break;
            }
            case 'text': {
                const child = children.text();
                if (!child) return;
                if (text) child.textForm.patchValue(text);
                break;
            }
            case 'file': {
                const child = children.file();
                if (!child) return;
                if (file !== undefined) child.selectedFile.set(file);
                break;
            }
            case null:
                return;
        }
        pending.set(null);
    }

    /** A newly detected candidate replaces the earlier draft for its method. */
    function discard(method: PlaylistType): void {
        switch (method) {
            case 'url':
                url = undefined;
                break;
            case 'xtream':
                xtream = undefined;
                break;
            case 'stalker':
                stalker = undefined;
                derivesIds = false;
                break;
            case 'text':
                text = undefined;
                break;
        }
    }
    function clearAll(): void {
        url = undefined;
        xtream = undefined;
        stalker = undefined;
        text = undefined;
        file = undefined;
        derivesIds = false;
        pending.set(null);
    }
    return { capture, restore, request: pending.set, discard, clearAll };
}
