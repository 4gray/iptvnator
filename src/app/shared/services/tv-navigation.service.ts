import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';

export interface NavigationItem {
  id: string;
  element: HTMLElement;
  row: number;
  col: number;
  focusable: boolean;
}

export interface NavigationGrid {
  rows: number;
  cols: number;
  items: NavigationItem[];
}

@Injectable({
  providedIn: 'root'
})
export class TvNavigationService {
  private currentGrid = new BehaviorSubject<NavigationGrid | null>(null);
  private currentFocus = new BehaviorSubject<NavigationItem | null>(null);
  private navigationMode = new BehaviorSubject<'keyboard' | 'mouse' | 'remote'>('keyboard');
  
  public onNavigate = new Subject<{ direction: 'up' | 'down' | 'left' | 'right', item: NavigationItem }>();
  public onSelect = new Subject<NavigationItem>();
  public onGridChange = new Subject<NavigationGrid>();

  constructor(private ngZone: NgZone) {
    this.initializeKeyboardNavigation();
  }

  /**
   * Initialize keyboard navigation for TV remote controls
   */
  private initializeKeyboardNavigation(): void {
    document.addEventListener('keydown', (event) => {
      this.ngZone.run(() => {
        this.handleKeyNavigation(event);
      });
    });

    // Detect navigation mode changes
    document.addEventListener('mousemove', () => {
      this.setNavigationMode('mouse');
    });

    document.addEventListener('keydown', () => {
      this.setNavigationMode('keyboard');
    });
  }

  /**
   * Handle keyboard navigation (arrow keys, enter, etc.)
   */
  private handleKeyNavigation(event: KeyboardEvent): void {
    const grid = this.currentGrid.value;
    if (!grid || !this.currentFocus.value) return;

    const currentItem = this.currentFocus.value;
    let nextItem: NavigationItem | null = null;

    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        nextItem = this.findItemInDirection(currentItem, 'up', grid);
        break;
      case 'ArrowDown':
        event.preventDefault();
        nextItem = this.findItemInDirection(currentItem, 'down', grid);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        nextItem = this.findItemInDirection(currentItem, 'left', grid);
        break;
      case 'ArrowRight':
        event.preventDefault();
        nextItem = this.findItemInDirection(currentItem, 'right', grid);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.onSelect.next(currentItem);
        return;
      case 'Escape':
        event.preventDefault();
        this.clearFocus();
        return;
      default:
        return;
    }

    if (nextItem) {
      this.focusItem(nextItem);
      this.onNavigate.next({ 
        direction: event.key.replace('Arrow', '').toLowerCase() as any, 
        item: nextItem 
      });
    }
  }

  /**
   * Find the next item in a specific direction
   */
  private findItemInDirection(current: NavigationItem, direction: 'up' | 'down' | 'left' | 'right', grid: NavigationGrid): NavigationItem | null {
    const { row, col } = current;
    let targetRow = row;
    let targetCol = col;

    switch (direction) {
      case 'up':
        targetRow = Math.max(0, row - 1);
        break;
      case 'down':
        targetRow = Math.min(grid.rows - 1, row + 1);
        break;
      case 'left':
        targetCol = Math.max(0, col - 1);
        break;
      case 'right':
        targetCol = Math.min(grid.cols - 1, col + 1);
        break;
    }

    // Find item at target position
    const targetItem = grid.items.find(item => 
      item.row === targetRow && item.col === targetCol && item.focusable
    );

    if (targetItem) {
      return targetItem;
    }

    // If no direct item found, try to find the closest focusable item
    return this.findClosestFocusableItem(current, direction, grid);
  }

  /**
   * Find the closest focusable item in a direction
   */
  private findClosestFocusableItem(current: NavigationItem, direction: 'up' | 'down' | 'left' | 'right', grid: NavigationGrid): NavigationItem | null {
    const { row, col } = current;
    const focusableItems = grid.items.filter(item => item.focusable);

    switch (direction) {
      case 'up':
        return focusableItems
          .filter(item => item.row < row)
          .sort((a, b) => b.row - a.row)[0] || null;
      case 'down':
        return focusableItems
          .filter(item => item.row > row)
          .sort((a, b) => a.row - b.row)[0] || null;
      case 'left':
        return focusableItems
          .filter(item => item.col < col)
          .sort((a, b) => b.col - a.col)[0] || null;
      case 'right':
        return focusableItems
          .filter(item => item.col > col)
          .sort((a, b) => a.col - b.col)[0] || null;
      default:
        return null;
    }
  }

  /**
   * Set up a navigation grid
   */
  public setupGrid(items: HTMLElement[], cols: number): void {
    const rows = Math.ceil(items.length / cols);
    const navigationItems: NavigationItem[] = [];

    items.forEach((element, index) => {
      const row = Math.floor(index / cols);
      const col = index % cols;
      
      navigationItems.push({
        id: `item-${index}`,
        element,
        row,
        col,
        focusable: this.isElementFocusable(element)
      });
    });

    const grid: NavigationGrid = { rows, cols, items: navigationItems };
    this.currentGrid.next(grid);
    this.onGridChange.next(grid);

    // Set initial focus to first focusable item
    const firstFocusable = navigationItems.find(item => item.focusable);
    if (firstFocusable) {
      this.focusItem(firstFocusable);
    }
  }

  /**
   * Check if an element is focusable
   */
  private isElementFocusable(element: HTMLElement): boolean {
    const tagName = element.tagName.toLowerCase();
    const tabIndex = element.getAttribute('tabindex');
    
    if (tagName === 'button' || tagName === 'a' || tagName === 'input' || tagName === 'select' || tagName === 'textarea') {
      return true;
    }
    
    if (tabIndex !== null && tabIndex !== '-1') {
      return true;
    }
    
    return element.onclick !== null || element.getAttribute('role') === 'button';
  }

  /**
   * Focus a specific navigation item
   */
  public focusItem(item: NavigationItem): void {
    if (!item.focusable) return;

    // Clear previous focus
    this.clearFocus();

    // Set new focus
    this.currentFocus.next(item);
    
    // Add visual focus indicator
    item.element.classList.add('focused');
    item.element.setAttribute('tabindex', '0');
    
    // Scroll item into view
    item.element.scrollIntoView({ 
      behavior: 'smooth', 
      block: 'nearest',
      inline: 'nearest'
    });

    // Focus the element
    item.element.focus();
  }

  /**
   * Clear current focus
   */
  public clearFocus(): void {
    const current = this.currentFocus.value;
    if (current) {
      current.element.classList.remove('focused');
      current.element.removeAttribute('tabindex');
      this.currentFocus.next(null);
    }
  }

  /**
   * Set navigation mode
   */
  public setNavigationMode(mode: 'keyboard' | 'mouse' | 'remote'): void {
    this.navigationMode.next(mode);
  }

  /**
   * Get current navigation mode
   */
  public getNavigationMode() {
    return this.navigationMode.value;
  }

  /**
   * Get current grid
   */
  public getCurrentGrid() {
    return this.currentGrid.value;
  }

  /**
   * Get current focus
   */
  public getCurrentFocus() {
    return this.currentFocus.value;
  }

  /**
   * Navigate to next item in a direction
   */
  public navigate(direction: 'up' | 'down' | 'left' | 'right'): void {
    const grid = this.currentGrid.value;
    const current = this.currentFocus.value;
    
    if (!grid || !current) return;

    const nextItem = this.findItemInDirection(current, direction, grid);
    if (nextItem) {
      this.focusItem(nextItem);
      this.onNavigate.next({ direction, item: nextItem });
    }
  }

  /**
   * Select current item
   */
  public selectCurrent(): void {
    const current = this.currentFocus.value;
    if (current) {
      this.onSelect.next(current);
    }
  }

  /**
   * Clean up navigation grid
   */
  public cleanup(): void {
    this.clearFocus();
    this.currentGrid.next(null);
  }
}
