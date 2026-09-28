import { getContext, setContext } from "svelte";
import type { LanceModel, Page, Piece } from "./lance/model";

export interface Popover {
  piece: Piece;
  x: number;
  y: number;
  /** Whether clicking where the pointer is opens the piece's page. */
  opensPage: boolean;
}

/** The loaded file plus everything the user has selected in it. */
export class Inspector {
  readonly model: LanceModel;
  /** The remote URL being shown; local files have no shareable link. */
  readonly source: string | null;
  /** How much was downloaded to open the file, e.g. "read 512 KB of 4.7 MB · 1 request · 30 ms". */
  readonly loadSummary: string;

  /** The column that is highlighted in the file map and open in the column list. */
  selectedColumn = $state<number | null>(null);
  /** The page of the selected column whose encoding is open. */
  selectedPage = $state<number | null>(null);
  /** Page hovered in the list, outlined in the file map. */
  hoveredPage = $state.raw<Page | null>(null);
  /** Bumped when a column or page is selected from outside the list, so the list scrolls to it. */
  revealTick = $state(0);
  /** Whether the last reveal should also scroll the page, when the list may be off screen. Read untracked. */
  revealInPage = false;
  popover = $state.raw<Popover | null>(null);

  constructor(
    model: LanceModel,
    source: string | null,
    initial: { col: string | null; page: number | null },
    loadSummary: string,
  ) {
    this.model = model;
    this.source = source;
    this.loadSummary = loadSummary;
    const column = model.columns.findIndex((c) => c.path === initial.col);
    if (column !== -1) {
      this.selectedColumn = column;
      if (initial.page !== null && model.columns[column]?.pages[initial.page]) this.selectedPage = initial.page;
      this.revealTick += 1;
    }
  }

  get page(): Page | null {
    if (this.selectedColumn === null || this.selectedPage === null) return null;
    return this.model.columns[this.selectedColumn]?.pages[this.selectedPage] ?? null;
  }

  toggleColumn(column: number, { reveal = false } = {}): void {
    this.selectedColumn = this.selectedColumn === column ? null : column;
    this.selectedPage = null;
    if (reveal) this.reveal(false);
  }

  /** Opens a page's column with the page expanded, or closes the page if it is already open. */
  togglePage(page: Page, { reveal = false, inPage = false } = {}): void {
    const open = this.selectedColumn === page.column.index && this.selectedPage === page.index;
    this.selectedColumn = page.column.index;
    this.selectedPage = open ? null : page.index;
    if (reveal) this.reveal(inPage);
  }

  private reveal(inPage: boolean): void {
    this.revealInPage = inPage;
    this.revealTick += 1;
  }

  showPopover(piece: Piece | null, event: MouseEvent, opensPage = false): void {
    this.popover = piece ? { piece, x: event.clientX, y: event.clientY, opensPage } : null;
  }

  hidePopover(): void {
    this.popover = null;
  }
}

const KEY = Symbol("inspector");

export function setInspector(inspector: Inspector): void {
  setContext(KEY, inspector);
}

export function getInspector(): Inspector {
  return getContext<Inspector>(KEY);
}
