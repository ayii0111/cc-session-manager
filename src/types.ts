export interface ProjectInfo {
  cc_project_dir: string;
  original_project_dir: string;
}

export interface SessionInfo {
  cc_project_dir: string;
  original_project_dir: string;
  session_name: string;
  session_id: string;
  lastTime: string;
  fileSize: number;
}

export type TreeNodeValue =
  | { type: 'dir'; project: ProjectInfo }
  | { type: 'session'; session: SessionInfo };
