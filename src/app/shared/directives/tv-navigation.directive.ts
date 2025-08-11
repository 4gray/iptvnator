import { AfterViewInit, Directive, ElementRef, Input, OnDestroy, OnInit, Renderer2 } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { NavigationItem, TvNavigationService } from '../services/tv-navigation.service';

@Directive({
  selector: '[appTvNavigation]',
  standalone: true
})
export class TvNavigationDirective implements OnInit, OnDestroy, AfterViewInit {
  @Input() navigationGrid = 4; // Default grid columns
  @Input() navigationEnabled = true;
  @Input() autoSetup = true;

  private destroy$ = new Subject<void>();
  private navigationItems: NavigationItem[] = [];

  constructor(
    private elementRef: ElementRef,
    private tvNavigationService: TvNavigationService,
    private renderer: Renderer2
  ) {}

  ngOnInit(): void {
    if (this.navigationEnabled) {
      this.setupNavigation();
    }
  }

  ngAfterViewInit(): void {
    if (this.autoSetup && this.navigationEnabled) {
      // Wait for view to be ready
      setTimeout(() => {
        this.setupNavigationGrid();
      }, 100);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.tvNavigationService.cleanup();
  }

  /**
   * Setup navigation event listeners
   */
  private setupNavigation(): void {
    // Listen for navigation events
    this.tvNavigationService.onNavigate
      .pipe(takeUntil(this.destroy$))
      .subscribe(({ direction, item }) => {
        this.handleNavigation(direction, item);
      });

    // Listen for selection events
    this.tvNavigationService.onSelect
      .pipe(takeUntil(this.destroy$))
      .subscribe((item) => {
        this.handleSelection(item);
      });

    // Listen for grid changes
    this.tvNavigationService.onGridChange
      .pipe(takeUntil(this.destroy$))
      .subscribe((grid) => {
        this.handleGridChange(grid);
      });
  }

  /**
   * Setup the navigation grid with focusable elements
   */
  private setupNavigationGrid(): void {
    const focusableElements = this.getFocusableElements();
    
    if (focusableElements.length > 0) {
      // Calculate optimal grid columns based on screen size
      const optimalCols = this.calculateOptimalGridColumns();
      this.tvNavigationService.setupGrid(focusableElements, optimalCols);
    }
  }

  /**
   * Get all focusable elements within this directive's element
   */
  private getFocusableElements(): HTMLElement[] {
    const element = this.elementRef.nativeElement;
    const focusableSelectors = [
      'button:not([disabled])',
      'a[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
      '[role="button"]',
      '[onclick]'
    ];

    const focusableElements: HTMLElement[] = [];
    
    focusableSelectors.forEach(selector => {
      const elements = element.querySelectorAll(selector);
      elements.forEach((el: HTMLElement) => {
        if (this.isElementVisible(el)) {
          focusableElements.push(el);
        }
      });
    });

    return focusableElements;
  }

  /**
   * Check if an element is visible
   */
  private isElementVisible(element: HTMLElement): boolean {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && 
           style.visibility !== 'hidden' && 
           element.offsetWidth > 0 && 
           element.offsetHeight > 0;
  }

  /**
   * Calculate optimal grid columns based on screen size
   */
  private calculateOptimalGridColumns(): number {
    const screenWidth = window.innerWidth;
    
    if (screenWidth >= 1920) return 6; // TV
    if (screenWidth >= 1440) return 5; // Large desktop
    if (screenWidth >= 1024) return 4; // Desktop
    if (screenWidth >= 768) return 3;  // Tablet
    if (screenWidth >= 480) return 2;  // Mobile
    return 1; // Small mobile
  }

  /**
   * Handle navigation events
   */
  private handleNavigation(direction: string, item: NavigationItem): void {
    // Add visual feedback for navigation
    this.addNavigationFeedback(item.element, direction);
    
    // Emit custom event for parent components
    const event = new CustomEvent('tvNavigation', {
      detail: { direction, item, element: item.element }
    });
    this.elementRef.nativeElement.dispatchEvent(event);
  }

  /**
   * Handle selection events
   */
  private handleSelection(item: NavigationItem): void {
    // Add visual feedback for selection
    this.addSelectionFeedback(item.element);
    
    // Emit custom event for parent components
    const event = new CustomEvent('tvSelection', {
      detail: { item, element: item.element }
    });
    this.elementRef.nativeElement.dispatchEvent(event);
  }

  /**
   * Handle grid changes
   */
  private handleGridChange(grid: any): void {
    // Emit custom event for parent components
    const event = new CustomEvent('tvGridChange', {
      detail: { grid }
    });
    this.elementRef.nativeElement.dispatchEvent(event);
  }

  /**
   * Add visual feedback for navigation
   */
  private addNavigationFeedback(element: HTMLElement, direction: string): void {
    // Add temporary class for animation
    this.renderer.addClass(element, 'tv-navigation-feedback');
    this.renderer.addClass(element, `tv-navigation-${direction}`);
    
    // Remove after animation
    setTimeout(() => {
      this.renderer.removeClass(element, 'tv-navigation-feedback');
      this.renderer.removeClass(element, `tv-navigation-${direction}`);
    }, 300);
  }

  /**
   * Add visual feedback for selection
   */
  private addSelectionFeedback(element: HTMLElement): void {
    // Add temporary class for selection feedback
    this.renderer.addClass(element, 'tv-selection-feedback');
    
    // Remove after animation
    setTimeout(() => {
      this.renderer.removeClass(element, 'tv-selection-feedback');
    }, 500);
  }

  /**
   * Manually setup navigation grid (for dynamic content)
   */
  public setupGrid(columns?: number): void {
    if (columns) {
      this.navigationGrid = columns;
    }
    this.setupNavigationGrid();
  }

  /**
   * Enable/disable navigation
   */
  public setNavigationEnabled(enabled: boolean): void {
    this.navigationEnabled = enabled;
    if (enabled) {
      this.setupNavigation();
      this.setupNavigationGrid();
    } else {
      this.tvNavigationService.cleanup();
    }
  }

  /**
   * Get current navigation state
   */
  public getNavigationState() {
    return {
      grid: this.tvNavigationService.getCurrentGrid(),
      focus: this.tvNavigationService.getCurrentFocus(),
      mode: this.tvNavigationService.getNavigationMode()
    };
  }
}
