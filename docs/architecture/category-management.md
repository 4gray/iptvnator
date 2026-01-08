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

- Path: `apps/web/src/app/xtream-tauri/category-management-dialog/`
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

**File**: `apps/web/src/app/xtream-tauri/xtream.store.ts`

Added `reloadCategories()` method to refresh categories from database after visibility changes, ensuring the sidebar updates immediately.

## Behavior Notes

- **New categories**: When a playlist is refreshed, new categories from the remote API are added with `hidden = false` (visible by default)
- **Persistence**: Visibility settings survive playlist refresh
- **Per-playlist, per-type**: Categories are managed per playlist and per content type (live/movies/series)
- **No content deletion**: Hiding a category only affects sidebar visibility; the category and its content remain in the database

## Files Changed

```
libs/shared/database/src/lib/
├── schema.ts                    # Added hidden column to categories table
└── connection.ts                # Added migration for existing databases

apps/electron-backend/src/app/
├── events/database/category.events.ts  # New IPC handlers
└── api/main.preload.ts                 # Exposed new IPC methods

libs/services/src/lib/
└── database-electron.service.ts  # New service methods

apps/web/src/app/xtream-tauri/
├── category-management-dialog/   # New dialog component
│   ├── category-management-dialog.component.ts
│   ├── category-management-dialog.component.html
│   └── category-management-dialog.component.scss
├── xtream-main-container.component.ts   # Added button & dialog
├── xtream-main-container.component.html
├── live-stream-layout/
│   ├── live-stream-layout.component.ts  # Added button & dialog
│   └── live-stream-layout.component.html
├── sidebar.scss                  # Updated header styles
└── xtream.store.ts              # Added reloadCategories method

apps/web/src/assets/i18n/
└── en.json                      # Added translation keys

global.d.ts                      # TypeScript types for new IPC methods
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
