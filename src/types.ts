export interface ProjectInfo {
  cc_project_dir: string;
  original_project_dir: string;
  /** No session in this project has a real cwd, so the path came from the lossy slug. */
  path_inferred: boolean;
  /** original_project_dir no longer exists on disk (checked when the list loads). */
  path_missing: boolean;
}

export interface SessionInfo {
  cc_project_dir: string;
  original_project_dir: string;
  /** This session's file has no cwd (e.g. opened and left without any message). */
  cwd_inferred: boolean;
  /** original_project_dir encodes to this session's project dir slug, so `claude -r` can find it from there. */
  cwd_matched: boolean;
  session_name: string;
  session_id: string;
  lastTime: string;
  fileSize: number;
}

export type TreeNodeValue =
  | { type: 'dir'; project: ProjectInfo }
  | { type: 'session'; session: SessionInfo };
