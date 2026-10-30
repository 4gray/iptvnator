import {
    InvalidPlaylistDocumentError,
    PlaylistPayloadMissingError,
} from './server-playlist-repository';
import {
    describeStorageError,
    StorageRequestError,
    toStorageErrorBody,
} from './storage-route-errors';

describe('toStorageErrorBody', () => {
    it.each([
        [
            new StorageRequestError(404, 'not_found', 'Playlist not found.'),
            404,
            'not_found',
        ],
        [new PlaylistPayloadMissingError(), 409, 'payload_missing'],
        [new InvalidPlaylistDocumentError(), 400, 'invalid_body'],
        [{ type: 'entity.too.large' }, 413, 'too_large'],
        [{ type: 'entity.parse.failed' }, 400, 'invalid_json'],
        [
            Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' }),
            503,
            'storage_busy',
        ],
        [new Error('SELECT secret FROM x'), 500, 'storage_error'],
    ])('maps %p to %i', (error, status, code) => {
        expect(toStorageErrorBody(error)).toMatchObject({ status, code });
    });

    it('never puts the raw error message into a 500 body or log line', () => {
        const error = new Error('password=hunter2');

        expect(JSON.stringify(toStorageErrorBody(error))).not.toContain(
            'hunter2'
        );
        expect(describeStorageError(error)).toBe('Error');
    });
});
