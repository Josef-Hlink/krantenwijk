/**
 * Undo/redo as a diff-based command stack. Every user gesture — a lasso, a
 * click-toggle, an auto-seed, a merge — becomes exactly one command, so one
 * ⌘Z always reverts one intention, however many points it touched.
 */

export interface Command {
	label: string;
	apply(): void;
	revert(): void;
}

export class History {
	private undoStack: Command[] = [];
	private redoStack: Command[] = [];

	run(cmd: Command) {
		cmd.apply();
		this.undoStack.push(cmd);
		this.redoStack = [];
	}

	undo(): string | null {
		const cmd = this.undoStack.pop();
		if (!cmd) return null;
		cmd.revert();
		this.redoStack.push(cmd);
		return cmd.label;
	}

	redo(): string | null {
		const cmd = this.redoStack.pop();
		if (!cmd) return null;
		cmd.apply();
		this.undoStack.push(cmd);
		return cmd.label;
	}

	get canUndo() {
		return this.undoStack.length > 0;
	}

	get canRedo() {
		return this.redoStack.length > 0;
	}

	clear() {
		this.undoStack = [];
		this.redoStack = [];
	}
}

export class CompositeCommand implements Command {
	constructor(
		public label: string,
		private commands: Command[]
	) {}

	apply() {
		for (const c of this.commands) c.apply();
	}

	revert() {
		for (const c of [...this.commands].reverse()) c.revert();
	}
}
