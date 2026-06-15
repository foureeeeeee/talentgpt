export type OutputPhase = 'dashboard' | 'input' | 'analysis';

export type AnalysisModule =
  | 'snapshot'
  | 'match'
  | 'potential'
  | 'risk'
  | 'psychology'
  | 'interview'
  | 'compensation'
  | 'rejection'
  | 'audit'
  | 'ranking'
  | 'team_optimization'
  | 'similarity'
  | 'retention';

export type CvInputType = 'text' | 'pdf' | 'linkedin';

export interface CV {
  id: string;
  name: string;
  type: CvInputType;
  content?: string;
  fileData?: string;
  mimeType?: string;
}

export interface JobProject {
  id: string;
  title: string;
  description: string;
  managerNotes: string;
  candidates: CV[];
  createdAt: number;
}

export interface AnalysisState {
  jobDescription: string;
  managerNotes: string;
  cvs: CV[];
  activeModule: AnalysisModule;
  loading: Record<string, boolean>;
  results: Record<string, string>;
  error: string | null;
}
