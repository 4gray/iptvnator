import { DatePipe } from '@angular/common';
import { UntypedFormBuilder } from '@angular/forms';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { createPlaylistDetailsForm } from './playlist-info-form';

const xtream = {
    _id: 'xtream',
    title: 'Xtream',
    serverUrl: 'https://panel.test/base',
    username: 'user',
    password: 'password',
} as PlaylistMeta;

function form(playlist = xtream) {
    return createPlaylistDetailsForm(
        playlist,
        new UntypedFormBuilder(),
        new DatePipe('en')
    );
}

describe('playlist edit connection validation', () => {
    it.each([
        '',
        ' ',
        'not-a-url',
        'ftp://panel.test',
        'file:///panel',
        'https://user:pass@panel.test',
        'https://panel.test:99999',
    ])('rejects invalid Xtream URL %p', (value) => {
        const details = form();
        details.get('serverUrl')?.setValue(value);
        expect(details.valid).toBe(false);
        expect(details.get('serverUrl')?.errors).toBeTruthy();
    });

    it.each([
        'http://localhost:8080',
        'https://panel.test/provider/',
        ' https://panel.test/base/player_api.php?username=other&password=other ',
        'https://panel.test/panel_api.php',
        'https://[::1]:8080/get.php?type=m3u_plus',
    ])('accepts supported Xtream input %p', (value) => {
        const details = form();
        details.get('serverUrl')?.setValue(value);
        expect(details.valid).toBe(true);
    });

    it.each(['username', 'password'])(
        'requires a nonblank Xtream %s',
        (field) => {
            const details = form();
            for (const value of ['', ' \t\n ', null]) {
                details.get(field)?.setValue(value);
                expect(details.get(field)?.errors).toEqual({ required: true });
            }
            details.get(field)?.setValue(' value with spaces ');
            expect(details.valid).toBe(true);
        }
    );

    it('keeps Stalker credentials optional', () => {
        const details = form({
            ...xtream,
            serverUrl: undefined,
            portalUrl: 'https://portal.test/c/',
            macAddress: '00:1A:79:AA:BB:CC',
            username: '',
            password: '',
        });
        expect(details.valid).toBe(true);
    });

    it('does not require connection fields for M3U metadata edits', () => {
        const details = form({ _id: 'm3u', title: 'M3U' } as PlaylistMeta);
        expect(details.valid).toBe(true);
    });
});

describe('M3U source editing (#1677)', () => {
    const urlPlaylist = {
        _id: 'm3u-url',
        title: 'From URL',
        url: 'https://provider.test/get.php?token=old',
    } as PlaylistMeta;
    const filePlaylist = {
        _id: 'm3u-file',
        title: 'From file',
        filePath: '/home/user/list.m3u',
    } as PlaylistMeta;

    it('makes the URL of a URL playlist editable', () => {
        const details = form(urlPlaylist);
        expect(details.get('url')?.enabled).toBe(true);
        expect(details.get('filePath')?.enabled).toBe(false);
        details
            .get('url')
            ?.setValue(' https://new-host.test/get.php?token=new ');
        expect(details.valid).toBe(true);
    });

    it.each([
        '',
        ' ',
        'not-a-url',
        'ftp://provider.test/list.m3u',
        'file:///list.m3u',
        'https://',
    ])('rejects the M3U URL %p', (value) => {
        const details = form(urlPlaylist);
        details.get('url')?.setValue(value);
        expect(details.valid).toBe(false);
        expect(details.get('url')?.errors).toBeTruthy();
    });

    it('makes the file path of a file playlist editable and requires it', () => {
        const details = form(filePlaylist);
        expect(details.get('filePath')?.enabled).toBe(true);
        expect(details.get('url')?.enabled).toBe(false);
        details.get('filePath')?.setValue(' ');
        expect(details.valid).toBe(false);
        details.get('filePath')?.setValue('/media/usb/list.m3u');
        expect(details.valid).toBe(true);
    });

    it('keeps the source read-only for Xtream and Stalker playlists', () => {
        const stalker = {
            _id: 'stalker',
            title: 'Stalker',
            portalUrl: 'http://portal.test/c/',
            macAddress: '00:1A:79:00:00:01',
            url: 'http://portal.test/c/',
        } as PlaylistMeta;
        for (const playlist of [
            { ...xtream, url: 'https://panel.test/get.php' },
            stalker,
        ]) {
            expect(form(playlist as PlaylistMeta).get('url')?.enabled).toBe(
                false
            );
        }
    });
});
