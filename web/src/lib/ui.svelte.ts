/**
 * Workspace UI state: which tool is armed, which draw shape it uses.
 *
 * - select: click a dot to activate its bucket
 * - draw-new: draw a shape → the points inside become a new bucket
 * - draw-assign: draw a shape → the points inside join the active bucket
 * - toggle: click dots to add/remove them from the active bucket
 * - pick-start / pick-end: click a dot to mark the active bucket's route ends
 */

export type Tool = 'select' | 'draw-new' | 'draw-assign' | 'toggle' | 'pick-start' | 'pick-end';
export type DrawShape = 'polygon' | 'rectangle' | 'freehand';

class UiStore {
	tool = $state<Tool>('select');
	drawShape = $state<DrawShape>('freehand');

	get drawing(): boolean {
		return this.tool === 'draw-new' || this.tool === 'draw-assign';
	}
}

export const ui = new UiStore();
