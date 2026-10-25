import { initialData, hydrateUserData, UserData } from '@iptvnator/tv/util';
const DATABASE = 'iptvnator-tv-user-data';
const VERSION = 1;
export class UserDataStorage {
    private db?: IDBDatabase;
    async open(): Promise<void> {
        this.db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(DATABASE, VERSION);
            request.onupgradeneeded = () => {
                request.result.createObjectStore('state');
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () =>
                reject(new Error('Local TV storage could not be opened.'));
            request.onblocked = () =>
                reject(
                    new Error(
                        'Close other IPTVnator TV windows to upgrade local storage.'
                    )
                );
        });
        this.db.onversionchange = () => {
            this.db?.close();
            this.db = undefined;
        };
    }
    async read(): Promise<UserData> {
        if (!this.db) await this.open();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction('state', 'readonly');
            const request = transaction.objectStore('state').get('user');
            transaction.oncomplete = () => {
                const saved = request.result as
                    { version: number; data: UserData } | undefined;
                if (saved && saved.version !== VERSION) {
                    reject(new Error('Unsupported TV data version.'));
                    return;
                }
                resolve(saved ? hydrateUserData(saved.data) : initialData());
            };
            transaction.onerror = transaction.onabort = () =>
                reject(new Error('Local TV data could not be read.'));
        });
    }
    async write(data: UserData): Promise<void> {
        if (!this.db) await this.open();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction('state', 'readwrite');
            transaction
                .objectStore('state')
                .put({ version: VERSION, data }, 'user');
            transaction.oncomplete = () => resolve();
            transaction.onerror = transaction.onabort = () =>
                reject(
                    new Error(
                        'Local save failed. Free TV storage and retry; this change was not saved.'
                    )
                );
        });
    }
    close() {
        this.db?.close();
        this.db = undefined;
    }
}
/** Serializes edits so simultaneous progress/favorite/source writes cannot clobber each other. */
export class UserDataRepository {
    data = initialData();
    private loaded = false;
    private pending = Promise.resolve();
    constructor(
        private storage: Pick<UserDataStorage, 'read' | 'write'>,
        private changed: (data: UserData) => void
    ) {}
    async load() {
        this.data = await this.storage.read();
        this.loaded = true;
        this.changed(this.data);
    }
    update(change: (data: UserData) => UserData) {
        if (!this.loaded)
            return Promise.reject(
                new Error('Load saved TV data before making changes.')
            );
        const operation = this.pending.then(async () => {
            const next = change(this.data);
            await this.storage.write(next);
            this.data = next;
            this.changed(next);
        });
        this.pending = operation.catch(() => undefined);
        return operation;
    }
}
