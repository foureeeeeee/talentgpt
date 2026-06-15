/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { InputSection } from './components/InputSection';
import { AnalysisResults } from './components/AnalysisResults';
import { Dashboard } from './components/Dashboard';
import { AnalysisModule, CV, JobProject, OutputPhase } from './types';
import { ChevronRight, ArrowLeft, FileText, BarChart2 } from 'lucide-react';

export const MODULE_LABELS: Record<AnalysisModule, string> = {
  snapshot: 'Candidate Snapshot',
  match: 'Job Match Analysis',
  potential: 'Potential Assessment',
  risk: 'HR Risk Assessment',
  psychology: 'Org Psychology',
  interview: 'Interview Questions',
  compensation: 'Compensation Intel',
  rejection: 'Ethical Rejection',
  audit: 'AI Verification Audit',
  ranking: 'Candidate Ranking',
  team_optimization: 'Team Optimization',
  similarity: 'Similarity Agent',
  retention: 'Retention & Flight Risk',
};

type InputMode = 'new' | 'edit' | 'add-candidates';

// Tracks how many stale PDF candidates were pruned on the initial load
let _stalePruned = 0;

function loadProjects(): JobProject[] {
  try {
    const raw = localStorage.getItem('talentgpt_projects');
    if (!raw) return [];
    const projects: JobProject[] = JSON.parse(raw);
    let pruned = 0;
    const cleaned = projects.map(p => ({
      ...p,
      candidates: p.candidates.filter(c => {
        // Keep text/linkedin always; keep PDFs only if they have usable data
        if (c.type === 'pdf' && !c.fileData && !c.content?.trim()) {
          pruned++;
          return false;
        }
        return true;
      }),
    }));
    _stalePruned = pruned;
    return cleaned;
  } catch { return []; }
}

function saveProjects(projects: JobProject[]) {
  try {
    // Strip large PDF binary data to stay within localStorage limits
    const slim = projects.map(p => ({
      ...p,
      candidates: p.candidates.map(c => ({ ...c, fileData: undefined })),
    }));
    localStorage.setItem('talentgpt_projects', JSON.stringify(slim));
  } catch { /* quota exceeded — silently ignore */ }
}

export default function App() {
  const [phase, setPhase]             = useState<OutputPhase>('dashboard');
  const [projects, setProjects]       = useState<JobProject[]>(loadProjects);
  const [editProjectId, setEditId]    = useState<string | null>(null);
  const [inputMode, setInputMode]     = useState<InputMode>('new');
  // One-time notice if stale PDF candidates were pruned on load
  const [staleNotice, setStaleNotice] = useState(_stalePruned);

  // Analysis runtime state
  const [jobDescription, setJobDescription] = useState('');
  const [managerNotes, setManagerNotes]     = useState('');
  const [cvs, setCvs]                       = useState<CV[]>([]);
  const [activeModule, setActiveModule]     = useState<AnalysisModule>('snapshot');
  const [moduleLoading, setModuleLoading]   = useState<Record<string, boolean>>({});
  const [moduleResults, setModuleResults]   = useState<Record<string, string>>({});
  const [moduleErrors, setModuleErrors]     = useState<Record<string, string | null>>({});
  // Dashboard score cache passed into analysis view
  const [analysisAllScores, setAnalysisAllScores]       = useState<Record<string, Record<string, any>>>({});
  const [analysisActiveFilter, setAnalysisActiveFilter] = useState<string>('all');
  const [showCvPanel, setShowCvPanel]                 = useState(false);
  const [showScorePanel, setShowScorePanel]           = useState(false);

  // Persist projects whenever they change
  useEffect(() => { saveProjects(projects); }, [projects]);

  // Keep a ref so runAnalysis never has stale closures
  const analysisDataRef = useRef({ cvs, jobDescription, managerNotes });
  useEffect(() => {
    analysisDataRef.current = { cvs, jobDescription, managerNotes };
  }, [cvs, jobDescription, managerNotes]);

  const runAnalysis = useCallback(async (mod: AnalysisModule) => {
    setModuleLoading(prev => ({ ...prev, [mod]: true }));
    setModuleErrors(prev => ({ ...prev, [mod]: null }));
    const { cvs: c, jobDescription: jd, managerNotes: n } = analysisDataRef.current;
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: mod, cvs: c, jobDescription: jd, managerNotes: n }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to analyze candidate data.');
      setModuleResults(prev => ({ ...prev, [mod]: data.result }));
    } catch (err: any) {
      setModuleErrors(prev => ({ ...prev, [mod]: err.message || 'An unexpected error occurred.' }));
    } finally {
      setModuleLoading(prev => ({ ...prev, [mod]: false }));
    }
  }, []);

  useEffect(() => {
    if (phase === 'analysis' && !moduleResults[activeModule] && !moduleLoading[activeModule] && !moduleErrors[activeModule]) {
      runAnalysis(activeModule);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModule, phase]);

  // ── Dashboard handlers ──────────────────────────────────────────────────────
  const handleNewJob = () => {
    setEditId(null);
    setInputMode('new');
    setPhase('input');
  };

  const handleEditProject = (id: string) => {
    setEditId(id);
    setInputMode('edit');
    setPhase('input');
  };

  const handleAddCandidates = (id: string) => {
    setEditId(id);
    setInputMode('add-candidates');
    setPhase('input');
  };

  const handleCancelInput = () => {
    setEditId(null);
    setPhase('dashboard');
  };

  const handleSaveProject = (data: { title: string; description: string; managerNotes: string; candidates: CV[] }) => {
    if (inputMode === 'new') {
      const project: JobProject = {
        id: crypto.randomUUID(),
        title: data.title,
        description: data.description,
        managerNotes: data.managerNotes,
        candidates: data.candidates,
        createdAt: Date.now(),
      };
      setProjects(prev => [project, ...prev]);
    } else if (editProjectId) {
      setProjects(prev => prev.map(p => {
        if (p.id !== editProjectId) return p;
        if (inputMode === 'add-candidates') {
          return { ...p, candidates: [...p.candidates, ...data.candidates] };
        }
        return { ...p, title: data.title, description: data.description, managerNotes: data.managerNotes, candidates: data.candidates };
      }));
    }
    setEditId(null);
    setPhase('dashboard');
  };

  const handleRunAnalysis = (projectId: string, candidateIds: string[], allScores: Record<string, Record<string, any>> = {}, filter: string = 'all') => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    const selected = project.candidates.filter(c => candidateIds.includes(c.id));
    setJobDescription(project.description);
    setManagerNotes(project.managerNotes);
    setCvs(selected);
    setModuleResults({});
    setModuleErrors({});
    setModuleLoading({});
    setActiveModule('snapshot');
    setAnalysisAllScores(allScores);
    setAnalysisActiveFilter(filter);
    setShowCvPanel(false);
    setShowScorePanel(false);
    setPhase('analysis');
  };

  // ── Derive initial data for InputSection ────────────────────────────────────
  const editProject = editProjectId ? projects.find(p => p.id === editProjectId) : null;
  const inputInitialData = editProject
    ? {
        title: editProject.title,
        description: editProject.description,
        managerNotes: editProject.managerNotes,
        candidates: inputMode === 'add-candidates' ? [] : editProject.candidates,
      }
    : undefined;

  // ── Header labels ───────────────────────────────────────────────────────────
  const inputPhaseLabel =
    inputMode === 'new'             ? 'New Job'           :
    inputMode === 'edit'            ? 'Edit Job'          :
                                      'Add Candidates';

  return (
    <div className="flex h-screen bg-gray-50 w-full overflow-hidden text-gray-900 font-sans">
      {phase === 'analysis' && (
        <Sidebar
          activeModule={activeModule}
          setActiveModule={setActiveModule}
          cvCount={cvs.length}
          moduleLoading={moduleLoading}
          moduleResults={moduleResults}
          moduleErrors={moduleErrors}
        />
      )}

      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="h-16 flex items-center shrink-0 px-6 border-b border-gray-200 bg-white">
          {phase === 'dashboard' && (
            <div className="flex items-center gap-2">
              <span className="font-bold text-xl tracking-tight text-black">TalentGPT</span>
              <ChevronRight className="w-4 h-4 text-gray-300" />
              <span className="text-gray-500 text-sm">Dashboard</span>
            </div>
          )}

          {phase === 'input' && (
            <div className="flex items-center gap-2">
              <span className="font-bold text-xl tracking-tight text-black">TalentGPT</span>
              <ChevronRight className="w-4 h-4 text-gray-300" />
              <span className="text-gray-500 text-sm">{inputPhaseLabel}</span>
            </div>
          )}

          {phase === 'analysis' && (
            <div className="flex flex-1 items-center justify-between">
              <button
                onClick={() => setPhase('dashboard')}
                className="flex flex-row items-center gap-2 text-sm font-medium text-gray-500 hover:text-black transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Dashboard
              </button>
              <span className="text-sm font-semibold text-black">{MODULE_LABELS[activeModule]}</span>
              <div className="flex items-center text-sm text-gray-500 gap-2">
                <span className="text-xs">{cvs.length} candidate{cvs.length !== 1 ? 's' : ''}</span>
                {jobDescription.trim() && (
                  <>
                    <span className="text-gray-300">·</span>
                    <span className="text-xs text-gray-400">JD</span>
                  </>
                )}
                <span className="text-gray-200 mx-1">|</span>
                <button
                  onClick={() => setShowCvPanel(v => !v)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${showCvPanel ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                >
                  <FileText className="w-3.5 h-3.5" />View CV
                </button>
                <button
                  onClick={() => setShowScorePanel(v => !v)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${showScorePanel ? 'bg-violet-600 text-white border-violet-600' : 'text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                >
                  <BarChart2 className="w-3.5 h-3.5" />AI Score
                </button>
              </div>
            </div>
          )}
        </header>

        {/* ── Stale-data notice ───────────────────────────────────────────── */}
        {staleNotice > 0 && phase === 'dashboard' && (
          <div className="shrink-0 flex items-center gap-3 px-5 py-2.5 bg-amber-50 border-b border-amber-200 text-xs text-amber-800">
            <span className="text-amber-500 text-base leading-none">⚠</span>
            <span className="flex-1">
              <strong>{staleNotice} PDF candidate{staleNotice !== 1 ? 's' : ''}</strong> were removed — PDF binary data isn't kept between sessions.
              Re-upload those files to restore them.
            </span>
            <button
              onClick={() => setStaleNotice(0)}
              className="ml-2 text-amber-400 hover:text-amber-700 font-bold text-sm leading-none"
              aria-label="Dismiss"
            >×</button>
          </div>
        )}

        {/* ── Page content ────────────────────────────────────────────────── */}
        {phase === 'dashboard' && (
          <Dashboard
            projects={projects}
            onNewJob={handleNewJob}
            onEditProject={handleEditProject}
            onAddCandidates={handleAddCandidates}
            onRunAnalysis={handleRunAnalysis}
          />
        )}

        {phase === 'input' && (
          <InputSection
            initialData={inputInitialData}
            candidatesOnly={inputMode === 'add-candidates'}
            isEdit={inputMode === 'edit'}
            onSave={handleSaveProject}
            onCancel={handleCancelInput}
          />
        )}

        {phase === 'analysis' && (
          <AnalysisResults
            loading={moduleLoading[activeModule] ?? false}
            error={moduleErrors[activeModule] ?? null}
            result={moduleResults[activeModule] ?? null}
            activeModule={activeModule}
            onRetry={() => runAnalysis(activeModule)}
            cvs={cvs}
            allScores={analysisAllScores}
            activeFilter={analysisActiveFilter}
            jobDescription={jobDescription}
            managerNotes={managerNotes}
            showCvPanel={showCvPanel}
            onCloseCvPanel={() => setShowCvPanel(false)}
            showScorePanel={showScorePanel}
            onCloseScorePanel={() => setShowScorePanel(false)}
          />
        )}
      </main>
    </div>
  );
}
