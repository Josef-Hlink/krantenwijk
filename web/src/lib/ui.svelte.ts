/**
 * Workspace UI state: which tool is armed, which draw shape it uses.
 *
 * - select: click a dot to activate its bucket
 * - draw-assign: draw a shape → the points inside join the active bucket
 * - toggle: click dots to add/remove them from the active bucket
 * - pick-start / pick-end: click a dot to mark the active bucket's route ends
 *
 * Placing is separate from the tools: it is armed for one door, from the
 * fix-addresses dialog or a dot's popup, and the next map click is where
 * that door is. It wins over whatever tool is selected until it's done.
 */

export type Tool = 'select' | 'draw-assign' | 'toggle' | 'pick-start' | 'pick-end';
export type DrawShape = 'polygon' | 'rectangle' | 'freehand';

class UiStore {
	tool = $state<Tool>('select');
	drawShape = $state<DrawShape>('freehand');
	/** Cards waiting for a map click to give them coordinates, or null. */
	placing = $state<{ recIds: string[]; label: string } | null>(null);

	get drawing(): boolean {
		return this.tool === 'draw-assign';
	}
}

export const ui = new UiStore();
