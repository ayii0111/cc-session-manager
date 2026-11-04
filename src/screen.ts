import ScreenManager = require('inquirer/lib/utils/screen-manager');
import { visibleWidth } from './format';

// Terminals that don't support synchronized output ignore these.
const SYNC_START = '\x1b[?2026h';
const SYNC_END = '\x1b[?2026l';
const ERASE_LINE_END = '\x1b[K';
const ERASE_BELOW = '\x1b[J';
// eslint-disable-next-line no-control-regex
const SGR = /\x1b\[[0-9;]*m/g;

/**
 * Inquirer's ScreenManager erases every row and then writes the new content, so a
 * terminal refreshing between the two shows a blank list. This one overwrites the
 * rows in place with a single write, leaving no blank state to paint. The prompt
 * hides the cursor, so it stays at the end of the content.
 */
export class OverwriteScreenManager extends ScreenManager {
  render(content: string, bottomContent?: string): void {
    const width = this.normalizedCliWidth();
    const fullContent = bottomContent ? `${content}\n${bottomContent}` : content;
    const lines = this.forceLineReturn(fullContent, width).split('\n');

    // A full row must skip the erase: right after filling the last column, the
    // cursor is still on it, so the erase would remove that last character.
    const rows = lines.map((line) =>
      visibleWidth(line.replace(SGR, '')) < width ? line + ERASE_LINE_END : line,
    );

    let frame = SYNC_START;
    if (this.height > 1) frame += `\x1b[${this.height - 1}A`;
    frame += '\r' + rows.join('\n');
    // Step down first for the same reason. Rows exist below when shrinking, so this can't scroll.
    if (lines.length < this.height) frame += `\n${ERASE_BELOW}\x1b[1A`;
    frame += SYNC_END;

    this.rl.output.unmute();
    this.rl.output.write(frame);
    this.rl.output.mute();
    this.height = lines.length;
  }
}
