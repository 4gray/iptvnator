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
