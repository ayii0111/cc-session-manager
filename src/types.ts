export interface ProjectInfo {
  cc_project_dir: string;
  original_project_dir: string;
  /** No session in this project has a real cwd, so the path came from the lossy slug. */
  path_inferred: boolean;
}

export interface SessionInfo {
  cc_project_dir: string;
  original_project_dir: string;
  /** This session's file has no cwd (e.g. opened and left without any message). */
  cwd_inferred: boolean;
  session_name: string;
  session_id: string;
  lastTime: string;
  fileSize: number;
}

export type TreeNodeValue =
  | { type: 'dir'; project: ProjectInfo }
  | { type: 'session'; session: SessionInfo };
