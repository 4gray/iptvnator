import type Database from 'better-sqlite3';
import {
    notifyDatabaseConnectionOpened,
    setDatabaseConnectionObserver,
} from './connection-observer';

describe('database connection observer', () => {
    afterEach(() => {
        setDatabaseConnectionObserver(null);
    });

    it('does nothing when no observer is registered', () => {
        expect(() =>
            notifyDatabaseConnectionOpened({} as Database.Database)
        ).not.toThrow();
    });

    it('passes each opened connection to the registered observer until removed', () => {
        const observer = jest.fn();
        const first = { name: 'first' } as unknown as Database.Database;
        const second = { name: 'second' } as unknown as Database.Database;

        setDatabaseConnectionObserver(observer);
        notifyDatabaseConnectionOpened(first);
        setDatabaseConnectionObserver(null);
        notifyDatabaseConnectionOpened(second);

        expect(observer.mock.calls).toEqual([[first]]);
    });
});
