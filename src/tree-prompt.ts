'use strict';

declare module 'inquirer-tree-prompt' {
  class TreePrompt {
    constructor(questions: any, rl: any, answers: any);
    opt: any;
    rl: any;
    active: any;
    phase: string;
    shownList: any[];
    paginator: any;
    screen: any;
    done: (result: any) => void;
    _run(done: (result: any) => void): Promise<any>;
    render(error?: any): void;
    getQuestion(): string;
    createTreeContent(): string;
    onUpKey(): void;
    onDownKey(): void;
    onRightKey(): void;
    onLeftKey(): void;
    onSpaceKey(): void;
    onTabKey(): void;
    onSubmit(state: any): void;
    valueFor(node: any): any;
    nameFor(node: any): string;
  }
  export = TreePrompt;
}

declare module 'inquirer/lib/utils/events' {
  function observe(rl: any): any;
  export = observe;
}

import TreePrompt = require('inquirer-tree-prompt');
import chalk from 'chalk';
import cliCursor from 'cli-cursor';
import { fromEvent } from 'rxjs';
import { filter, share } from 'rxjs/operators';
import observe = require('inquirer/lib/utils/events');

class TwoPhaseTreePrompt extends TreePrompt {
  _promptStartRow: number;
  _mouseHandler: ((data: Buffer) => void) | null;
  _actionKeyHandler: ((ch: any, key: any) => void) | null;
  _enterHandler: ((ch: any, key: any) => void) | null;
  _escHandler: ((data: Buffer) => void) | null;
  _treeEscHandler: ((data: Buffer) => void) | null;
  phase: string;
  currentActions: string[];
  activeAction: number;
  _pendingAction: string | null;
  _inputBuffer: string;
  _inputLabel: string;
  _inputDefault: string;
  _inputHandler: ((ch: any, key: any) => void) | null;

  constructor(questions: any, rl: any, answers: any) {
    super(questions, rl, answers);
    this._promptStartRow = 0;
    this._mouseHandler = null;
    this._actionKeyHandler = null;
    this._enterHandler = null;
    this._escHandler = null;
    this._treeEscHandler = null;
    this.phase = 'tree';
    this.currentActions = [];
    this.activeAction = 0;
    this._pendingAction = null;
    this._inputBuffer = '';
    this._inputLabel = '';
    this._inputDefault = '';
    this._inputHandler = null;
  }

  getQuestion(): string {
    const getLogs = (this.opt as any).getLogs as (() => string[]) | undefined;
    const logs = getLogs?.() ?? [];
    const logSection = logs.length ? logs.join('\n') + '\n\n' : '';
    return logSection + chalk.bold((this.opt as any).message || '') + ' ';
  }

  _getActionsForNode(node: any): string[] {
    const provider = (this.opt as any).actionsProvider as ((node: any) => string[]) | undefined;
    if (typeof provider === 'function') return provider(node);
    return node?.children ? ['操作1', '操作2'] : ['操作A', '操作B'];
  }

  async _run(done: (result: any) => void): Promise<any> {
    process.stdout.write('\x1b[?1000h\x1b[?1006h');
    this._promptStartRow = await this._queryCursorRow();
    return super._run(done);
  }

  _installKeyHandlers(): void {
    const events = observe(this.rl);

    events.normalizedUpKey.forEach(() => {
      if (this.phase === 'tree') this.onUpKey();
    });
    events.normalizedDownKey.forEach(() => {
      if (this.phase === 'tree') this.onDownKey();
    });
    events.keypress.pipe(filter(({ key }: any) => key.name === 'right'), share()).forEach(() => {
      if (this.phase === 'tree') this.onRightKey();
    });
    events.keypress.pipe(filter(({ key }: any) => key.name === 'left'), share()).forEach(() => {
      if (this.phase === 'tree') this.onLeftKey();
    });
    events.spaceKey.forEach(() => {
      if (this.phase === 'tree') this.onSpaceKey();
    });
    fromEvent(this.rl.input, 'keypress', (v: any, k: any) => ({ value: v, key: k || {} }))
      .pipe(filter(({ key }: any) => key && key.name === 'tab'), share())
      .forEach(() => {
        if (this.phase === 'tree') this.onTabKey();
      });

    this._enterHandler = (ch: any, key: any) => {
      if (!key || key.name !== 'return') return;
      this._processEnter();
    };
    process.stdin.on('keypress', this._enterHandler);

    this._treeEscHandler = (data: Buffer) => {
      if (this.phase !== 'tree') return;
      if (data.length !== 1 || data[0] !== 0x1b) return;
      this._cleanup();
      this.screen.done();
      cliCursor.show();
      process.exit(0);
    };
    process.stdin.on('data', this._treeEscHandler);

    // Expose clone tree + render function to external callers (e.g. active session watcher)
    const onRenderContext = (this.opt as any).onRenderContext as
      ((ctx: { tree: any[]; render: () => void }) => void) | undefined;
    if (onRenderContext) {
      onRenderContext({
        tree: (this.tree as any).children as any[],
        render: () => { if (this.phase === 'tree') this.render(); },
      });
    }
  }

  _returnToTree(): void {
    if (this._actionKeyHandler) {
      process.stdin.removeListener('keypress', this._actionKeyHandler);
      this._actionKeyHandler = null;
    }
    if (this._escHandler) {
      process.stdin.removeListener('data', this._escHandler);
      this._escHandler = null;
    }
    this._pendingAction = null;
    this.phase = 'tree';
    this.render();
  }

  _processEnter(): void {
    if (this.phase === 'tree') {
      if (!this.active) return; // empty tree (e.g. all sessions deleted)
      this.currentActions = this._getActionsForNode(this.active);
      this.activeAction = 0;
      this.phase = 'action';
      this._setupActionKeyHandlers();
      this.render();

    } else if (this.phase === 'action') {
      const selectedAction = this.currentActions[this.activeAction];
      const confirmMap = (this.opt as any).confirmActions as Record<string, string[]> | undefined;
      const inputActions = (this.opt as any).inputActions as string[] | undefined;
      const isActiveFn = (this.opt as any).isActive as ((id: string) => boolean) | undefined;

      // Synchronous active-session guard for session delete
      if (confirmMap?.[selectedAction] && isActiveFn) {
        const session = (this.active?.value as any)?.session;
        if (session && isActiveFn(session.session_id)) {
          this._pendingAction = selectedAction;
          this.currentActions = ['此 session 激活中，無法刪除'];
          this.activeAction = 0;
          this.phase = 'confirm'; // single item = last = cancel on Enter
          this.render();
          return;
        }
      }

      if (inputActions?.includes(selectedAction)) {
        // Remove action handlers — prevents duplicate registration on next action entry
        if (this._actionKeyHandler) {
          process.stdin.removeListener('keypress', this._actionKeyHandler);
          this._actionKeyHandler = null;
        }
        if (this._escHandler) {
          process.stdin.removeListener('data', this._escHandler);
          this._escHandler = null;
        }
        this._pendingAction = selectedAction;
        this._inputDefault = (this.active?.value as any)?.session?.session_name ?? '';
        if (this._inputDefault === '(untitled)') this._inputDefault = '';
        this._inputBuffer = this._inputDefault;
        this._inputLabel = '新名稱：';
        this.phase = 'input';
        this._setupInputHandlers();
        this.render();
      } else if (confirmMap?.[selectedAction]) {
        this._pendingAction = selectedAction;
        this.currentActions = [...confirmMap[selectedAction]];
        this.activeAction = 0;
        this.phase = 'confirm';
        this.render();
      } else {
        this._doFinalSubmit();
      }

    } else if (this.phase === 'confirm') {
      const isCancel = this.activeAction === this.currentActions.length - 1;
      if (isCancel) {
        this._returnToTree();
        return;
      }
      const onAction = (this.opt as any).onAction as ((action: string, node: any, tree: any[], input?: string) => Promise<void>) | undefined;
      if (onAction) {
        const pending = this._pendingAction!;
        const activeNode = this.active;
        const cloneTree = (this.tree as any).children as any[]; // library's internal clone
        // Save adjacent info for cursor restoration after delete (reference equality works on clone)
        const parentDir = cloneTree.find((d: any) => d.children?.includes(activeNode));
        const siblingIdx = parentDir ? (parentDir.children as any[]).indexOf(activeNode) : -1;
        // Detach action handlers, return to tree phase before async op
        if (this._actionKeyHandler) { process.stdin.removeListener('keypress', this._actionKeyHandler); this._actionKeyHandler = null; }
        if (this._escHandler) { process.stdin.removeListener('data', this._escHandler); this._escHandler = null; }
        this._pendingAction = null;
        this.phase = 'tree';
        onAction(pending, activeNode, cloneTree).then(() => {
          // Restore cursor using clone tree (same references)
          if (parentDir && cloneTree.includes(parentDir) && parentDir.children?.length > 0) {
            const idx = siblingIdx >= 0 ? Math.min(siblingIdx, parentDir.children.length - 1) : 0;
            this.active = parentDir.children[idx];
          } else if (cloneTree.length > 0) {
            this.active = cloneTree[0];
          }
          this.render();
        }).catch(() => this.render());
      } else {
        this._doFinalSubmit(this._pendingAction!);
      }

    } else if (this.phase === 'input') {
      const onAction = (this.opt as any).onAction as ((action: string, node: any, tree: any[], input?: string) => Promise<void>) | undefined;
      if (onAction) {
        const inputValue = this._inputBuffer.trim() || this._inputDefault;
        const pending = this._pendingAction!;
        const activeNode = this.active;
        const cloneTree = (this.tree as any).children as any[]; // library's internal clone
        if (this._inputHandler) { process.stdin.removeListener('keypress', this._inputHandler); this._inputHandler = null; }
        this._pendingAction = null;
        this._inputBuffer = '';
        this.phase = 'tree';
        onAction(pending, activeNode, cloneTree, inputValue).then(() => {
          this.active = activeNode;
          this.render();
        }).catch(() => this.render());
      } else {
        this._submitInput();
      }
    }
  }

  _setupInputHandlers(): void {
    this._inputHandler = (ch: any, key: any) => {
      if (this.phase !== 'input' || !key) return;
      if (key.name === 'backspace') {
        this._inputBuffer = [...this._inputBuffer].slice(0, -1).join('');
        this.render();
      } else if (ch && !key.ctrl && !key.meta && key.name !== 'return' && key.name !== 'escape') {
        this._inputBuffer += ch;
        this.render();
      }
    };
    process.stdin.on('keypress', this._inputHandler);

    // Raw data handler for ESC — avoids the ~500ms readline timeout
    this._escHandler = (data: Buffer) => {
      if (this.phase !== 'input') return;
      if (data.length === 1 && data[0] === 0x1b) {
        this._cancelInput();
      }
    };
    process.stdin.on('data', this._escHandler);
  }

  _cancelInput(): void {
    if (this._inputHandler) {
      process.stdin.removeListener('keypress', this._inputHandler);
      this._inputHandler = null;
    }
    if (this._actionKeyHandler) {
      process.stdin.removeListener('keypress', this._actionKeyHandler);
      this._actionKeyHandler = null;
    }
    if (this._escHandler) {
      process.stdin.removeListener('data', this._escHandler);
      this._escHandler = null;
    }
    this._pendingAction = null;
    this._inputBuffer = '';
    this.phase = 'tree';
    this.render();
  }

  _submitInput(): void {
    const inputValue = this._inputBuffer.trim() || this._inputDefault;
    this._doFinalSubmit(this._pendingAction!, inputValue);
  }

  _queryCursorRow(): Promise<number> {
    return new Promise((resolve) => {
      const handler = (data: Buffer) => {
        const match = data.toString().match(/\x1b\[(\d+);(\d+)R/);
        if (match) {
          process.stdin.removeListener('data', handler);
          resolve(parseInt(match[1], 10));
        }
      };
      process.stdin.prependListener('data', handler);
      process.stdout.write('\x1b[6n');
    });
  }

  render(error?: any): void {
    if (this.phase === 'action' || this.phase === 'confirm') {
      this._renderWithActionBar(error);
      return;
    }
    if (this.phase === 'input') {
      this._renderWithInput();
      return;
    }
    this._renderTree(error);
    if (!this._mouseHandler) {
      this._setupMouseListener();
    }
  }

  _renderTree(error?: any): void {
    let message = this.getQuestion();
    this.shownList = [];

    const children = (this.tree as any).children as any[] | undefined;
    if (!children || children.length === 0) {
      message += '\n' + chalk.dim('  沒有 session，按 Esc 退出');
      this.screen.render(message, error ? chalk.red('>> ') + error : undefined);
      return;
    }

    let treeContent = this.createTreeContent();
    if (this.opt.loop !== false) {
      treeContent += '----------------';
    }
    message += '\n' + this.paginator.paginate(
      treeContent,
      this.shownList.indexOf(this.active),
      this.opt.pageSize
    );
    this.screen.render(message, error ? chalk.red('>> ') + error : undefined);
  }

  _renderWithInput(): void {
    let message = this.getQuestion();
    this.shownList = [];
    let treeContent = this.createTreeContent();
    if (this.opt.loop !== false) {
      treeContent += '----------------';
    }
    message += '\n' + this.paginator.paginate(
      treeContent,
      this.shownList.indexOf(this.active),
      this.opt.pageSize
    );
    const cursor = chalk.bgWhite.black(' ');
    message += `\n\n  ${this._inputLabel}${chalk.cyan(this._inputBuffer)}${cursor}`;
    this.screen.render(message);
  }

  _renderWithActionBar(error?: any): void {
    let message = this.getQuestion();

    this.shownList = [];
    let treeContent = this.createTreeContent();
    if (this.opt.loop !== false) {
      treeContent += '----------------';
    }
    message += '\n' + this.paginator.paginate(
      treeContent,
      this.shownList.indexOf(this.active),
      this.opt.pageSize
    );

    message += '\n\n  操作：' + this.currentActions.map((action, i) => {
      return i === this.activeAction
        ? chalk.bgCyan.black(`[${action}]`)
        : chalk.dim(` ${action} `);
    }).join(' ');

    this.screen.render(message, error ? chalk.red('>> ') + error : undefined);
  }

  _setupMouseListener(): void {
    this._mouseHandler = (data: Buffer) => {
      if (this.phase !== 'tree') return;
      const str = data.toString();
      const match = str.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
      if (!match) return;

      const button = parseInt(match[1]);
      const clickRow = parseInt(match[3]);
      const isPress = match[4] === 'M';

      if (button === 0 && isPress) {
        const itemIndex = clickRow - this._promptStartRow - 1;
        if (itemIndex >= 0 && itemIndex < this.shownList.length) {
          this.active = this.shownList[itemIndex];
          this.render();
        }
      }
    };
    process.stdin.on('data', this._mouseHandler);
  }

  _setupActionKeyHandlers(): void {
    this._actionKeyHandler = (ch: any, key: any) => {
      if (!key || (this.phase !== 'action' && this.phase !== 'confirm')) return;
      if (key.name === 'right') {
        this.activeAction = (this.activeAction + 1) % this.currentActions.length;
        this.render();
      } else if (key.name === 'left') {
        this.activeAction = (this.activeAction - 1 + this.currentActions.length) % this.currentActions.length;
        this.render();
      }
    };
    process.stdin.on('keypress', this._actionKeyHandler);

    this._escHandler = (data: Buffer) => {
      if (this.phase !== 'action' && this.phase !== 'confirm') return;
      if (data.length === 1 && (data as Buffer)[0] === 0x1b) {
        this._returnToTree();
      }
    };
    process.stdin.on('data', this._escHandler);
  }

  onSubmit(state: any): void {}

  _doFinalSubmit(overrideAction?: string, overrideInput?: string): void {
    this._cleanup();

    const node = {
      value: this.valueFor(this.active),
      name: this.nameFor(this.active),
      isDirectory: !!this.active.children,
    };
    const action = overrideAction ?? this.currentActions[this.activeAction];

    let message = this.getQuestion();
    message += chalk.cyan(`${node.name}  →  ${action}`);
    this.screen.render(message);
    this.screen.done();
    cliCursor.show();

    this.done({ node, action, input: overrideInput });
  }

  _cleanup(): void {
    process.stdout.write('\x1b[?1000l\x1b[?1006l');
    if (this._mouseHandler) {
      process.stdin.removeListener('data', this._mouseHandler);
      this._mouseHandler = null;
    }
    if (this._actionKeyHandler) {
      process.stdin.removeListener('keypress', this._actionKeyHandler);
      this._actionKeyHandler = null;
    }
    if (this._enterHandler) {
      process.stdin.removeListener('keypress', this._enterHandler);
      this._enterHandler = null;
    }
    if (this._escHandler) {
      process.stdin.removeListener('data', this._escHandler);
      this._escHandler = null;
    }
    if (this._treeEscHandler) {
      process.stdin.removeListener('data', this._treeEscHandler);
      this._treeEscHandler = null;
    }
    if (this._inputHandler) {
      process.stdin.removeListener('keypress', this._inputHandler);
      this._inputHandler = null;
    }
  }
}

export { TwoPhaseTreePrompt };
