import { Request, Response } from 'express';
import { getPortalData } from '../data-store.js';
import { extractMac } from '../request-mac.js';
import {
    RawChannel,
    RawRadioStation,
    RawSeriesItem,
    RawVodItem,
} from '../data-generator.js';

const PAGE_SIZE = 14;

type AnyItem = RawChannel | RawRadioStation | RawVodItem | RawSeriesItem;

/**
 * Stalker get_ordered_list — returns paginated content for a category.
 *
 * Query params:
 *   type:     itv | vod | series | radio
 *   category: category_id (or "*" for all)
 *   genre:    same as category for itv
 *   p:        page number (1-based)
 *   search:   optional search phrase
 *   sortby:   added (newest first) | name (ascending)
 */
export function handleGetOrderedList(req: Request, res: Response): void {
    const mac = extractMac(req);
    const type = (req.query['type'] as string) ?? 'vod';
    const categoryId = (req.query['category'] as string) ?? '*';
    const page = parseInt((req.query['p'] as string) ?? '1', 10);
    const search = ((req.query['search'] as string) ?? '').toLowerCase();
    const data = getPortalData(mac);

    let allItems: AnyItem[] = [];

    if (type === 'itv') {
        if (categoryId === '*') {
            // The "*" listing excludes censored (adult) genres, matching
            // real portals; their channels are only served by genre id.
            const censoredIds = new Set(
                data.itvCategories
                    .filter((cat) => cat.censored === '1')
                    .map((cat) => cat.id)
            );
            for (const [catId, items] of data.channels.entries()) {
                if (!censoredIds.has(catId)) {
                    allItems.push(...items);
                }
            }
        } else {
            allItems = data.channels.get(categoryId) ?? [];
        }
    } else if (type === 'radio') {
        if (categoryId === '*') {
            for (const items of data.radio.values()) {
                allItems.push(...items);
            }
        } else {
            allItems = data.radio.get(categoryId) ?? [];
        }
    } else if (type === 'series') {
        if (categoryId === '*') {
            for (const items of data.series.values()) {
                allItems.push(...items);
            }
        } else {
            allItems = data.series.get(categoryId) ?? [];
        }
    } else {
        // vod (default)
        if (categoryId === '*') {
            if (data.vodOrder) {
                allItems.push(...data.vodOrder);
            } else {
                for (const items of data.vod.values()) {
                    allItems.push(...items);
                }
            }
        } else {
            allItems = data.vod.get(categoryId) ?? [];
        }
    }

    // Apply search filter
    if (search) {
        allItems = allItems.filter((item) => {
            const name = ('name' in item ? item.name : '') ?? '';
            return name.toLowerCase().includes(search);
        });
    }

    // Sort the complete filtered catalog before paging, as a portal does.
    const sort = req.query['sortby'];
    if (
        (type === 'vod' || type === 'series') &&
        (sort === 'added' || sort === 'name')
    ) {
        const timestamp = (item: AnyItem) => {
            const value = 'added' in item ? item.added : undefined;
            if (!value) return 0;
            return /^\d+$/.test(value)
                ? Number(value) * 1000
                : Date.parse(value) || 0;
        };
        allItems = allItems
            .map((item, index) => ({ item, index }))
            .sort((a, b) => {
                const order =
                    sort === 'name'
                        ? a.item.name.localeCompare(b.item.name)
                        : timestamp(b.item) - timestamp(a.item);
                return order || a.index - b.index;
            })
            .map(({ item }) => item);
    }
    const totalItems = allItems.length;
    const totalPages = Math.ceil(totalItems / PAGE_SIZE);
    const offset = (page - 1) * PAGE_SIZE;
    const pageItems = allItems.slice(offset, offset + PAGE_SIZE);

    res.json({
        js: {
            data: pageItems,
            total_items: totalItems,
            max_page_items: PAGE_SIZE,
            cur_page: page,
            total_pages: totalPages,
            selected_item: 0,
        },
    });
}
