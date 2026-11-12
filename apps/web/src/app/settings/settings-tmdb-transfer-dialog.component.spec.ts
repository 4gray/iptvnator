import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { prepareSourceConnection } from '@iptvnator/services/source-sync/connection';
import type { SourceServerRequest } from '@iptvnator/shared/interfaces';
import { TranslateModule } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { SettingsTmdbTransferDialogComponent } from './settings-tmdb-transfer-dialog.component';
import { SettingsTmdbTransferStorage } from './settings-tmdb-transfer-storage';

const connection = {
    apiUrl: 'https://iptvnator.synthetic.invalid/api',
    instanceId: 'synthetic-server',
};
const senderToken = 's'.repeat(32);
const receiverToken = 'r'.repeat(32);
const apiKey = 'synthetic-tmdb-key';
const session = { senderToken, receiverToken, expiresInMs: 300_000 };
const ok = (body: object) => ({ status: 200, body });

describe('TMDB key transfer dialog', () => {
    let fixture: ComponentFixture<SettingsTmdbTransferDialogComponent>;
    let dialog: SettingsTmdbTransferDialogComponent;
    let closeEvents: Subject<void>;
    let close: jest.Mock;
    let sendRequest: jest.Mock;
    let currentConnection: jest.Mock;
    let storage: {
        readSavedTmdbKey: jest.Mock;
        saveTransferredTmdbKey: jest.Mock;
    };
    let originalBridge: PropertyDescriptor | undefined;

    const actions = () =>
        sendRequest.mock.calls.map(
            ([arg]: [SourceServerRequest]) => arg.tmdbTransfer?.request
        );
    const poll = () => jest.advanceTimersByTimeAsync(1500);

    beforeEach(async () => {
        jest.useFakeTimers();
        closeEvents = new Subject<void>();
        close = jest.fn(() => closeEvents.next());
        sendRequest = jest.fn();
        currentConnection = jest.fn().mockReturnValue(connection);
        originalBridge = Object.getOwnPropertyDescriptor(window, 'electron');
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: {
                sourceSyncConnection: currentConnection,
                sourceSyncRequest: sendRequest,
            },
        });
        await prepareSourceConnection();

        storage = {
            readSavedTmdbKey: jest.fn().mockResolvedValue(''),
            saveTransferredTmdbKey: jest.fn().mockResolvedValue(true),
        };
        TestBed.configureTestingModule({
            imports: [
                SettingsTmdbTransferDialogComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: MatDialogRef,
                    useValue: {
                        disableClose: false,
                        beforeClosed: () => closeEvents,
                        close,
                    },
                },
            ],
        });
        TestBed.overrideProvider(SettingsTmdbTransferStorage, {
            useValue: storage,
        });
        fixture = TestBed.createComponent(SettingsTmdbTransferDialogComponent);
        dialog = fixture.componentInstance;
    });

    afterEach(async () => {
        fixture.destroy();
        if (originalBridge)
            Object.defineProperty(window, 'electron', originalBridge);
        else Reflect.deleteProperty(window, 'electron');
        await prepareSourceConnection();
        jest.useRealTimers();
    });

    it('waits for confirmation, then retries a failed local write without reclaiming the key', async () => {
        storage.readSavedTmdbKey.mockResolvedValue('synthetic-old-key');
        storage.saveTransferredTmdbKey.mockImplementation(
            async (_key, _previous, isCurrent) => isCurrent()
        );
        storage.saveTransferredTmdbKey.mockRejectedValueOnce(
            new Error('synthetic write failure')
        );
        sendRequest
            .mockResolvedValueOnce(ok(session))
            .mockResolvedValueOnce(ok({ status: 'waiting' }))
            .mockResolvedValueOnce(ok({ status: 'ready' }))
            .mockResolvedValueOnce(ok({ apiKey }));

        await dialog.start();
        expect(dialog.sendCode()).toBe(senderToken);
        expect(dialog.replacing()).toBe(true);
        await poll();
        expect(dialog.stage()).toBe('waiting');
        await poll();
        expect(dialog.stage()).toBe('ready');
        expect(dialog.sendCode()).toBe('');
        expect(storage.saveTransferredTmdbKey).not.toHaveBeenCalled();
        expect(actions().map((request) => request?.action)).toEqual([
            'start',
            'status',
            'status',
        ]);

        await dialog.save();
        expect(dialog.error()).toBe('SAVE_FAILED');
        expect(close).not.toHaveBeenCalled();
        await dialog.save();
        expect(close).toHaveBeenCalledWith(true);
        expect(storage.saveTransferredTmdbKey).toHaveBeenLastCalledWith(
            apiKey,
            'synthetic-old-key',
            expect.any(Function)
        );
        expect(actions().at(-1)).toEqual({
            action: 'claim',
            transferToken: receiverToken,
        });
        expect(sendRequest).toHaveBeenCalledTimes(4);
    });

    it('cancels with the receiver token and stops polling when the dialog closes', async () => {
        sendRequest
            .mockResolvedValueOnce(ok(session))
            .mockResolvedValue(ok({}));
        await dialog.start();
        closeEvents.next();
        await jest.advanceTimersByTimeAsync(session.expiresInMs);
        expect(actions()).toEqual([
            { action: 'start' },
            { action: 'cancel', transferToken: receiverToken },
        ]);
        expect(dialog.sendCode()).toBe('');
    });

    it('stops an expired transfer and refuses to save it', async () => {
        sendRequest
            .mockResolvedValueOnce(ok({ ...session, expiresInMs: 1000 }))
            .mockResolvedValue(ok({}));
        await dialog.start();
        await jest.advanceTimersByTimeAsync(1000);
        await dialog.save();
        expect(dialog.stage()).toBe('closed');
        expect(dialog.error()).toBe('CLOSED');
        expect(storage.saveTransferredTmdbKey).not.toHaveBeenCalled();
    });

    it('recovers from a temporary polling failure and closes a retired session', async () => {
        sendRequest
            .mockResolvedValueOnce(ok(session))
            .mockRejectedValueOnce(new Error('synthetic network failure'))
            .mockResolvedValueOnce({ status: 410 })
            .mockResolvedValue(ok({}));
        await dialog.start();
        await poll();
        expect(dialog.error()).toBe('UNAVAILABLE');
        expect(dialog.stage()).toBe('waiting');
        await poll();
        expect(dialog.error()).toBe('CLOSED');
        expect(dialog.stage()).toBe('closed');
    });

    it('does not save a claim response after the selected server changes', async () => {
        sendRequest
            .mockResolvedValueOnce(ok(session))
            .mockResolvedValueOnce(ok({ status: 'ready' }))
            .mockImplementationOnce(async () => {
                currentConnection.mockReturnValue({
                    ...connection,
                    instanceId: 'other-server',
                });
                return ok({ apiKey });
            });
        await dialog.start();
        await poll();
        await dialog.save();
        expect(storage.saveTransferredTmdbKey).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
        expect(dialog.error()).toBe('CLOSED');
    });

    it('asks for a fresh transfer if another tab changes the saved key', async () => {
        storage.saveTransferredTmdbKey.mockResolvedValue(false);
        sendRequest
            .mockResolvedValueOnce(ok(session))
            .mockResolvedValueOnce(ok({ status: 'ready' }))
            .mockResolvedValueOnce(ok({ apiKey }));
        await dialog.start();
        await poll();
        await dialog.save();
        expect(dialog.stage()).toBe('closed');
        expect(dialog.error()).toBe('KEY_CHANGED');
        expect(close).not.toHaveBeenCalled();
    });

    it('verifies the supplied code before sending the saved personal key', async () => {
        storage.readSavedTmdbKey.mockResolvedValue(apiKey);
        sendRequest
            .mockResolvedValueOnce(ok({ status: 'waiting' }))
            .mockResolvedValueOnce(ok({ status: 'ready' }));
        dialog.codeInput.setValue('invalid');
        await dialog.send();
        expect(dialog.error()).toBe('INVALID_CODE');
        expect(sendRequest).not.toHaveBeenCalled();
        dialog.codeInput.setValue(` ${senderToken} `);
        await dialog.send();
        expect(actions()).toEqual([
            { action: 'check', transferToken: senderToken },
            { action: 'send', transferToken: senderToken, apiKey },
        ]);
        expect(dialog.stage()).toBe('sent');
        expect(dialog.codeInput.value).toBe('');
    });

    it('never submits a key for a used code or falls back to a bundled key', async () => {
        sendRequest
            .mockResolvedValueOnce(ok({ status: 'ready' }))
            .mockResolvedValueOnce(ok({ status: 'waiting' }));
        dialog.codeInput.setValue(senderToken);
        await dialog.send();
        expect(dialog.error()).toBe('USED');
        expect(storage.readSavedTmdbKey).not.toHaveBeenCalled();
        await dialog.send();
        expect(dialog.error()).toBe('NO_KEY');
        expect(actions().map((request) => request?.action)).toEqual([
            'check',
            'check',
        ]);
    });

    it.each([
        [404, 'UNSUPPORTED'],
        [429, 'BUSY'],
        [409, 'USED'],
    ])(
        'reports HTTP %s without displaying a transfer code',
        async (status, error) => {
            sendRequest.mockResolvedValueOnce({ status });
            await dialog.start();
            expect(dialog.error()).toBe(error);
            expect(dialog.sendCode()).toBe('');
            expect(dialog.busy()).toBe(false);
        }
    );

    it('rejects a malformed session response', async () => {
        sendRequest.mockResolvedValueOnce(ok({ ...session, expiresInMs: 0 }));
        await dialog.start();
        expect(dialog.error()).toBe('UNAVAILABLE');
        expect(dialog.sendCode()).toBe('');
        expect(dialog.stage()).toBe('choose');
    });
    it('discards a late status response after closing the dialog', async () => {
        let reply: (value: { status: number; body: object }) => void = () =>
            undefined;
        sendRequest
            .mockResolvedValueOnce(ok(session))
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        reply = resolve;
                    })
            )
            .mockResolvedValue(ok({}));
        await dialog.start();
        await poll();
        closeEvents.next();
        reply(ok({ status: 'ready' }));
        await poll();
        expect(dialog.stage()).not.toBe('ready');
        expect(actions().map((request) => request?.action)).toEqual([
            'start',
            'status',
            'cancel',
        ]);
    });

    it('rejects a malformed key returned by the receiver claim', async () => {
        sendRequest
            .mockResolvedValueOnce(ok(session))
            .mockResolvedValueOnce(ok({ status: 'ready' }))
            .mockResolvedValueOnce(
                ok({ apiKey: 'invalid key with whitespace' })
            )
            .mockResolvedValue(ok({}));
        await dialog.start();
        await poll();
        await dialog.save();
        expect(dialog.error()).toBe('UNAVAILABLE');
        expect(storage.saveTransferredTmdbKey).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
    });

    it('never sends a second start while a start request is in flight', async () => {
        let reply: (value: { status: number; body: object }) => void = () =>
            undefined;
        sendRequest
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        reply = resolve;
                    })
            )
            .mockResolvedValue(ok({}));
        const opening = dialog.start();
        await jest.advanceTimersByTimeAsync(0);
        await dialog.start();
        expect(sendRequest).toHaveBeenCalledTimes(1);
        reply(ok(session));
        await opening;
        expect(dialog.stage()).toBe('waiting');
    });
});
