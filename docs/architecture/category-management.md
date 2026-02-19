# Category Management Feature

## Overview

Xtream API playlists often contain many categories, some of which may be empty, in another language, or simply not relevant to the user. The category management feature allows users to hide unwanted categories from the sidebar while keeping them in the database for potential future use.

## User Flow

1. User navigates to an Xtream playlist (Live TV, Movies, or Series section)
2. In the sidebar header, next to "All categories", there's a **tune icon button**
3. Clicking it opens the **Category Management Dialog**
4. User sees all categories with checkboxes (checked = visible, unchecked = hidden)
5. User can:
    - Individually toggle categories
    - Use "Select All" / "Deselect All" buttons
    - Search/filter categories by name
6. On save, visibility preferences are persisted to the database
7. Hidden categories no longer appear in the sidebar

## Technical Implementation

### Database Schema

Added `hidden` column to the `categories` table:

```sql
ALTER TABLE categories ADD COLUMN hidden INTEGER DEFAULT 0
```

- `hidden = 0` (false): Category is visible (default)
- `hidden = 1` (true): Category is hidden

**Migration**: Uses a safe migration pattern in `connection.ts` that catches errors for already-applied migrations, ensuring existing users get the new column automatically.

### Backend (Electron)

**File**: `apps/electron-backend/src/app/events/database/category.events.ts`

| IPC Handler                     | Purpose                                            |
| ------------------------------- | -------------------------------------------------- |
| `DB_GET_CATEGORIES`             | Returns visible categories only (`hidden = false`) |
| `DB_GET_ALL_CATEGORIES`         | Returns all categories (for management dialog)     |
| `DB_UPDATE_CATEGORY_VISIBILITY` | Batch updates `hidden` status for category IDs     |

### Frontend Services

**File**: `libs/services/src/lib/database-electron.service.ts`

| Method                       | Purpose                        |
| ---------------------------- | ------------------------------ |
| `getXtreamCategories()`      | Sidebar display (filtered)     |
| `getAllXtreamCategories()`   | Management dialog (unfiltered) |
| `updateCategoryVisibility()` | Save visibility changes        |

### Components

**Category Management Dialog**

- Path: `apps/web/src/app/xtream-electron/category-management-dialog/`
- Features:
    - Checkbox list of all categories
    - Select All / Deselect All buttons
    - Search/filter with clearable input
    - Shows selected count vs total
    - Saves changes to database on confirm

**Integration Points**

- `xtream-main-container.component.ts` - Movies & Series sections
- `live-stream-layout.component.ts` - Live TV section

Both components:

1. Add a "tune" icon button in the sidebar header
2. Open the dialog with playlist ID and content type
3. Call `xtreamStore.reloadCategories()` after dialog closes with changes

### Store

**File**: `apps/web/src/app/xtream-electron/xtream.store.ts`

Added `reloadCategories()` method to refresh categories from database after visibility changes, ensuring the sidebar updates immediately.

## Behavior Notes

- **New categories**: When a playlist is refreshed, new categories from the remote API are added with `hidden = false` (visible by default)
- **Persistence**: Visibility settings survive playlist refresh (see below)
- **Per-playlist, per-type**: Categories are managed per playlist and per content type (live/movies/series)
- **No content deletion**: Hiding a category only affects sidebar visibility; the category and its content remain in the database

### Visibility Preservation During Refresh

When a user refreshes an Xtream playlist, hidden category preferences are preserved through the following mechanism:

1. **Before deletion**: The `DB_DELETE_XTREAM_CONTENT` handler extracts and returns the `hidden` status of all categories (keyed by `xtreamId` and `type`)
2. **Temporary storage**: The hidden categories are stored in `localStorage` under key `xtream-restore-{playlistId}` along with favorites and recently viewed data
3. **During re-import**: When categories are saved via `DB_SAVE_CATEGORIES`, the data source checks `localStorage` for saved hidden category xtreamIds
4. **Restoration**: Categories matching the saved xtreamIds are inserted with `hidden = true`, preserving the user's visibility preferences

This ensures that users don't lose their category visibility customizations when refreshing playlists to get updated content.

## Files Changed

```
libs/shared/database/src/lib/
├── schema.ts                    # Added hidden column to categories table
└── connection.ts                # Added migration for existing databases

apps/electron-backend/src/app/
├── events/database/category.events.ts  # IPC handlers (including hidden category restoration)
├── events/database/xtream.events.ts    # Returns hidden categories during content deletion
└── api/main.preload.ts                 # Exposed new IPC methods (with hidden category params)

libs/services/src/lib/
└── database-electron.service.ts  # Service methods (with hidden category support)

libs/ui/components/src/lib/recent-playlists/
└── recent-playlists.component.ts  # Stores hidden categories to localStorage on refresh

apps/web/src/app/xtream-electron/
├── category-management-dialog/   # Dialog component
│   ├── category-management-dialog.component.ts
│   ├── category-management-dialog.component.html
│   └── category-management-dialog.component.scss
├── data-sources/
│   └── electron-xtream-data-source.ts  # Reads/passes hidden categories on save
├── xtream-main-container.component.ts   # Added button & dialog
├── xtream-main-container.component.html
├── live-stream-layout/
│   ├── live-stream-layout.component.ts  # Added button & dialog
│   └── live-stream-layout.component.html
├── sidebar.scss                  # Updated header styles
└── xtream.store.ts              # Added reloadCategories method

apps/web/src/assets/i18n/
└── en.json                      # Added translation keys

global.d.ts                      # TypeScript types for IPC methods
```

## Translation Keys

```json
{
    "XTREAM": {
        "CATEGORY_MANAGEMENT": {
            "TITLE": "Manage Categories",
            "LOADING": "Loading categories...",
            "SELECTED": "Selected",
            "SELECT_ALL": "Select All",
            "DESELECT_ALL": "Deselect All",
            "SEARCH_PLACEHOLDER": "Search categories...",
            "NO_RESULTS": "No matching categories found",
            "NO_CATEGORIES": "No categories available",
            "SAVE": "Save"
        }
    }
}
```
