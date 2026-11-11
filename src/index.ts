import inquirer from 'inquirer';
import chalk from 'chalk';
import * as path from 'path';
import { TwoPhaseTreePrompt } from './tree-prompt';
import { getProjectsWithSessions } from './reader';
import { ActiveSessionWatcher } from './watcher';
import * as ops from './operations';
import { formatRelativeTime, formatFileSize, visibleWidth } from './format';
import type { ProjectInfo, SessionInfo, TreeNodeValue } from './types';

/** Relative times are measured from launch, so they don't change while sm stays open. */
const LAUNCHED_AT = Date.now();

/** Flags names derived from the lossy slug so a wrong one is easy to spot. */
function projectDirName(project: ProjectInfo): string {
  const name = path.basename(project.original_project_dir || project.cc_project_dir);
  return project.path_inferred ? `${name}（反推名稱）` : name;
}

function dirStatusMarks(project: ProjectInfo, hasActive: boolean): string {
  return (hasActive ? '  ' + chalk.green('●') : '') +
    (project.path_missing ? '  ' + chalk.yellow('! 原路徑不存在') : '');
}

function buildSessionLine(session: SessionInfo, isActive: boolean, maxNameW: number, maxSizeW: number): string {
  const namePad = ' '.repeat(Math.max(0, maxNameW - visibleWidth(session.session_name)));
  const sizePlain = formatFileSize(session.fileSize);
  const sizePad = ' '.repeat(Math.max(0, maxSizeW - sizePlain.length));
  return (
    chalk.dim('·') + ' ' +
    session.session_name + namePad +
    '  ' + sizePad + chalk.cyan(sizePlain) +
    '  ' + chalk.dim(formatRelativeTime(session.lastTime, LAUNCHED_AT)) +
    (isActive ? '  ' + chalk.green('●') : '')
  );
}

function rebuildDirChildren(dirNode: any, activeSet: Set<string>): void {
  const sessions: SessionInfo[] = dirNode.children.map((c: any) => c.value.session);
  const maxNameW = sessions.reduce((m, s) => Math.max(m, visibleWidth(s.session_name)), 0);
  const maxSizeW = sessions.reduce((m, s) => Math.max(m, formatFileSize(s.fileSize).length), 0);
  for (const child of dirNode.children) {
    child.name = buildSessionLine(child.value.session, activeSet.has(child.value.session.session_id), maxNameW, maxSizeW);
  }
}

function buildDirLine(dirNode: any, activeSet: Set<string>, maxDirPrefixW: number): string {
  const dirName = projectDirName(dirNode.value.project);
  const sessions: SessionInfo[] = (dirNode.children ?? []).map((c: any) => c.value.session);
  const countStr = `(${sessions.length})`;
  const prefixPlain = `${dirName} ${countStr}`;
  const dirPad = ' '.repeat(Math.max(0, maxDirPrefixW - visibleWidth(prefixPlain)));
  const latestTime = sessions.length > 0 ? sessions[0].lastTime : '';
  const hasActive = sessions.some(s => activeSet.has(s.session_id));
  return dirName +
    ' ' + chalk.gray(countStr) +
    dirPad + '  ' + chalk.dim(formatRelativeTime(latestTime, LAUNCHED_AT)) +
    dirStatusMarks(dirNode.value.project, hasActive);
}

function rebuildAllNames(cloneTree: any[], activeSet: Set<string>): void {
  const maxDirPrefixW = cloneTree.reduce((m, d) => {
    const dirName = projectDirName(d.value.project);
    return Math.max(m, visibleWidth(`${dirName} (${d.children?.length ?? 0})`));
  }, 0);
  for (const dirNode of cloneTree) {
    if (dirNode.children?.length > 0) rebuildDirChildren(dirNode, activeSet);
    dirNode.name = buildDirLine(dirNode, activeSet, maxDirPrefixW);
  }
}

type ProjectList = Awaited<ReturnType<typeof getProjectsWithSessions>>;

/** The current directory's project goes first; the rest keep their recency order. */
function currentProjectFirst(projects: ProjectList): ProjectList {
  const isCurrent = (p: ProjectList[number]) => p.project.original_project_dir === process.cwd();
  return [...projects.filter(isCurrent), ...projects.filter(p => !isCurrent(p))];
}

function buildTree(projectsWithSessions: ProjectList, activeSet: Set<string>) {
  const dirMeta = projectsWithSessions.map(({ project, sessions }) => {
    const dirName = projectDirName(project);
    const countStr = `(${sessions.length})`;
    return { dirName, countStr, prefixPlain: `${dirName} ${countStr}` };
  });
  const maxDirPrefixW = dirMeta.reduce(
    (m, { prefixPlain }) => Math.max(m, visibleWidth(prefixPlain)), 0
  );

  return projectsWithSessions.map(({ project, sessions }, i) => {
    const latestTime = sessions.length > 0 ? sessions[0].lastTime : '';
    const { dirName, countStr, prefixPlain } = dirMeta[i];
    const dirPad = ' '.repeat(Math.max(0, maxDirPrefixW - visibleWidth(prefixPlain)));
    const hasActive = sessions.some(s => activeSet.has(s.session_id));

    const dirNodeName =
      dirName +
      ' ' + chalk.gray(countStr) +
      dirPad + '  ' + chalk.dim(formatRelativeTime(latestTime, LAUNCHED_AT)) +
      dirStatusMarks(project, hasActive);

    const maxNameW = sessions.reduce((m, s) => Math.max(m, visibleWidth(s.session_name)), 0);
    const maxSizeW = sessions.reduce((m, s) => Math.max(m, formatFileSize(s.fileSize).length), 0);

    const children = sessions.map((session) => ({
      name: buildSessionLine(session, activeSet.has(session.session_id), maxNameW, maxSizeW),
      value: { type: 'session', session } as TreeNodeValue,
    }));

    return {
      name: dirNodeName,
      value: { type: 'dir', project } as TreeNodeValue,
      open: project.original_project_dir === process.cwd(),
      children,
    };
  });
}

async function main() {
  // Clear stale cwd file from previous run so ESC-exit doesn't trigger cd
  try { require('fs').unlinkSync('/tmp/sm-cwd'); } catch {}

  inquirer.registerPrompt('two-phase-tree', TwoPhaseTreePrompt);

  let renderContext: { tree: any[]; render: () => void } | null = null;

  const watcher = new ActiveSessionWatcher((activeSet) => {
    if (!renderContext) return;
    rebuildAllNames(renderContext.tree, activeSet);
    renderContext.render();
  });
  await watcher.start();

  try {
    const projectsWithSessions = await getProjectsWithSessions();
    if (projectsWithSessions.length === 0) {
      console.log('沒有找到任何 CC session。');
      return;
    }

    const tree = buildTree(currentProjectFirst(projectsWithSessions), watcher.getActive());
    const opLogs: string[] = [];
    const addLog = (msg: string) => {
      opLogs.push(chalk.dim(msg));
      if (opLogs.length > 5) opLogs.shift();
    };

    const { result } = await inquirer.prompt([{
      type: 'two-phase-tree',
      name: 'result',
      message: 'Claude Code Session:',
      tree,
      pageSize: 15,
      loop: false,
      getLogs: () => opLogs,
      actionsProvider: (node: any) =>
        node?.value?.type === 'dir'
          ? ['新會話', '刪除所有 sessions', '刪除目錄 (含 memory)']
          : ['回到會話', '重命名', '刪除'],
      confirmActions: {
        '刪除': ['確定刪除', '取消'],
        '刪除所有 sessions': ['確定刪除', '取消'],
        '刪除目錄 (含 memory)': ['確定刪除', '取消'],
      },
      inputActions: ['重命名'],
      isActive: (sessionId: string) => watcher.getActive().has(sessionId),
      onRenderContext: (ctx: { tree: any[]; render: () => void }) => {
        renderContext = ctx;
      },

      // treeData here is the library's internal clone tree (this.tree.children)
      // — reference equality works correctly for all operations
      onAction: async (action: string, treeNode: any, treeData: any[], input?: string) => {
        const nodeVal = treeNode.value as TreeNodeValue;
        const activeSet = watcher.getActive();

        try {
        if (action === '重命名' && nodeVal.type === 'session') {
          const { session } = nodeVal;
          const newName = input?.trim();
          if (!newName || newName === session.session_name) return;
          await ops.renameSession(session.cc_project_dir, session.session_id, newName);
          const oldName = session.session_name;
          session.session_name = newName;
          const dirNode = treeData.find((d: any) => d.children?.includes(treeNode));
          if (dirNode) rebuildDirChildren(dirNode, activeSet);
          addLog(`session "${oldName}" 更名為 "${newName}"`);

        } else if (action === '刪除' && nodeVal.type === 'session') {
          const { session } = nodeVal;
          const deletedName = session.session_name;
          await ops.deleteSession(session.cc_project_dir, session.session_id);
          const dirNode = treeData.find((d: any) => d.children?.includes(treeNode));
          if (dirNode) {
            dirNode.children = dirNode.children.filter((c: any) => c !== treeNode);
            if (dirNode.children.length === 0) treeData.splice(treeData.indexOf(dirNode), 1);
            else rebuildDirChildren(dirNode, activeSet);
          }
          addLog(`session "${deletedName}" 已刪除`);

        } else if (action === '刪除所有 sessions' && nodeVal.type === 'dir') {
          const dirName = projectDirName(nodeVal.project);
          await ops.deleteAllSessions(nodeVal.project.cc_project_dir);
          treeData.splice(treeData.indexOf(treeNode), 1);
          addLog(`"${dirName}" 所有 sessions 已刪除`);

        } else if (action === '刪除目錄 (含 memory)' && nodeVal.type === 'dir') {
          const dirName = projectDirName(nodeVal.project);
          await ops.deleteDirectory(nodeVal.project.cc_project_dir);
          treeData.splice(treeData.indexOf(treeNode), 1);
          addLog(`"${dirName}" 目錄已刪除`);
        }
        } catch (err: any) {
          addLog(`操作「${action}」失敗：${err?.message ?? err}`);
        }
      },
    }]);

    const { node, action } = result as {
      node: { value: TreeNodeValue };
      action: string;
    };

    if (node.value.type === 'dir') {
      ops.newSession(node.value.project.original_project_dir);
    } else {
      const { session } = node.value;
      const knownProjectDirs = projectsWithSessions
        .filter((p) => !p.project.path_missing)
        .map((p) => p.project.original_project_dir);
      ops.resumeSession(session.session_id, session.original_project_dir, session.cc_project_dir, knownProjectDirs);
    }

  } finally {
    watcher.stop();
  }
}

main().catch(console.error);
