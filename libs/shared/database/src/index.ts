/**
 * Shared Database module for IPTVnator
 * Provides Drizzle ORM schema and connection utilities for SQLite database
 * Used by both electron-backend (read-write) and agent-backend (read-only)
 */

export * from './lib/schema';
export * from './lib/connection';
