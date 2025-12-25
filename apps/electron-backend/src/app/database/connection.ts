/**
 * Database connection re-export from shared library
 * This file maintains backwards compatibility for existing imports
 */

export {
  getDatabase,
  initDatabase,
  getDatabasePath,
  closeDatabase,
  type DatabaseInstance,
  type DatabaseOptions,
} from 'database';

