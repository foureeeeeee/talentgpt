import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Plus, Users, Briefcase, Check, ChevronRight, Pencil, UserPlus,
  FileText, File, Linkedin, Search, X, Archive, ChevronDown,
  RotateCcw, Code2, Clock, Zap, BookOpen, Heart, SlidersHorizontal,
  Loader2, AlertCircle, TrendingUp, ShieldCheck, AlertTriangle, Sparkles,
  Fingerprint, ChevronUp, ClipboardList, Maximize2,
  TrendingDown, Mail, Eye, EyeOff, Filter, Layers,
} from 'lucide-react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
import { CV, JobProject } from '../types';
import ReportModal from './ReportModal';
import TeamModal from './TeamModal';

// Render PDF pages to base64 PNG images for vision OCR
async function renderPdfToImages(fileData: string): Promise<string[]> {
  const b64 = fileData.includes(',') ? fileData.split(',')[1] : fileData;
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const pdf = await getDocument({ data: bytes }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width; canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
    pages.push(canvas.toDataURL('image/png'));
  }
  return pages;
}

// Extract text from a CV — server text extraction with vision OCR fallback
async function extractCvText(cv: CV): Promise<string> {
  if (cv.content?.trim()) return cv.content.trim();
  if (!cv.fileData) return '';

  // Try server-side text extraction first
  try {
    const r = await fetch('/api/extract-pdf-text', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileData: cv.fileData }),
    });
    const d = await r.json();
    if (d.text?.trim()) return d.text.trim();
  } catch { /* fall through */ }

  // Fallback: render pages + Claude vision OCR
  try {
    const pages = await renderPdfToImages(cv.fileData);
    const r = await fetch('/api/extract-pdf-text-vision', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pages }),
    });
    const d = await r.json();
    return d.text?.trim() || '';
  } catch { return ''; }
}

// ── Types ──────────────────────────────────────────────────────────────────────

type FilterType = 'all' | 'skills' | 'experience' | 'impact' | 'education' | 'culture' | 'leadership';
type Indicator  = 'above' | 'below' | 'neutral';

interface AiDimension      { label: string; score: number; max: number; reason: string; purple?: boolean }
interface SecurityAlert    { riskLevel: 'low'|'medium'|'high'; type: string; detectedText: string }
interface AiCandidateScore {
  name: string; total: number; summary: string; breakdown: AiDimension[];
  confidence?: number; confidenceLevel?: 'high'|'medium'|'low';
  confidenceReason?: string; confidenceFlags?: string[];
  securityAlerts?: SecurityAlert[];
}
type AiScores = Record<string, AiCandidateScore>;

interface ScoredCV           { cv: CV; score: number; indicator: Indicator }
interface InjectionFlag      { type: string; severity: 'low'|'medium'|'high'; description: string; snippet?: string; detectedText?: string }
interface CvInjectionResult  { cvId: string; name: string; flags: InjectionFlag[]; riskLevel: 'none'|'low'|'medium'|'high'; source: 'client'|'scoring'|'ai-scan' }
interface AiSearchResult     { id: string; relevance: string }
interface CloneResult {
  id: string; overall: number;
  scores: { skills: number; experience: number; education: number; leadership: number; learning: number; communication: number };
  whyRecommended: string[]; keyDifferences: string[]; advantages: string[];
  riskLevel: 'Low' | 'Medium' | 'High'; riskEvidence: string[];
  hiddenPotential: string;
  recommendation: 'Strongly Recommended' | 'Recommended' | 'Worth Reviewing' | 'Not Recommended';
}

// ── Stage Tracker ──────────────────────────────────────────────────────────────

type CandidateStage = 0 | 1 | 2 | 3 | 4;

const STAGE_CONFIG: Record<CandidateStage, { label: string; short: string; bg: string; text: string; dot: string; border: string; activeBg: string }> = {
  0: { label: 'New',          short: 'New',    bg: 'bg-gray-100',    text: 'text-gray-500',    dot: 'bg-gray-400',    border: 'border-gray-200',  activeBg: 'bg-gray-500'    },
  1: { label: 'Screened',     short: 'Screen', bg: 'bg-sky-50',      text: 'text-sky-600',     dot: 'bg-sky-500',     border: 'border-sky-200',   activeBg: 'bg-sky-500'     },
  2: { label: 'Phone Screen', short: 'Phone',  bg: 'bg-amber-50',    text: 'text-amber-600',   dot: 'bg-amber-400',   border: 'border-amber-200', activeBg: 'bg-amber-400'   },
  3: { label: 'Interview',    short: 'Intv',   bg: 'bg-violet-50',   text: 'text-violet-700',  dot: 'bg-violet-500',  border: 'border-violet-200',activeBg: 'bg-violet-500'  },
  4: { label: 'Offer',        short: 'Offer',  bg: 'bg-emerald-50',  text: 'text-emerald-700', dot: 'bg-emerald-500', border: 'border-emerald-200',activeBg: 'bg-emerald-500'},
};

const STAGE_ORDER: CandidateStage[] = [0, 1, 2, 3, 4];

// ── Filter definitions ─────────────────────────────────────────────────────────

const FILTERS: { key: FilterType; label: string; icon: React.ElementType; short: string }[] = [
  { key: 'all',        label: 'All Candidates',     icon: Users,      short: 'All'        },
  { key: 'skills',     label: 'Skills Profile',     icon: Code2,      short: 'Skills'     },
  { key: 'experience', label: 'Experience Profile', icon: Clock,      short: 'Experience' },
  { key: 'impact',     label: 'Impact Profile',     icon: Zap,        short: 'Impact'     },
  { key: 'education',  label: 'Education Profile',  icon: BookOpen,   short: 'Education'  },
  { key: 'culture',    label: 'Culture Profile',    icon: Heart,      short: 'Culture'    },
  { key: 'leadership', label: 'Leadership Profile', icon: TrendingUp, short: 'Leadership' },
];

// ── Visual constants ───────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  'bg-violet-500','bg-blue-500','bg-emerald-500','bg-amber-500',
  'bg-rose-500','bg-cyan-500','bg-orange-500','bg-purple-500',
];
const TYPE_BADGE: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  pdf:      { bg: 'bg-blue-50',  text: 'text-blue-600',  icon: File     },
  text:     { bg: 'bg-gray-100', text: 'text-gray-500',  icon: FileText },
  linkedin: { bg: 'bg-sky-50',   text: 'text-sky-600',   icon: Linkedin },
};

// ── Text-based local scoring ───────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the','and','for','are','was','will','with','have','this','that','from','your','our',
  'you','can','they','but','not','all','has','had','her','his','one','each','their',
  'more','who','may','what','when','where','how','any','also','been','both','into',
  'over','such','then','than','work','able','about','some','well','must','good','like',
  'time','very','just','them','make','know','take','team','using','use','new','other',
  'required','strong','key','role','should','including','experience','candidate','skills','skill',
]);

function extractJdKeywords(jd: string): string[] {
  if (!jd.trim()) return [];
  const words = jd.toLowerCase().match(/\b[a-z][a-z+#.]{2,}\b/g) || [];
  const freq = new Map<string, number>();
  words.filter(w => !STOPWORDS.has(w)).forEach(w => freq.set(w, (freq.get(w) || 0) + 1));
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w).slice(0, 80);
}

function getText(cv: CV): string { return (cv.content || '').toLowerCase(); }

function computeLocalScore(cv: CV, filter: FilterType, kws: string[]): number {
  const t = getText(cv);
  if (!t) return -1;
  switch (filter) {
    case 'skills': {
      if (!kws.length) return -1;
      return kws.filter(k => t.includes(k)).length;
    }
    case 'experience': {
      const nums = (t.match(/\b(\d{1,2})\+?\s*(?:years?|yrs?)\b/g) || []).map(m => parseInt(m)).filter(n => n > 0 && n < 50);
      const roles = (t.match(/\b(?:senior|lead|manager|director|engineer|analyst|developer|designer|consultant)\b/g) || []).length;
      return (nums.length ? Math.max(...nums) : 0) * 2 + roles;
    }
    case 'impact': {
      const pct  = (t.match(/\d+\s*%/g) || []).length;
      const acts = ['led','built','launched','created','founded','designed','increased','improved','reduced','delivered','achieved','won','award','scholarship','published','grew','drove','pioneered','saved','generated'].filter(w => t.includes(w)).length;
      const big  = (t.match(/\$[\d,]+|\b\d{4,}[\s+]*(?:user|customer|client|employee)/g) || []).length;
      return pct * 3 + acts * 2 + big * 2;
    }
    case 'education': {
      let s = 0;
      if (t.includes('phd') || t.includes('doctorate')) s += 8;
      else if (/(master|m\.sc|mba|m\.eng)/.test(t)) s += 6;
      else if (/(bachelor|b\.sc|b\.eng|degree)/.test(t)) s += 4;
      if (t.match(/\bgpa\b|\b[34]\.[0-9]/)) s += 3;
      ['aws','azure','gcp','pmp','scrum','cpa','cfa','cissp','certif','certified'].forEach(w => { if (t.includes(w)) s += 2; });
      return s;
    }
    case 'culture':
      return ['team','collaborat','communicat','volunteer','community','passion','initiative','value','diversity','inclusion','mentor','aiesec','club','society','committee','contribut','open source','hackathon','ambassador','council','nonprofit','outreach'].filter(w => t.includes(w)).length;
    case 'leadership':
      return ['led','managed','coached','mentored','directed','supervised','organised','organized','delegated','motivated','hired','promoted','strategy','vision','initiative','founded','built team','grew team'].filter(w => t.includes(w)).length;
    default: return 0;
  }
}

// ── Client-side injection detection ───────────────────────────────────────────

const INJECTION_PATTERNS: { regex: RegExp; type: string; severity: 'low'|'medium'|'high' }[] = [
  { regex: /\bignore\b.{0,40}\b(instructions?|prompts?|above|previous|all|prior)\b/i, type: 'Instruction override', severity: 'high' },
  { regex: /\b(you (are|must|should|will|have to)|act as)\b.{0,30}\b(ai|assistant|recruiter|hr|scoring)\b/i, type: 'Role manipulation', severity: 'high' },
  { regex: /give.{0,25}\b(high|maximum|perfect|best|top|full).{0,20}\b(score|rating|mark|grade|point)\b/i, type: 'Score manipulation', severity: 'high' },
  { regex: /\bsystem\s*(prompt|message|instruction)\b/i, type: 'System prompt reference', severity: 'high' },
  { regex: /\[INST\]|<\|im_start\|>|<\|system\|>|\[SYSTEM\]/i, type: 'Model token injection', severity: 'high' },
  { regex: /\b(disregard|override|bypass|circumvent|forget|reset).{0,25}\b(rule|instruction|guideline|filter)\b/i, type: 'Bypass attempt', severity: 'medium' },
  { regex: /(this candidate|i|the applicant).{0,20}\b(should be|must be|deserves to be)\b.{0,20}\b(selected|hired|approved|top|first)\b/i, type: 'Outcome manipulation', severity: 'high' },
  { regex: /as an? (ai|llm|language model|gpt|claude)\b/i, type: 'AI persona override', severity: 'medium' },
  { regex: /(output|print|say|respond|write).{0,20}\b(this candidate|score|hire|select)\b/i, type: 'Output manipulation', severity: 'medium' },
];
const INVISIBLE_RE = /[​-‍﻿­͏ᅟᅠ឴឵ㅤﾠ᠎]/g;

function detectInjection(cv: CV): InjectionFlag[] {
  const text = cv.content || '';
  if (!text) return [];
  const flags: InjectionFlag[] = [];

  const invisibles = text.match(INVISIBLE_RE);
  if (invisibles && invisibles.length > 2)
    flags.push({ type: 'Hidden Unicode', severity: 'high', description: `${invisibles.length} invisible character(s) — may embed hidden instructions invisible to human readers` });

  for (const { regex, type, severity } of INJECTION_PATTERNS) {
    const match = text.match(regex);
    if (match) {
      const idx = text.toLowerCase().search(regex);
      const snip = idx >= 0 ? `"…${text.slice(Math.max(0, idx - 15), idx + match[0].length + 15).trim()}…"` : undefined;
      flags.push({ type, severity, description: `${type} pattern detected`, snippet: snip });
    }
  }

  const stuffed = text.match(/(\b\w{3,}\b)(\s+\1){4,}/gi);
  if (stuffed)
    flags.push({ type: 'Keyword stuffing', severity: 'low', description: 'Abnormal keyword repetition — may attempt to game AI scoring', snippet: `"${stuffed[0].slice(0, 60)}…"` });

  return flags;
}

function getRiskLevel(flags: InjectionFlag[]): CvInjectionResult['riskLevel'] {
  if (!flags.length) return 'none';
  if (flags.some(f => f.severity === 'high'))   return 'high';
  if (flags.some(f => f.severity === 'medium')) return 'medium';
  return 'low';
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(' ').map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}
function cvSnippet(cv: CV): string {
  if (cv.content) return cv.content.slice(0, 140) + (cv.content.length > 140 ? '…' : '');
  if (cv.type === 'pdf') return 'PDF resume uploaded';
  return '';
}

function confidenceCls(level?: string) {
  if (level === 'high')   return { ring: 'text-emerald-600', bar: 'bg-emerald-400', bg: 'bg-emerald-50' };
  if (level === 'medium') return { ring: 'text-amber-500',   bar: 'bg-amber-400',   bg: 'bg-amber-50'   };
  return                         { ring: 'text-red-500',     bar: 'bg-red-400',     bg: 'bg-red-50'     };
}

function riskBadgeCls(risk: string) {
  if (risk === 'high')   return 'bg-red-100 text-red-700 border border-red-200';
  if (risk === 'medium') return 'bg-amber-100 text-amber-700 border border-amber-200';
  return                        'bg-gray-100 text-gray-600 border border-gray-200';
}

const CONFIDENCE_FLAG_LABELS: Record<string, { label: string; positive: boolean }> = {
  complete_cv:          { label: 'Complete CV',              positive: true  },
  quantifiable_results: { label: 'Quantifiable results',     positive: true  },
  strong_evidence:      { label: 'Strong evidence',          positive: true  },
  verifiable_claims:    { label: 'Verifiable claims',        positive: true  },
  consistent_timeline:  { label: 'Consistent timeline',      positive: true  },
  missing_details:      { label: 'Missing details',          positive: false },
  inferred_skills:      { label: 'Skills inferred',          positive: false },
  no_metrics:           { label: 'No metrics',               positive: false },
  sparse_content:       { label: 'Sparse content',           positive: false },
  vague_claims:         { label: 'Vague claims',             positive: false },
  timeline_gaps:        { label: 'Timeline gaps',            positive: false },
};

// ── DimBar ────────────────────────────────────────────────────────────────────

function DimBar({ dim }: { dim: AiDimension }) {
  const pct = Math.round((dim.score / dim.max) * 100);
  const barColor = dim.purple ? 'bg-purple-400' : pct >= 70 ? 'bg-emerald-400' : pct >= 40 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-1">
        <span className={`text-[7.5px] font-semibold uppercase tracking-wide leading-none truncate ${dim.purple ? 'text-purple-500' : 'text-gray-500'}`}>
          {dim.purple && <span className="mr-0.5">★</span>}{dim.label}
        </span>
        <span className="text-[9px] font-bold text-gray-700 tabular-nums shrink-0">{dim.score}<span className="text-gray-400 font-normal">/{dim.max}</span></span>
      </div>
      <div className={`h-1 rounded-full overflow-hidden ${dim.purple ? 'bg-purple-100' : 'bg-gray-100'}`}>
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <p className={`text-[7.5px] leading-tight ${dim.purple ? 'text-purple-400 italic' : 'text-gray-400'}`}>{dim.reason}</p>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface DashboardProps {
  projects: JobProject[];
  onNewJob: () => void;
  onEditProject: (id: string) => void;
  onAddCandidates: (projectId: string) => void;
  onRunAnalysis: (projectId: string, candidateIds: string[], allFilterScores: Record<string, Record<string, any>>, activeFilter: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Dashboard({ projects, onNewJob, onEditProject, onAddCandidates, onRunAnalysis }: DashboardProps) {
  const [activeId, setActiveId]         = useState<string>(projects[0]?.id ?? '');
  const [selected, setSelected]         = useState<Set<string>>(new Set());
  const [hovered, setHovered]           = useState<{ id: string; rect: DOMRect } | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [search, setSearch]             = useState('');
  const [archivedIds, setArchivedIds]   = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const [gridVisible, setGridVisible]   = useState(true);
  const [animKey, setAnimKey]           = useState(0);
  const [expandedIds, setExpandedIds]   = useState<Set<string>>(new Set());

  // Per-filter AI score cache
  const [filterScores, setFilterScores]   = useState<Partial<Record<FilterType, AiScores>>>({});
  const [scoringFilter, setScoringFilter] = useState<FilterType | null>(null);
  const [scoringError, setScoringError]   = useState<string | null>(null);
  // Filters the user has explicitly clicked — prevents auto-scoring 'all' on first load
  const [activatedFilters, setActivatedFilters] = useState<Set<FilterType>>(new Set());

  // AI semantic search
  const [aiSearchResults, setAiSearchResults] = useState<AiSearchResult[] | null>(null);
  const [aiSearching, setAiSearching]         = useState(false);
  const [aiSearchError, setAiSearchError]     = useState<string | null>(null);

  const [actionsOpen, setActionsOpen]       = useState(true);
  const [showReport, setShowReport]         = useState(false);
  const [showTeam, setShowTeam]             = useState(false);

  // Stage tracker — keyed by `${activeId}_${cv.id}`
  const [candidateStages, setCandidateStages] = useState<Record<string, CandidateStage>>(() => {
    try { return JSON.parse(localStorage.getItem('talentgpt_stages') || '{}'); } catch { return {}; }
  });
  const [stageFilter, setStageFilter] = useState<CandidateStage | null>(null);
  const [openStageMenu, setOpenStageMenu] = useState<string | null>(null);

  // Blind review mode
  const [blindMode, setBlindMode] = useState(false);

  // Email draft
  const [showEmail, setShowEmail] = useState(false);

  // JD Bias Audit
  const [showBiasAudit, setShowBiasAudit] = useState(false);
  const [biasLoading, setBiasLoading] = useState(false);
  const [biasResult, setBiasResult] = useState<{ flags: any[]; overallRisk: string; summary: string; score: number } | null>(null);

  // Spark Points
  const [sparkPoints, setSparkPoints] = useState<Record<string, string>>({});
  const [sparkLoading, setSparkLoading] = useState(false);
  const [showSparks, setShowSparks] = useState(false);

  // Clone Search
  const [cloneMode, setCloneMode]           = useState(false);
  const [cloneRefId, setCloneRefId]         = useState<string | null>(null);
  const [cloneResults, setCloneResults]     = useState<CloneResult[] | null>(null);
  const [cloneLoading, setCloneLoading]     = useState(false);
  const [cloneError, setCloneError]         = useState<string | null>(null);
  const [cloneExpanded, setCloneExpanded]   = useState<Set<string>>(new Set());

  // Side panels
  const [showConfidence, setShowConfidence]         = useState(false);
  const [showInjection, setShowInjection]           = useState(false);
  const [zoomedScore, setZoomedScore]               = useState<{ name: string; colorClass: string; aiScore: AiCandidateScore } | null>(null);
  const [zoomedSpark, setZoomedSpark]               = useState<{ name: string; spark: string } | null>(null);
  const [injAiLoading, setInjAiLoading]             = useState(false);
  const [injAiResults, setInjAiResults]             = useState<CvInjectionResult[]>([]);
  const [injAiScanned, setInjAiScanned]             = useState(false);

  const active      = useMemo(() => projects.find(p => p.id === activeId) ?? null, [projects, activeId]);
  const jdKeywords  = useMemo(() => extractJdKeywords(active?.description ?? ''), [active?.description]);

  const currentAiScores: AiScores = useMemo(
    () => filterScores[activeFilter] ?? {},
    [activeFilter, filterScores]
  );
  const aiActive = Object.keys(currentAiScores).length > 0;

  // Client-side injection scan (instant regex, no API)
  const clientInjScan = useMemo<CvInjectionResult[]>(() => {
    if (!active) return [];
    return active.candidates
      .map(cv => { const flags = detectInjection(cv); return { cvId: cv.id, name: cv.name, flags, riskLevel: getRiskLevel(flags), source: 'client' as const }; })
      .filter(r => r.riskLevel !== 'none');
  }, [active?.candidates]);

  // Injection alerts extracted from AI scoring responses (automatic, per scored candidate)
  const scoringInjScan = useMemo<CvInjectionResult[]>(() => {
    return Object.entries(currentAiScores)
      .filter(([, s]) => s.securityAlerts && s.securityAlerts.length > 0)
      .map(([id, s]) => ({
        cvId: id, name: s.name,
        flags: (s.securityAlerts || []).map(a => ({
          type: a.type, severity: a.riskLevel,
          description: `Detected by AI during scoring`,
          detectedText: a.detectedText,
          snippet: `"${a.detectedText}"`,
        })),
        riskLevel: (s.securityAlerts || []).reduce<CvInjectionResult['riskLevel']>((max, a) => {
          const order = { high: 2, medium: 1, low: 0, none: -1 } as const;
          return order[a.riskLevel] > order[max] ? a.riskLevel : max;
        }, 'low'),
        source: 'scoring' as const,
      }));
  }, [currentAiScores]);

  // Merge all three sources: AI deep scan > scoring alerts > client-side (deduplicated by cvId, highest source wins)
  const injectionResults = useMemo<CvInjectionResult[]>(() => {
    const map = new Map<string, CvInjectionResult>();
    // lowest priority first
    clientInjScan.forEach(r => map.set(r.cvId, r));
    scoringInjScan.forEach(r => { if (!map.has(r.cvId) || map.get(r.cvId)!.source === 'client') map.set(r.cvId, r); });
    injAiResults.forEach(r => map.set(r.cvId, { ...r, source: 'ai-scan' as const }));
    return [...map.values()];
  }, [clientInjScan, scoringInjScan, injAiResults]);

  const injectionMap = useMemo(() => {
    const m = new Map<string, CvInjectionResult>();
    injectionResults.forEach(r => m.set(r.cvId, r));
    return m;
  }, [injectionResults]);

  // ── Auto-score: only fires when user has explicitly clicked the filter ────────
  const scoringFilterRef = useRef<FilterType | null>(null);
  const filterScoresRef  = useRef(filterScores);
  filterScoresRef.current = filterScores;

  useEffect(() => {
    if (!active || !activatedFilters.has(activeFilter)) return;
    if (filterScoresRef.current[activeFilter]) return;
    if (scoringFilterRef.current) return;

    const f = activeFilter;
    scoringFilterRef.current = f;
    setScoringFilter(f);
    setScoringError(null);

    fetch('/api/score-candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cvs: active.candidates, jobDescription: active.description, managerNotes: active.managerNotes, filter: f }),
    })
      .then(r => r.json().then((d: any) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) throw new Error(d.error || 'Scoring failed');
        setFilterScores(prev => ({ ...prev, [f]: d.scores as AiScores }));
        setAnimKey(k => k + 1);
      })
      .catch((err: any) => setScoringError(err.message || 'Scoring failed'))
      .finally(() => { scoringFilterRef.current = null; setScoringFilter(null); });
  }, [activeFilter, active?.id, active?.candidates.length, activatedFilters]);

  // Persist stages to localStorage
  useEffect(() => {
    localStorage.setItem('talentgpt_stages', JSON.stringify(candidateStages));
  }, [candidateStages]);

  // Close stage dropdown on outside click
  useEffect(() => {
    if (!openStageMenu) return;
    const close = () => setOpenStageMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openStageMenu]);

  // ── Switch project ────────────────────────────────────────────────────────────
  const switchProject = useCallback((id: string) => {
    setActiveId(id); setSelected(new Set()); setArchivedIds(new Set());
    setActiveFilter('all'); setSearch(''); setGridVisible(true); setAnimKey(k => k + 1);
    setFilterScores({}); setScoringError(null); setExpandedIds(new Set());
    setActivatedFilters(new Set()); setAiSearchResults(null); setAiSearchError(null);
    setShowConfidence(false); setShowInjection(false);
    setInjAiResults([]); setInjAiScanned(false);
    setSparkPoints({}); setShowSparks(false);
  }, []);

  // ── Stage helpers ──────────────────────────────────────────────────────────────
  const getStage = useCallback((cvId: string): CandidateStage => {
    return (candidateStages[`${activeId}_${cvId}`] ?? 0) as CandidateStage;
  }, [candidateStages, activeId]);

  const setStage = useCallback((cvId: string, stage: CandidateStage) => {
    setCandidateStages(prev => ({ ...prev, [`${activeId}_${cvId}`]: stage }));
    setOpenStageMenu(null);
  }, [activeId]);

  const bulkMoveToStage = useCallback((stage: CandidateStage) => {
    setCandidateStages(prev => {
      const next = { ...prev };
      selected.forEach(cvId => { next[`${activeId}_${cvId}`] = stage; });
      return next;
    });
  }, [selected, activeId]);

  // ── JD Bias Audit ─────────────────────────────────────────────────────────────
  const runBiasAudit = useCallback(async () => {
    if (!active?.description?.trim()) return;
    setBiasLoading(true);
    setBiasResult(null);
    try {
      const r = await fetch('/api/jd-bias-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobDescription: active.description }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Bias audit failed');
      setBiasResult(d);
      setShowBiasAudit(true);
    } catch (err: any) {
      setBiasResult({ flags: [], overallRisk: 'error', summary: err.message, score: 0 });
      setShowBiasAudit(true);
    } finally {
      setBiasLoading(false);
    }
  }, [active?.description]);

  const handleSparks = useCallback(async () => {
    if (showSparks) { setShowSparks(false); return; }
    if (Object.keys(sparkPoints).length > 0) { setShowSparks(true); return; }
    if (!active?.candidates?.length) return;
    setSparkLoading(true);
    try {
      const resp = await fetch('/api/spark-points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cvs: active.candidates, jobDescription: active.description }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed');
      setSparkPoints(data.sparkPoints);
      setShowSparks(true);
    } catch { /* silently fail */ } finally {
      setSparkLoading(false);
    }
  }, [showSparks, sparkPoints, active]);

  // ── Change filter ─────────────────────────────────────────────────────────────
  const changeFilter = useCallback((f: FilterType) => {
    setActivatedFilters(prev => { const s = new Set(prev); s.add(f); return s; });
    setAiSearchResults(null); setAiSearchError(null);
    if (f === activeFilter) return; // already here — userActivated update triggers useEffect
    setGridVisible(false); setExpandedIds(new Set());
    setTimeout(() => {
      setActiveFilter(f); setAnimKey(k => k + 1);
      requestAnimationFrame(() => requestAnimationFrame(() => setGridVisible(true)));
    }, 190);
  }, [activeFilter]);

  // ── AI semantic search ────────────────────────────────────────────────────────
  const handleAiSearch = useCallback(async () => {
    if (!active || !search.trim()) return;
    setAiSearching(true); setAiSearchError(null);
    try {
      const r = await fetch('/api/ai-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: search,
          cvs: active.candidates.map(c => ({ id: c.id, name: c.name, content: c.content || '' })),
          jobDescription: active.description,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'AI search failed');
      setAiSearchResults(d.results || []);
    } catch (err: any) {
      setAiSearchError(err.message || 'AI search failed');
    } finally {
      setAiSearching(false);
    }
  }, [active, search]);

  const exitCloneMode = useCallback(() => {
    setCloneMode(false); setCloneRefId(null); setCloneResults(null); setCloneError(null);
  }, []);

  const handleCloneSearch = useCallback(async (refId: string) => {
    if (!active) return;
    const ref = active.candidates.find(c => c.id === refId);
    if (!ref) return;
    setCloneRefId(refId);
    setCloneLoading(true);
    setCloneError(null);
    setCloneResults(null);
    try {
      // Resolve text for all candidates client-side (handles PDFs with vision OCR fallback)
      const [refText, ...candidateTexts] = await Promise.all([
        extractCvText(ref),
        ...active.candidates.filter(c => c.id !== refId).map(extractCvText),
      ]);

      const pool = active.candidates
        .filter(c => c.id !== refId)
        .map((c, i) => ({ ...c, content: candidateTexts[i] }))
        .filter(c => c.content);

      if (!pool.length) throw new Error('No text could be extracted from any candidate PDF.');

      const r = await fetch('/api/clone-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referenceCv: { ...ref, content: refText },
          candidates: pool,
          jobDescription: active.description,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Clone search failed');
      const sorted = (d.results as CloneResult[]).sort((a, b) => b.overall - a.overall);
      setCloneResults(sorted);
    } catch (err: any) {
      setCloneError(err.message || 'Clone search failed');
    } finally {
      setCloneLoading(false);
    }
  }, [active]);

  // ── Injection AI deep scan ────────────────────────────────────────────────────
  const handleInjDeepScan = useCallback(async () => {
    if (!active) return;
    setInjAiLoading(true);
    try {
      const r = await fetch('/api/check-injection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cvs: active.candidates }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Scan failed');
      setInjAiResults((d.results || []).map((item: any) => ({
        cvId: item.id, name: active.candidates.find(c => c.id === item.id)?.name ?? item.id,
        flags: (item.flags || []).map((f: any) => ({ ...f, detectedText: f.detectedText || f.snippet })),
        riskLevel: item.riskLevel || 'none', source: 'ai-scan' as const,
      })));
      setInjAiScanned(true);
    } catch { /* fallback to client results */ }
    finally { setInjAiLoading(false); }
  }, [active]);

  const toggleExpand = (id: string) =>
    setExpandedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  // ── Scored + sorted candidates ────────────────────────────────────────────────
  const { scoredMain, scoredArchived, aboveCnt, belowCnt, avgScore } = useMemo(() => {
    if (!active) return { scoredMain: [], scoredArchived: [], aboveCnt: 0, belowCnt: 0, avgScore: 0 };

    const allScored = active.candidates.map(cv => ({
      cv,
      score: aiActive
        ? (currentAiScores[cv.id]?.total ?? -1)
        : (activeFilter === 'all' ? 0 : computeLocalScore(cv, activeFilter, jdKeywords)),
    }));

    const mainPool     = allScored.filter(c => !archivedIds.has(c.cv.id));
    const archivedPool = allScored.filter(c =>  archivedIds.has(c.cv.id));

    const q = search.toLowerCase().trim();
    const searched = q
      ? mainPool.filter(c => c.cv.name.toLowerCase().includes(q) || getText(c.cv).includes(q))
      : mainPool;

    const sorted = [...searched].sort((a, b) => {
      if (!aiActive) return 0;
      if (a.score < 0 && b.score < 0) return 0;
      if (a.score < 0) return 1; if (b.score < 0) return -1;
      return b.score - a.score;
    });

    const withData = sorted.filter(c => c.score >= 0);
    const avg = withData.length ? withData.reduce((s, c) => s + c.score, 0) / withData.length : 0;

    const toIndicator = (score: number): Indicator =>
      !aiActive || score < 0 ? 'neutral' : score >= avg ? 'above' : 'below';

    const scoredMain: ScoredCV[]     = sorted.map(c => ({ cv: c.cv, score: c.score, indicator: toIndicator(c.score) }));
    const scoredArchived: ScoredCV[] = archivedPool.map(c => ({ cv: c.cv, score: c.score, indicator: 'neutral' as Indicator }));

    return { scoredMain, scoredArchived, aboveCnt: scoredMain.filter(c => c.indicator === 'above').length, belowCnt: scoredMain.filter(c => c.indicator === 'below').length, avgScore: avg };
  }, [active, currentAiScores, aiActive, archivedIds, search, activeFilter, jdKeywords]);

  // Blind mode name mapping
  const blindNames = useMemo(() => {
    if (!active) return {};
    const map: Record<string, string> = {};
    active.candidates.forEach((cv, i) => {
      map[cv.id] = `Candidate ${String.fromCharCode(65 + i)}`; // A, B, C...
    });
    return map;
  }, [active]);

  // AI search result candidates (for display when aiSearchResults is set)
  const aiSearchDisplayList = useMemo<Array<{ cv: CV; result: AiSearchResult }>>(() => {
    if (!aiSearchResults || !active) return [];
    return aiSearchResults
      .map(r => { const cv = active.candidates.find(c => c.id === r.id); return cv ? { cv, result: r } : null; })
      .filter(Boolean) as Array<{ cv: CV; result: AiSearchResult }>;
  }, [aiSearchResults, active]);

  // Confidence sorted list (for panel)
  const confidenceList = useMemo(() =>
    Object.entries(currentAiScores)
      .map(([id, s]) => ({ id, ...s }))
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)),
    [currentAiScores]
  );
  const highConf   = confidenceList.filter(c => c.confidenceLevel === 'high').length;
  const medConf    = confidenceList.filter(c => c.confidenceLevel === 'medium').length;
  const lowConf    = confidenceList.filter(c => c.confidenceLevel === 'low').length;

  // ── Selection ─────────────────────────────────────────────────────────────────
  const toggleOne   = (id: string) => setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const allSelected = scoredMain.length > 0 && scoredMain.every(c => selected.has(c.cv.id));
  const toggleAll   = () => setSelected(allSelected ? new Set() : new Set(scoredMain.map(c => c.cv.id)));

  // ── Archive ───────────────────────────────────────────────────────────────────
  const archiveOne = useCallback((id: string) => {
    setArchivedIds(prev => { const s = new Set(prev); s.add(id); return s; });
    setSelected(prev => { const s = new Set(prev); s.delete(id); return s; });
  }, []);
  const restoreOne = useCallback((id: string) => setArchivedIds(prev => { const s = new Set(prev); s.delete(id); return s; }), []);
  const restoreAll = () => setArchivedIds(new Set());

  // ── Tooltip ───────────────────────────────────────────────────────────────────
  const hoveredCv      = useMemo(() => active?.candidates.find(c => c.id === hovered?.id) ?? null, [hovered, active]);
  const hoveredOrigIdx = useMemo(() => active?.candidates.findIndex(c => c.id === hovered?.id) ?? 0, [hovered, active]);
  const hoveredScored  = useMemo(() => scoredMain.find(c => c.cv.id === hovered?.id) ?? null, [hovered, scoredMain]);
  const hoveredAi      = hovered ? currentAiScores[hovered.id] : null;
  const tooltipStyle   = useMemo((): React.CSSProperties => {
    if (!hovered) return { display: 'none' };
    const { rect } = hovered;
    const W = 272;
    const left = (window.innerWidth - rect.right) > W + 14 ? rect.right + 10 : rect.left - W - 10;
    return { position: 'fixed', top: Math.min(rect.top, window.innerHeight - 320), left, width: W, zIndex: 200, pointerEvents: 'none' };
  }, [hovered]);

  // ── Card styling ──────────────────────────────────────────────────────────────
  const cardCls = (ind: Indicator, isSel: boolean) => {
    if (ind === 'above') return isSel ? 'border-emerald-400 bg-emerald-50/40 shadow-[0_0_0_2px_rgba(52,211,153,0.18)]' : 'border-emerald-200 bg-emerald-50/20 hover:border-emerald-400 hover:shadow-md';
    if (ind === 'below') return isSel ? 'border-red-400 bg-red-50/40 shadow-[0_0_0_2px_rgba(248,113,113,0.18)]'       : 'border-red-200 bg-red-50/20 hover:border-red-400 hover:shadow-md';
    return isSel ? 'border-gray-900 bg-gray-900/[0.04] shadow-md' : 'border-gray-200 bg-white hover:border-gray-400 hover:shadow-md';
  };
  const scoreBadgeCls = (ind: Indicator) =>
    ind === 'above' ? 'bg-emerald-100 text-emerald-700' : ind === 'below' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600';
  const dotCls = (ind: Indicator) =>
    ind === 'above' ? 'bg-emerald-400 shadow-[0_0_6px_2px_rgba(52,211,153,0.55)]' : ind === 'below' ? 'bg-red-400 shadow-[0_0_6px_2px_rgba(248,113,113,0.5)]' : 'bg-gray-200';

  // ── Empty state ───────────────────────────────────────────────────────────────
  if (projects.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-white border border-gray-200 shadow-sm flex items-center justify-center mb-5">
          <Briefcase className="w-7 h-7 text-gray-400" />
        </div>
        <h2 className="text-lg font-bold text-gray-900 mb-1">No job descriptions yet</h2>
        <p className="text-sm text-gray-400 max-w-xs mb-7">Create your first job project to begin talent analysis.</p>
        <button onClick={onNewJob} className="flex items-center gap-2 px-5 py-2.5 bg-black text-white rounded-xl text-sm font-bold hover:bg-gray-800 transition-all shadow-sm">
          <Plus className="w-4 h-4" /> Create First Job
        </button>
      </div>
    );
  }

  // ── Render card ────────────────────────────────────────────────────────────────
  function renderCard(cv: CV, indicator: Indicator, animIdx: number, opts: { showRelevance?: string } = {}) {
    const isSelected = selected.has(cv.id);
    const isExpanded = expandedIds.has(cv.id);
    const origIdx    = active!.candidates.findIndex(c => c.id === cv.id);
    const color      = blindMode ? 'bg-gray-300' : AVATAR_COLORS[origIdx % AVATAR_COLORS.length];
    const badge      = TYPE_BADGE[cv.type] ?? TYPE_BADGE.text;
    const BadgeIcon  = badge.icon;
    const aiScore    = currentAiScores[cv.id];
    const injection  = injectionMap.get(cv.id);
    const conf       = aiScore ? confidenceCls(aiScore.confidenceLevel) : null;

    return (
      <div
        key={cv.id}
        onClick={() => toggleOne(cv.id)}
        onMouseEnter={e => setHovered({ id: cv.id, rect: e.currentTarget.getBoundingClientRect() })}
        onMouseLeave={() => setHovered(null)}
        className={`relative flex flex-col items-center gap-1.5 p-3 rounded-2xl border-2 cursor-pointer select-none group transition-all ${cardCls(indicator, isSelected)}`}
        style={{
          ...(isExpanded ? {} : { aspectRatio: '4/5', minHeight: '130px' }),
          animation: 'cardSlideIn 0.32s ease-out both',
          animationDelay: `${Math.min(animIdx * 35, 400)}ms`,
        }}
      >
        {/* Indicator dot */}
        {aiActive && (
          <span className={`absolute top-2 left-2 w-2.5 h-2.5 rounded-sm transition-all ${dotCls(indicator)}`} />
        )}

        {/* Injection warning */}
        {injection && injection.riskLevel !== 'none' && !blindMode && (
          <button
            onClick={e => { e.stopPropagation(); setShowInjection(true); setShowConfidence(false); }}
            className={`absolute top-2 ${aiActive ? 'left-6' : 'left-2'} w-4 h-4 flex items-center justify-center rounded-full ${injection.riskLevel === 'high' ? 'bg-red-500' : injection.riskLevel === 'medium' ? 'bg-amber-500' : 'bg-gray-400'} shadow-sm`}
            title={`⚠ ${injection.riskLevel.toUpperCase()} risk: ${injection.flags.length} flag(s) detected`}>
            <AlertTriangle className="w-2.5 h-2.5 text-white" />
          </button>
        )}

        {/* Selection */}
        <div className={`absolute top-2 right-2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-gray-900 border-gray-900' : 'border-gray-300 bg-white opacity-0 group-hover:opacity-100'}`}>
          {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
        </div>

        {/* Avatar */}
        <div className={`w-11 h-11 rounded-full ${color} text-white flex items-center justify-center text-sm font-bold shrink-0 mt-2`}>
          {blindMode ? String.fromCharCode(65 + origIdx) : initials(cv.name)}
        </div>

        {/* Name */}
        <p className="text-[11px] font-semibold text-gray-800 text-center leading-tight line-clamp-2 w-full px-0.5">
          {blindMode ? blindNames[cv.id] : cv.name}
        </p>

        {/* Badges row */}
        <div className="flex items-center gap-1 flex-wrap justify-center">
          <span className={`flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase ${badge.bg} ${badge.text}`}>
            <BadgeIcon className="w-2.5 h-2.5" />{cv.type}
          </span>
          {aiScore && (
            <>
              <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full tabular-nums ${scoreBadgeCls(indicator)}`}>
                {aiScore.total}/100
              </span>
              <button onClick={e => { e.stopPropagation(); toggleExpand(cv.id); }}
                className="w-4 h-4 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all"
                title={isExpanded ? 'Collapse' : 'See score breakdown'}>
                <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
              </button>
            </>
          )}
        </div>

        {/* Confidence mini-badge */}
        {aiScore?.confidence != null && conf && (
          <button
            onClick={e => { e.stopPropagation(); setShowConfidence(true); setShowInjection(false); }}
            className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${conf.bg} ${conf.ring} transition-all hover:opacity-80`}
            title={`AI confidence: ${aiScore.confidenceReason}`}>
            <ShieldCheck className="w-2.5 h-2.5" /> {aiScore.confidence}%
          </button>
        )}

        {/* Spark point callout */}
        {showSparks && sparkPoints[cv.id] && (
          <div className="w-full flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50 border border-amber-200 mt-1">
            <Zap className="w-2.5 h-2.5 text-amber-500 shrink-0" />
            <p className="text-[9px] text-amber-800 leading-none truncate flex-1">{sparkPoints[cv.id]}</p>
            <button
              onClick={e => { e.stopPropagation(); setZoomedSpark({ name: cv.name, spark: sparkPoints[cv.id] }); }}
              className="w-3.5 h-3.5 flex items-center justify-center rounded text-amber-400 hover:text-amber-700 transition-colors shrink-0"
              title="Zoom in"
            >
              <Maximize2 className="w-2.5 h-2.5" />
            </button>
          </div>
        )}

        {/* AI relevance (search mode) */}
        {opts.showRelevance && (
          <p className="text-[8px] text-purple-600 italic text-center leading-tight line-clamp-3 mt-0.5 px-0.5">
            {opts.showRelevance}
          </p>
        )}

        {/* Score breakdown */}
        {isExpanded && aiScore && (
          <div className="w-full mt-1.5 pt-2 border-t border-gray-100 space-y-2" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[7px] font-bold uppercase tracking-widest text-gray-400">Breakdown</span>
              <button
                onClick={e => { e.stopPropagation(); setZoomedScore({ name: cv.name, colorClass: color, aiScore }); }}
                className="w-4 h-4 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all"
                title="Zoom in for full details"
              >
                <Maximize2 className="w-2.5 h-2.5" />
              </button>
            </div>
            {aiScore.breakdown.map(dim => <DimBar key={dim.label} dim={dim} />)}
            <div className="pt-1 border-t border-gray-100">
              <p className="text-[7.5px] text-gray-500 italic leading-tight">{aiScore.summary}</p>
            </div>
            {aiScore.confidence != null && (
              <div className={`rounded-lg p-1.5 ${conf?.bg ?? 'bg-gray-50'}`}>
                <p className={`text-[7.5px] font-semibold ${conf?.ring ?? 'text-gray-500'}`}>
                  🛡 {aiScore.confidenceLevel?.toUpperCase()} CONFIDENCE ({aiScore.confidence}%)
                </p>
                <p className="text-[7px] text-gray-500 mt-0.5 leading-tight">{aiScore.confidenceReason}</p>
              </div>
            )}
          </div>
        )}

        {/* Stage badge */}
        {(() => {
          const stage = getStage(cv.id);
          const sc = STAGE_CONFIG[stage];
          return (
            <div className="relative w-full" onClick={e => e.stopPropagation()}>
              <button
                onClick={e => { e.stopPropagation(); setOpenStageMenu(openStageMenu === cv.id ? null : cv.id); }}
                className={`w-full flex items-center justify-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold border ${sc.bg} ${sc.text} ${sc.border} transition-all hover:opacity-80`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${sc.dot} shrink-0`} />
                {sc.label}
              </button>
              {openStageMenu === cv.id && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 bg-white border border-gray-200 rounded-xl shadow-xl z-20 py-1.5 min-w-[160px]">
                  <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest px-3 pt-0.5 pb-1">Move to stage</p>
                  {STAGE_ORDER.map(stageNum => {
                    const cfg = STAGE_CONFIG[stageNum];
                    const isCurrent = stage === stageNum;
                    return (
                      <button
                        key={stageNum}
                        onClick={e => { e.stopPropagation(); setStage(cv.id, stageNum); }}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-[10px] font-medium transition-all ${
                          isCurrent ? `${cfg.bg} ${cfg.text} font-bold` : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
                        {cfg.label}
                        {isCurrent && <span className="ml-auto text-[9px] opacity-60">current</span>}
                      </button>
                    );
                  })}
                  <div className="border-t border-gray-100 mt-1 pt-1">
                    <button
                      onClick={e => { e.stopPropagation(); setOpenStageMenu(null); archiveOne(cv.id); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] font-medium text-orange-500 hover:bg-orange-50 transition-all"
                    >
                      <Archive className="w-3 h-3 shrink-0" />
                      Archive candidate
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    );
  }

  return (
    <>
      <style>{`
        @keyframes cardSlideIn { from{opacity:0;transform:translateY(10px) scale(0.96)} to{opacity:1;transform:none} }
        @keyframes slideInRight { from{opacity:0;transform:translateX(20px)} to{opacity:1;transform:none} }
        @keyframes archivedFadeIn { from{opacity:0;transform:translateY(-4px)} to{opacity:0.65;transform:none} }
      `}</style>

      <div className="flex-1 flex flex-col h-full overflow-hidden bg-gray-50/20">

        {/* ── JD Tab Bar ─────────────────────────────────────────────────── */}
        <div className="shrink-0 bg-white border-b border-gray-100 px-6 py-3 flex items-center gap-2 overflow-x-auto scrollbar-none">
          <span className="text-[10px] font-bold tracking-widest text-gray-400 uppercase mr-1 shrink-0">Jobs</span>
          {projects.map(p => (
            <button key={p.id} onClick={() => switchProject(p.id)}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all shrink-0 border ${
                activeId === p.id ? 'bg-gray-900 text-white border-gray-900 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400 hover:bg-gray-50'
              }`}>
              <Briefcase className="w-3 h-3 shrink-0" />
              <span className="max-w-[150px] truncate">{p.title}</span>
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${activeId === p.id ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>
                {p.candidates.length}
              </span>
            </button>
          ))}
          <button onClick={onNewJob}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold text-gray-400 border border-dashed border-gray-300 hover:border-gray-500 hover:text-gray-600 whitespace-nowrap shrink-0 transition-all ml-1">
            <Plus className="w-3.5 h-3.5" /> New Job
          </button>
        </div>

        {active && (
          <div className="flex-1 flex flex-col overflow-hidden relative">

            {/* ── Project meta ──────────────────────────────────────────── */}
            <div className="shrink-0 bg-white border-b border-gray-100">
              <div className="px-6 py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="font-bold text-gray-900 truncate">{active.title}</h2>
                  <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
                    <span>{active.candidates.length} candidate{active.candidates.length !== 1 ? 's' : ''}</span>
                    {active.description && <><span className="text-gray-200">·</span><span>JD attached</span></>}
                    {archivedIds.size > 0 && <><span className="text-gray-200">·</span><span className="text-orange-500">{archivedIds.size} archived</span></>}
                  </p>
                </div>
                <button
                  onClick={() => setActionsOpen(v => !v)}
                  title={actionsOpen ? 'Collapse actions' : 'Expand actions'}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-gray-800 transition-all shrink-0">
                  <SlidersHorizontal className="w-3 h-3" />
                  Actions
                  <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${actionsOpen ? 'rotate-180' : ''}`} />
                </button>
              </div>
              {/* Collapsible action buttons */}
              {actionsOpen && (
                <div className="px-6 pb-3 flex items-center gap-2 flex-wrap">
                  {/* Confidence — always visible */}
                  <button onClick={() => { setShowConfidence(v => !v); setShowInjection(false); }}
                    disabled={!aiActive}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                      showConfidence ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-600 border-gray-200 hover:bg-gray-50 hover:border-gray-300'
                    }`}
                    title={aiActive ? 'AI Confidence — understand the evidence behind each score' : 'Run an AI filter first to enable confidence view'}>
                    <ShieldCheck className="w-3.5 h-3.5" /> Confidence
                  </button>
                  {/* Security scan */}
                  {active.candidates.length > 0 && (
                    <button onClick={() => { setShowInjection(v => !v); setShowConfidence(false); }}
                      className={`relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                        clientInjScan.length > 0
                          ? 'text-red-600 border-red-200 bg-red-50 hover:bg-red-100'
                          : showInjection ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-600 border-gray-200 hover:bg-gray-50'
                      }`}
                      title="Security scan — detect prompt injection in CVs">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {clientInjScan.length > 0
                        ? <span>{clientInjScan.length} flag{clientInjScan.length !== 1 ? 's' : ''}</span>
                        : <span>Security</span>}
                    </button>
                  )}
                  {/* Clone Search */}
                  <button
                    onClick={() => { if (cloneMode) exitCloneMode(); else setCloneMode(true); }}
                    title="Talent Clone Search — find candidates similar to a reference"
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                      cloneMode
                        ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                        : 'text-gray-600 border-gray-200 hover:border-violet-400 hover:text-violet-700 hover:bg-violet-50'
                    }`}>
                    <Fingerprint className="w-3.5 h-3.5" />
                    Clone Search
                  </button>
                  {/* Report Generator */}
                  {active.candidates.length > 0 && (
                    <button
                      onClick={() => setShowReport(true)}
                      title="Generate a comprehensive Hiring Manager Report"
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all text-gray-600 border-gray-200 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50">
                      <ClipboardList className="w-3.5 h-3.5" />
                      Report
                    </button>
                  )}
                  {/* Team Formation Intelligence */}
                  {active.candidates.length > 0 && (
                    <button
                      onClick={() => setShowTeam(true)}
                      title="Analyse department fit and team formation potential"
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all text-gray-600 border-gray-200 hover:border-emerald-400 hover:text-emerald-700 hover:bg-emerald-50">
                      <Users className="w-3.5 h-3.5" />
                      Team
                    </button>
                  )}
                  {/* Blind Review Mode */}
                  <button
                    onClick={() => setBlindMode(v => !v)}
                    title="Blind Review Mode — hide candidate names for unbiased screening"
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                      blindMode ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-600 border-gray-200 hover:border-gray-400 hover:bg-gray-50'
                    }`}
                  >
                    {blindMode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {blindMode ? 'Blind On' : 'Blind'}
                  </button>
                  {/* JD Bias Audit */}
                  {active?.description?.trim() && (
                    <button
                      onClick={runBiasAudit}
                      disabled={biasLoading}
                      title="Scan job description for bias patterns (gender, age, exclusionary language)"
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                        biasResult ? (biasResult.overallRisk === 'high' ? 'text-red-600 border-red-200 bg-red-50' : biasResult.overallRisk === 'moderate' ? 'text-amber-600 border-amber-200 bg-amber-50' : 'text-emerald-600 border-emerald-200 bg-emerald-50')
                        : 'text-gray-600 border-gray-200 hover:border-rose-400 hover:text-rose-700 hover:bg-rose-50'
                      } disabled:opacity-50`}
                    >
                      {biasLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertCircle className="w-3.5 h-3.5" />}
                      {biasLoading ? 'Auditing…' : biasResult ? `Bias: ${biasResult.overallRisk}` : 'JD Audit'}
                    </button>
                  )}
                  {/* Email Shortlist */}
                  {active.candidates.length > 0 && (
                    <button
                      onClick={() => aiActive && setShowEmail(true)}
                      disabled={!aiActive}
                      title={aiActive ? 'Generate recruiter email shortlist for hiring manager' : 'Run AI scoring first to enable email shortlist'}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all disabled:opacity-40 disabled:cursor-not-allowed text-gray-600 border-gray-200 hover:border-blue-400 hover:text-blue-700 hover:bg-blue-50 disabled:hover:border-gray-200 disabled:hover:text-gray-600 disabled:hover:bg-transparent"
                    >
                      <Mail className="w-3.5 h-3.5" />
                      Email Shortlist
                    </button>
                  )}
                  {/* Spark Points */}
                  {active.candidates.length > 0 && (
                    <button
                      onClick={handleSparks}
                      disabled={sparkLoading}
                      title="Generate one-sentence spark point for each candidate — their biggest unique quality at a glance"
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all disabled:opacity-50 ${
                        showSparks
                          ? 'text-amber-700 border-amber-300 bg-amber-50'
                          : 'text-gray-600 border-gray-200 hover:border-amber-400 hover:text-amber-700 hover:bg-amber-50'
                      }`}
                    >
                      {sparkLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                      {sparkLoading ? 'Sparking…' : showSparks ? 'Hide Sparks' : 'Spark'}
                    </button>
                  )}
                  <div className="flex-1" />
                  <button onClick={() => onAddCandidates(active.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-all">
                    <UserPlus className="w-3.5 h-3.5" /> Add
                  </button>
                  <button onClick={() => onEditProject(active.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-all">
                    <Pencil className="w-3.5 h-3.5" /> Edit JD
                  </button>
                </div>
              )}
            </div>

            {/* Error banner */}
            {scoringError && (
              <div className="shrink-0 mx-6 mt-3 flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                <p className="text-xs text-red-600 flex-1">{scoringError}</p>
                <button onClick={() => setScoringError(null)} className="text-red-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
              </div>
            )}

            {active.candidates.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-10">
                <Users className="w-9 h-9 text-gray-200 mb-4" />
                <p className="text-sm font-semibold text-gray-700 mb-1">No candidates yet</p>
                <p className="text-xs text-gray-400 mb-5">Add candidates to begin analysis.</p>
                <button onClick={() => onAddCandidates(active.id)}
                  className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-lg text-xs font-bold hover:bg-gray-800 transition-all">
                  <Plus className="w-3.5 h-3.5" /> Add Candidates
                </button>
              </div>
            ) : (
              <>
                {/* ── Search + Filter ──────────────────────────────────── */}
                <div className="shrink-0 bg-white border-b border-gray-100 px-6 py-3 space-y-2.5">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                    <input type="text" value={search} onChange={e => { setSearch(e.target.value); setAiSearchResults(null); }}
                      placeholder="Search by name, skill, keyword, or any CV content…"
                      className="w-full pl-9 pr-8 py-2 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:border-gray-400 focus:bg-white outline-none transition-all" />
                    {search && (
                      <button onClick={() => { setSearch(''); setAiSearchResults(null); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* Clone Search — reference picker */}
                  {cloneMode && !cloneRefId && (
                    <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3">
                      <p className="text-[11px] font-semibold text-violet-700 mb-2">Select a reference candidate to clone:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {active.candidates.filter(c => !archivedIds.has(c.id)).map((cv, i) => (
                          <button key={cv.id} onClick={() => handleCloneSearch(cv.id)}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-violet-200 hover:border-violet-500 hover:bg-violet-50 text-[11px] font-medium text-gray-700 transition-all">
                            <span className={`w-4 h-4 rounded-full ${AVATAR_COLORS[i % AVATAR_COLORS.length]} text-white text-[8px] font-bold flex items-center justify-center shrink-0`}>
                              {cv.name.charAt(0).toUpperCase()}
                            </span>
                            {cv.name.split(' ')[0]}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Filter chips */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <SlidersHorizontal className="w-3 h-3 text-gray-300 shrink-0" />
                    {FILTERS.map(f => {
                      const isActive  = activeFilter === f.key;
                      const isLoading = scoringFilter === f.key;
                      const isScored  = !!filterScores[f.key] && !isLoading;
                      const hasInj    = active.candidates.some(c => injectionMap.has(c.id) && (injectionMap.get(c.id)?.riskLevel !== 'none'));
                      const Icon      = isLoading ? Loader2 : f.icon;
                      return (
                        <button key={f.key} onClick={() => changeFilter(f.key)} title={f.label}
                          disabled={!!scoringFilter && !isActive}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all border disabled:opacity-50 ${
                            isLoading
                              ? 'bg-purple-600 text-white border-purple-600 shadow-sm'
                              : isActive && isScored
                                ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                                : isActive
                                  ? 'bg-gray-900 text-white border-gray-900 shadow-sm'
                                  : isScored
                                    ? 'bg-violet-50 text-violet-700 border-violet-300 hover:border-violet-500'
                                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400 hover:text-gray-800'
                          }`}>
                          <Icon className={`w-2.5 h-2.5 shrink-0 ${isLoading ? 'animate-spin' : ''}`} />
                          {f.short}
                          {isScored && !isLoading && <span className="w-1.5 h-1.5 rounded-full bg-violet-400 opacity-80 ml-0.5 shrink-0" />}
                          {isLoading && <span className="text-[9px] ml-0.5 opacity-80">…</span>}
                        </button>
                      );
                    })}
                    {(activeFilter !== 'all' || search) && !scoringFilter && (
                      <button onClick={() => { changeFilter('all'); setSearch(''); setAiSearchResults(null); }}
                        className="ml-auto flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-700 transition-colors">
                        <RotateCcw className="w-3 h-3" /> Reset
                      </button>
                    )}
                  </div>

                  {/* Stage pipeline filter */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mr-0.5">Pipeline</span>
                    <button
                      onClick={() => setStageFilter(null)}
                      className={`px-2.5 py-1 text-[10px] font-semibold rounded-full border transition-all ${stageFilter === null ? 'bg-gray-800 text-white border-gray-800' : 'text-gray-400 border-gray-200 hover:border-gray-400 hover:text-gray-600'}`}
                    >All</button>
                    {STAGE_ORDER.map(stageNum => {
                      const cfg = STAGE_CONFIG[stageNum];
                      const count = active?.candidates.filter(c => getStage(c.id) === stageNum).length ?? 0;
                      const isActive = stageFilter === stageNum;
                      return (
                        <button
                          key={stageNum}
                          onClick={() => setStageFilter(isActive ? null : stageNum)}
                          className={`flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold rounded-full border transition-all ${
                            isActive ? `${cfg.bg} ${cfg.text} ${cfg.border} shadow-sm` : 'text-gray-400 border-gray-200 hover:border-gray-400 hover:text-gray-600'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? cfg.dot : 'bg-gray-300'}`} />
                          {cfg.label}
                          {count > 0 && <span className={`ml-0.5 ${isActive ? 'opacity-70' : 'text-gray-400'}`}>·{count}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* ── Stats row ─────────────────────────────────────────── */}
                <div className="shrink-0 px-6 py-2 bg-gray-50/50 border-b border-gray-100 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 text-[11px] text-gray-400 flex-wrap">
                    <span>
                      <span className="font-semibold text-gray-700">{aiSearchResults ? aiSearchDisplayList.length : scoredMain.length}</span>
                      {' '}candidate{(aiSearchResults ? aiSearchDisplayList.length : scoredMain.length) !== 1 ? 's' : ''}
                      {aiSearchResults && <span className="text-purple-600 font-medium"> · AI search results</span>}
                      {!aiSearchResults && search && ` matching "${search}"`}
                    </span>
                    {aiActive && aboveCnt + belowCnt > 0 && !aiSearchResults && (
                      <>
                        <span className="text-gray-200">·</span>
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-sm bg-emerald-400 inline-block" />
                          <span className="font-semibold text-emerald-600">{aboveCnt}</span> above
                          <span className="text-gray-300">({Math.round(avgScore)}/100 avg)</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-sm bg-red-400 inline-block" />
                          <span className="font-semibold text-red-500">{belowCnt}</span> below
                        </span>
                      </>
                    )}
                    {scoringFilter && (
                      <span className="flex items-center gap-1 text-purple-600">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        AI scoring {FILTERS.find(f => f.key === scoringFilter)?.label}…
                      </span>
                    )}
                    {aiActive && !scoringFilter && !aiSearchResults && <span className="text-gray-400">· ranked by AI</span>}
                  </div>
                  {!aiSearchResults && (
                    <button onClick={toggleAll}
                      className="flex items-center gap-1.5 text-[11px] font-medium text-gray-400 hover:text-gray-800 transition-colors shrink-0">
                      <div className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center transition-all ${allSelected ? 'bg-gray-900 border-gray-900' : 'border-gray-300'}`}>
                        {allSelected && <Check className="w-2 h-2 text-white" />}
                      </div>
                      {allSelected ? 'Deselect all' : 'Select all'}
                    </button>
                  )}
                </div>

                {/* ── Candidate grid ─────────────────────────────────────── */}
                <div className="flex-1 overflow-y-auto px-6 pt-5 pb-4 relative"
                  style={{ transition: 'opacity 190ms ease, transform 190ms ease', opacity: gridVisible ? 1 : 0, transform: gridVisible ? 'none' : 'translateY(8px)' }}>

                  {/* ── Clone Search results ─────────────────────────────── */}
                  {cloneMode && cloneRefId && (() => {
                    const refCv = active.candidates.find(c => c.id === cloneRefId);
                    const recColor = (r: string) =>
                      r === 'Strongly Recommended' ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                      : r === 'Recommended'        ? 'bg-blue-100 text-blue-700 border-blue-200'
                      : r === 'Worth Reviewing'    ? 'bg-amber-100 text-amber-700 border-amber-200'
                      :                             'bg-red-100 text-red-600 border-red-200';
                    const riskColor = (r: string) =>
                      r === 'Low' ? 'text-emerald-600' : r === 'Medium' ? 'text-amber-600' : 'text-red-600';
                    const scoreColor = (v: number) =>
                      v >= 70 ? 'bg-emerald-400' : v >= 45 ? 'bg-amber-400' : 'bg-red-400';
                    return (
                      <div>
                        {/* Banner */}
                        <div className="flex items-center gap-2 mb-4 bg-violet-50 border border-violet-200 rounded-xl px-4 py-2.5">
                          <Fingerprint className="w-4 h-4 text-violet-500 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-semibold text-violet-800">Clone Target: </span>
                            <span className="text-xs text-violet-700">{refCv?.name}</span>
                            {cloneResults && <span className="text-xs text-violet-500 ml-2">· {cloneResults.length} candidates ranked</span>}
                          </div>
                          {cloneLoading && <Loader2 className="w-3.5 h-3.5 text-violet-500 animate-spin shrink-0" />}
                          <button onClick={exitCloneMode} className="text-violet-400 hover:text-violet-700 shrink-0"><X className="w-3.5 h-3.5" /></button>
                        </div>

                        {cloneLoading && (
                          <div className="text-center py-14 text-violet-400 text-sm flex flex-col items-center gap-2">
                            <Loader2 className="w-6 h-6 animate-spin" />
                            <span>Analysing candidates…</span>
                          </div>
                        )}
                        {cloneError && (
                          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-700">
                            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{cloneError}
                          </div>
                        )}
                        {cloneResults && (
                          <div className="space-y-3">
                            {cloneResults.map((r, idx) => {
                              const cv = active.candidates.find(c => c.id === r.id);
                              if (!cv) return null;
                              const origIdx = active.candidates.findIndex(c => c.id === r.id);
                              const expanded = cloneExpanded.has(r.id);
                              const dimLabels = [
                                { key: 'skills', label: 'Skills' },
                                { key: 'experience', label: 'Experience' },
                                { key: 'learning', label: 'Learning' },
                                { key: 'leadership', label: 'Leadership' },
                                { key: 'communication', label: 'Comms' },
                                { key: 'education', label: 'Education' },
                              ] as const;
                              return (
                                <div key={r.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden hover:border-violet-300 hover:shadow-md transition-all">
                                  {/* Card header */}
                                  <div className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                                    onClick={() => setCloneExpanded(prev => { const s = new Set(prev); s.has(r.id) ? s.delete(r.id) : s.add(r.id); return s; })}>
                                    {/* Rank + avatar */}
                                    <span className="text-[10px] font-black text-gray-300 w-4 text-center shrink-0">#{idx + 1}</span>
                                    <div className={`w-8 h-8 rounded-full ${AVATAR_COLORS[origIdx % AVATAR_COLORS.length]} text-white text-xs font-bold flex items-center justify-center shrink-0`}>
                                      {initials(cv.name)}
                                    </div>
                                    {/* Name + rec */}
                                    <div className="min-w-0 flex-1">
                                      <p className="text-sm font-bold text-gray-900 leading-tight truncate">{cv.name}</p>
                                      <span className={`inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded-full border mt-0.5 ${recColor(r.recommendation)}`}>
                                        {r.recommendation}
                                      </span>
                                    </div>
                                    {/* Overall % */}
                                    <div className="text-right shrink-0">
                                      <div className="text-2xl font-black tabular-nums text-violet-700 leading-none">{r.overall}<span className="text-sm font-bold text-violet-400">%</span></div>
                                      <div className="text-[9px] text-gray-400 mt-0.5">similarity</div>
                                    </div>
                                    {/* Risk */}
                                    <div className={`text-[10px] font-bold shrink-0 w-14 text-right ${riskColor(r.riskLevel)}`}>
                                      {r.riskLevel} risk
                                    </div>
                                    <div className="text-gray-300 shrink-0">
                                      {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                    </div>
                                  </div>

                                  {/* Score bars */}
                                  <div className="px-4 pb-3 grid grid-cols-6 gap-1.5">
                                    {dimLabels.map(({ key, label }) => (
                                      <div key={key} className="text-center">
                                        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden mb-1">
                                          <div className={`h-full rounded-full ${scoreColor(r.scores[key])}`} style={{ width: `${r.scores[key]}%` }} />
                                        </div>
                                        <div className="text-[8px] text-gray-400 leading-none">{label}</div>
                                        <div className="text-[9px] font-bold text-gray-600 tabular-nums">{r.scores[key]}</div>
                                      </div>
                                    ))}
                                  </div>

                                  {/* Expanded detail */}
                                  {expanded && (
                                    <div className="border-t border-gray-100 px-4 py-3 space-y-3 bg-gray-50/50">
                                      {r.whyRecommended.length > 0 && (
                                        <div>
                                          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Why AI Recommended</p>
                                          {r.whyRecommended.map((w, i) => (
                                            <p key={i} className="text-[11px] text-gray-700 flex items-start gap-1.5"><span className="text-emerald-500 shrink-0">✓</span>{w}</p>
                                          ))}
                                        </div>
                                      )}
                                      {r.keyDifferences.length > 0 && (
                                        <div>
                                          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Key Differences</p>
                                          {r.keyDifferences.map((d, i) => (
                                            <p key={i} className="text-[11px] text-gray-600 flex items-start gap-1.5"><span className="text-gray-400 shrink-0">·</span>{d}</p>
                                          ))}
                                        </div>
                                      )}
                                      {r.advantages.length > 0 && (
                                        <div>
                                          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Potential Advantages</p>
                                          {r.advantages.map((a, i) => (
                                            <p key={i} className="text-[11px] text-blue-700 flex items-start gap-1.5"><span className="shrink-0">↑</span>{a}</p>
                                          ))}
                                        </div>
                                      )}
                                      {r.hiddenPotential && (
                                        <div>
                                          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Hidden Potential</p>
                                          <p className="text-[11px] text-violet-700 italic">{r.hiddenPotential}</p>
                                        </div>
                                      )}
                                      {r.riskEvidence.length > 0 && (
                                        <div>
                                          <p className={`text-[10px] font-bold uppercase tracking-wide mb-1 ${riskColor(r.riskLevel)}`}>Risk — {r.riskLevel}</p>
                                          {r.riskEvidence.map((e, i) => (
                                            <p key={i} className="text-[11px] text-gray-600 flex items-start gap-1.5"><span className="text-amber-500 shrink-0">⚠</span>{e}</p>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Scoring overlay */}
                  {!cloneMode && scoringFilter && scoringFilter === activeFilter && (
                    <div className="absolute inset-0 bg-white/75 backdrop-blur-[1px] flex items-center justify-center z-10 rounded-lg">
                      <div className="flex items-center gap-2.5 bg-white border border-purple-200 shadow-lg rounded-xl px-5 py-3">
                        <Loader2 className="w-4 h-4 animate-spin text-purple-500" />
                        <div>
                          <p className="text-sm font-semibold text-gray-800">Scoring {FILTERS.find(f => f.key === scoringFilter)?.label}</p>
                          <p className="text-[10px] text-purple-500 mt-0.5">Analysing {active.candidates.length} candidates…</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* AI search results */}
                  {!cloneMode && aiSearchResults && (
                    <>
                      <div className="flex items-center gap-2 mb-4 bg-purple-50 border border-purple-100 rounded-xl px-4 py-2.5">
                        <Sparkles className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                        <p className="text-xs text-purple-700 flex-1">
                          <span className="font-semibold">AI found {aiSearchDisplayList.length} candidate{aiSearchDisplayList.length !== 1 ? 's' : ''}</span> semantically related to "{search}"
                        </p>
                        <button onClick={() => setAiSearchResults(null)} className="text-purple-400 hover:text-purple-700 shrink-0">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {aiSearchDisplayList.length === 0 ? (
                        <div className="text-center py-12 text-gray-400 text-sm">No relevant candidates found by AI.</div>
                      ) : (
                        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${aiActive ? '175px' : '118px'}, 1fr))` }}>
                          {aiSearchDisplayList.map((item, idx) =>
                            renderCard(item.cv, currentAiScores[item.cv.id] ? (currentAiScores[item.cv.id].total >= avgScore ? 'above' : 'below') : 'neutral', idx, { showRelevance: item.result.relevance })
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {/* Normal grid or no-results */}
                  {!cloneMode && !aiSearchResults && (
                    scoredMain.filter(({ cv }) => stageFilter === null || getStage(cv.id) === stageFilter).length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-14 text-center">
                        <Search className="w-9 h-9 text-gray-200 mb-3" />
                        <p className="text-sm font-medium text-gray-500 mb-1">
                          {stageFilter !== null ? `No candidates in "${STAGE_CONFIG[stageFilter].label}" stage` : `No candidates match "${search}"`}
                        </p>
                        {search.trim() && stageFilter === null && (
                          <>
                            <p className="text-xs text-gray-400 mb-5 max-w-xs leading-relaxed">
                              AI search can find <span className="font-medium text-gray-600">semantically related</span> candidates — e.g. searching "python" may surface candidates with "data science" or "automation" experience
                            </p>
                            {aiSearchError && (
                              <p className="text-xs text-red-500 mb-3">{aiSearchError}</p>
                            )}
                            <button onClick={handleAiSearch} disabled={aiSearching}
                              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-xl text-xs font-bold hover:bg-purple-700 disabled:opacity-60 transition-all shadow-sm">
                              {aiSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                              {aiSearching ? 'Searching…' : 'Search with AI'}
                            </button>
                          </>
                        )}
                        {!search.trim() && stageFilter === null && <button onClick={() => setSearch('')} className="text-xs text-blue-500 hover:underline mt-2">Clear search</button>}
                        {stageFilter !== null && (
                          <button onClick={() => setStageFilter(null)} className="text-xs text-blue-500 hover:underline mt-2">Show all stages</button>
                        )}
                      </div>
                    ) : (
                      <div key={animKey} className="grid gap-3"
                        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${aiActive ? '175px' : '118px'}, 1fr))` }}>
                        {scoredMain
                          .filter(({ cv }) => stageFilter === null || getStage(cv.id) === stageFilter)
                          .map((item, idx) => renderCard(item.cv, item.indicator, idx))}
                      </div>
                    )
                  )}

                  {/* Archived section */}
                  {!cloneMode && scoredArchived.length > 0 && !aiSearchResults && (
                    <div className="mt-6 pt-5 border-t border-gray-100">
                      <button onClick={() => setShowArchived(v => !v)}
                        className="flex items-center gap-2 text-xs font-medium text-gray-400 hover:text-gray-700 transition-colors w-full">
                        <Archive className="w-3.5 h-3.5" />
                        <span>Archived ({scoredArchived.length})</span>
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showArchived ? 'rotate-180' : ''}`} />
                        <span onClick={e => { e.stopPropagation(); restoreAll(); }}
                          className="ml-auto text-[10px] text-blue-500 hover:text-blue-700 cursor-pointer">Restore all</span>
                      </button>
                      {showArchived && (
                        <div className="mt-3 space-y-1.5">
                          {scoredArchived.map((item, idx) => {
                            const oIdx = active.candidates.findIndex(c => c.id === item.cv.id);
                            return (
                              <div key={item.cv.id} className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl px-3 py-2.5"
                                style={{ animation: 'archivedFadeIn 0.25s ease-out both', animationDelay: `${idx * 30}ms` }}>
                                <div className={`w-7 h-7 rounded-full ${AVATAR_COLORS[oIdx % AVATAR_COLORS.length]} text-white flex items-center justify-center text-[10px] font-bold shrink-0`}>
                                  {initials(item.cv.name)}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-gray-600 truncate">{item.cv.name}</p>
                                  <p className="text-[10px] text-gray-400 capitalize">{item.cv.type}</p>
                                </div>
                                <button onClick={() => restoreOne(item.cv.id)}
                                  className="ml-auto flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-700 font-medium shrink-0">
                                  <RotateCcw className="w-3 h-3" /> Restore
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Bottom action bar ──────────────────────────────────── */}
                <div className="shrink-0 bg-white border-t border-gray-200">
                  {/* Bulk stage bar — appears when 2+ selected */}
                  {selected.size >= 2 && (
                    <div className="px-6 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center gap-3 flex-wrap">
                      <span className="text-[11px] font-bold text-gray-700 shrink-0">
                        Move {selected.size} selected →
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {STAGE_ORDER.map(stageNum => {
                          const cfg = STAGE_CONFIG[stageNum];
                          return (
                            <button
                              key={stageNum}
                              onClick={() => bulkMoveToStage(stageNum)}
                              className={`flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold rounded-full border transition-all ${cfg.bg} ${cfg.text} ${cfg.border} hover:shadow-sm active:scale-95`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
                              {cfg.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="px-6 py-4 flex items-center justify-between">
                    <p className="text-sm text-gray-500">
                      {selected.size === 0
                        ? <span className="text-gray-400 text-xs">Select candidates then run analysis</span>
                        : <><span className="font-bold text-gray-900">{selected.size}</span> candidate{selected.size !== 1 ? 's' : ''} selected</>}
                    </p>
                    <button onClick={() => selected.size > 0 && onRunAnalysis(active.id, [...selected], filterScores as Record<string, Record<string, any>>, activeFilter)}
                      disabled={selected.size === 0}
                      className="flex items-center gap-2 px-5 py-2.5 bg-black text-white rounded-xl text-sm font-bold hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md active:scale-[0.99]">
                      Run TalentGPT Analysis <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* ── Confidence panel ───────────────────────────────────────── */}
            {showConfidence && aiActive && (
              <div className="absolute inset-y-0 right-0 w-80 bg-white border-l border-gray-200 shadow-2xl flex flex-col z-30"
                style={{ animation: 'slideInRight 0.2s ease-out' }}>
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
                  <div>
                    <h3 className="font-bold text-gray-900 text-sm flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-gray-500" /> AI Confidence Report
                    </h3>
                    <p className="text-[10px] text-gray-400 mt-0.5">Understand the evidence behind each score</p>
                  </div>
                  <button onClick={() => setShowConfidence(false)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
                </div>

                {/* Summary stats */}
                <div className="px-4 py-2.5 border-b border-gray-100 shrink-0 flex gap-2">
                  {[{ label: 'High', count: highConf, cls: 'bg-emerald-50 text-emerald-700' }, { label: 'Medium', count: medConf, cls: 'bg-amber-50 text-amber-700' }, { label: 'Low', count: lowConf, cls: 'bg-red-50 text-red-600' }].map(({ label, count, cls }) => (
                    <div key={label} className={`flex-1 rounded-lg px-2 py-1.5 text-center ${cls}`}>
                      <p className="text-base font-black leading-none">{count}</p>
                      <p className="text-[9px] font-semibold mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>
                <p className="px-4 pt-2.5 text-[10px] text-gray-400 italic shrink-0">High confidence → you can trust the score. Low confidence → treat as a starting point only.</p>

                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                  {confidenceList.map(s => {
                    const cv = active.candidates.find(c => c.id === s.id);
                    if (!cv) return null;
                    const cls = confidenceCls(s.confidenceLevel);
                    const oIdx = active.candidates.findIndex(c => c.id === s.id);
                    return (
                      <div key={s.id} className="border border-gray-100 rounded-xl p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <div className={`w-7 h-7 rounded-full ${AVATAR_COLORS[oIdx % AVATAR_COLORS.length]} text-white text-[10px] font-bold flex items-center justify-center shrink-0`}>
                            {initials(cv.name)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-gray-800 truncate">{cv.name}</p>
                            <p className="text-[10px] text-gray-400">{s.total}/100 · {FILTERS.find(f => f.key === activeFilter)?.short}</p>
                          </div>
                          <div className={`text-right shrink-0`}>
                            <p className={`text-lg font-black leading-none ${cls.ring}`}>{s.confidence ?? '—'}%</p>
                            <p className={`text-[9px] font-bold uppercase ${cls.ring}`}>{s.confidenceLevel ?? 'n/a'}</p>
                          </div>
                        </div>
                        {/* Confidence bar */}
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${cls.bar}`} style={{ width: `${s.confidence ?? 0}%` }} />
                        </div>
                        {s.confidenceReason && <p className="text-[10px] text-gray-500 leading-snug italic">{s.confidenceReason}</p>}
                        {/* Flags */}
                        {s.confidenceFlags && s.confidenceFlags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {s.confidenceFlags.map(flag => {
                              const meta = CONFIDENCE_FLAG_LABELS[flag];
                              if (!meta) return null;
                              return (
                                <span key={flag} className={`text-[8px] px-1.5 py-0.5 rounded-full font-semibold ${meta.positive ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>
                                  {meta.positive ? '✓' : '⚠'} {meta.label}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Injection panel ────────────────────────────────────────── */}
            {showInjection && (
              <div className="absolute inset-y-0 right-0 w-[340px] bg-white border-l border-gray-200 shadow-2xl flex flex-col z-30"
                style={{ animation: 'slideInRight 0.2s ease-out' }}>
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
                  <div>
                    <h3 className="font-bold text-gray-900 text-sm flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-amber-500" /> Security Audit
                    </h3>
                    <p className="text-[10px] text-gray-400 mt-0.5">Candidate Resume Security Policy · prompt injection detection</p>
                  </div>
                  <button onClick={() => setShowInjection(false)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
                </div>

                {/* Status + deep scan */}
                <div className="px-4 py-2.5 border-b border-gray-100 shrink-0 flex items-center justify-between gap-2">
                  <div className="text-[10px] space-y-0.5">
                    <p className={injectionResults.length > 0 ? 'text-red-600 font-bold' : 'text-emerald-600 font-bold'}>
                      Injection Detected: {injectionResults.length > 0 ? `Yes (${injectionResults.length} candidate${injectionResults.length !== 1 ? 's' : ''})` : 'No'}
                    </p>
                    <p className="text-gray-400">
                      {scoringInjScan.length > 0 && `${scoringInjScan.length} via scoring · `}
                      {clientInjScan.filter(c => !scoringInjScan.some(s => s.cvId === c.cvId)).length > 0 && `${clientInjScan.filter(c => !scoringInjScan.some(s => s.cvId === c.cvId)).length} via pattern · `}
                      {injAiScanned ? '✓ AI deep scan' : 'pattern scan active'}
                    </p>
                  </div>
                  <button onClick={handleInjDeepScan} disabled={injAiLoading}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-all whitespace-nowrap shrink-0">
                    {injAiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    {injAiLoading ? 'Scanning…' : 'AI Deep Scan'}
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                  {injectionResults.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-12">
                      <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center">
                        <ShieldCheck className="w-6 h-6 text-emerald-500" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-800">All Clear</p>
                        <p className="text-[11px] text-gray-400 mt-1 max-w-[220px] mx-auto">No prompt injection patterns detected in any candidate CV.</p>
                        {!injAiScanned && <p className="text-[10px] text-gray-400 mt-3 italic">Run AI Deep Scan for a thorough semantic analysis.</p>}
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-[10px] text-gray-400 italic px-0.5">
                        All flagged instructions were ignored. Scores reflect legitimate qualifications only.
                      </p>
                      {injectionResults.map(result => {
                        const cv   = active.candidates.find(c => c.id === result.cvId);
                        const oIdx = active.candidates.findIndex(c => c.id === result.cvId);
                        const riskColors = {
                          high:   { header: 'bg-red-50 border-red-200',    badge: 'bg-red-100 text-red-700 border-red-200',       dot: 'bg-red-500'    },
                          medium: { header: 'bg-amber-50 border-amber-200', badge: 'bg-amber-100 text-amber-700 border-amber-200', dot: 'bg-amber-500'  },
                          low:    { header: 'bg-gray-50 border-gray-200',   badge: 'bg-gray-100 text-gray-600 border-gray-200',    dot: 'bg-gray-400'   },
                          none:   { header: 'bg-gray-50 border-gray-200',   badge: 'bg-gray-100 text-gray-500 border-gray-200',    dot: 'bg-gray-300'   },
                        }[result.riskLevel];
                        const sourceLabel = result.source === 'ai-scan' ? 'AI Deep Scan' : result.source === 'scoring' ? 'Detected during scoring' : 'Pattern scan';
                        return (
                          <div key={result.cvId} className={`border rounded-xl overflow-hidden ${riskColors.header}`}>
                            <div className="px-3 py-2 flex items-center gap-2">
                              <div className={`w-6 h-6 rounded-full ${AVATAR_COLORS[oIdx % AVATAR_COLORS.length]} text-white text-[9px] font-bold flex items-center justify-center shrink-0`}>
                                {initials(cv?.name ?? '?')}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-bold text-gray-900 truncate">{cv?.name ?? result.name}</p>
                                <p className="text-[9px] text-gray-400">{sourceLabel}</p>
                              </div>
                              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide ${riskColors.badge}`}>
                                {result.riskLevel} risk
                              </span>
                            </div>
                            <div className="border-t border-inherit px-3 py-2.5 bg-white space-y-2">
                              <p className="text-[10px] font-bold text-gray-700 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" /> ⚠️ Security Alert · Injection Detected: Yes
                              </p>
                              {result.flags.map((flag, i) => (
                                <div key={i} className="bg-gray-50 rounded-lg p-2 space-y-1.5 border border-gray-100 text-[9px]">
                                  <div className="flex items-center justify-between">
                                    <span className="font-semibold text-gray-500 uppercase tracking-wide">Risk Level</span>
                                    <span className={`font-bold px-1.5 py-0.5 rounded-full border ${riskColors.badge}`}>{flag.severity.toUpperCase()}</span>
                                  </div>
                                  <div className="flex gap-1.5">
                                    <span className="font-semibold text-gray-500 uppercase tracking-wide shrink-0">Type</span>
                                    <span className="text-gray-700 font-medium">{flag.type}</span>
                                  </div>
                                  <div className="flex gap-1.5">
                                    <span className="font-semibold text-gray-500 uppercase tracking-wide shrink-0">Detail</span>
                                    <span className="text-gray-600 leading-snug">{flag.description}</span>
                                  </div>
                                  {(flag.detectedText || flag.snippet) && (
                                    <div>
                                      <p className="font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Detected Text</p>
                                      <p className="text-red-600 italic font-mono leading-snug break-all bg-red-50 rounded px-1.5 py-1 border border-red-100">
                                        {flag.detectedText || flag.snippet}
                                      </p>
                                    </div>
                                  )}
                                  <p className="text-emerald-600 font-medium pt-0.5">
                                    ✓ Action: Ignored instruction · continued standard evaluation
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>

                <div className="shrink-0 px-4 py-2.5 border-t border-gray-100 bg-gray-50/80">
                  <p className="text-[9px] text-gray-400 leading-snug">
                    <span className="font-semibold text-gray-500">Candidate Resume Security Policy</span> — all candidate content is untrusted. Scores are based solely on legitimate professional qualifications.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Hover tooltip ─────────────────────────────────────────────── */}
        {hoveredCv && (
          <div style={tooltipStyle} className="bg-white rounded-2xl border border-gray-200 shadow-2xl p-4 overflow-hidden">
            <div className="flex items-center gap-2.5 mb-3">
              <div className={`w-9 h-9 rounded-full ${AVATAR_COLORS[hoveredOrigIdx % AVATAR_COLORS.length]} text-white flex items-center justify-center text-xs font-bold shrink-0`}>
                {initials(hoveredCv.name)}
              </div>
              <div className="min-w-0">
                <p className="font-bold text-gray-900 text-sm leading-tight truncate">{hoveredCv.name}</p>
                <span className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase mt-0.5 ${TYPE_BADGE[hoveredCv.type]?.bg} ${TYPE_BADGE[hoveredCv.type]?.text}`}>
                  {hoveredCv.type}
                </span>
              </div>
              {hoveredAi && (
                <div className="ml-auto text-right shrink-0">
                  <div className={`text-2xl font-black tabular-nums leading-none ${hoveredScored?.indicator === 'above' ? 'text-emerald-500' : hoveredScored?.indicator === 'below' ? 'text-red-500' : 'text-gray-700'}`}>
                    {hoveredAi.total}
                  </div>
                  <div className="text-[9px] text-gray-400">/ 100</div>
                  {hoveredAi.confidence != null && (
                    <div className={`text-[9px] font-bold mt-0.5 ${confidenceCls(hoveredAi.confidenceLevel).ring}`}>
                      🛡 {hoveredAi.confidence}%
                    </div>
                  )}
                </div>
              )}
            </div>

            {hoveredAi && (
              <div className="space-y-1.5 mb-3">
                {hoveredAi.breakdown.map(dim => {
                  const pct = Math.round((dim.score / dim.max) * 100);
                  return (
                    <div key={dim.label} className="flex items-center gap-2">
                      <span className={`text-[9px] w-28 shrink-0 truncate ${dim.purple ? 'text-purple-500 font-medium' : 'text-gray-400'}`}>
                        {dim.purple && '★ '}{dim.label}
                      </span>
                      <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${dim.purple ? 'bg-purple-100' : 'bg-gray-100'}`}>
                        <div className={`h-full rounded-full ${dim.purple ? 'bg-purple-400' : pct >= 70 ? 'bg-emerald-400' : pct >= 40 ? 'bg-amber-400' : 'bg-red-400'}`}
                          style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[9px] font-bold text-gray-600 tabular-nums w-8 text-right shrink-0">{dim.score}/{dim.max}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {hoveredAi?.summary && (
              <p className="text-[10px] text-gray-500 italic leading-snug border-t border-gray-100 pt-2 mb-1">
                {hoveredAi.summary}
              </p>
            )}
            {hoveredAi?.confidenceReason && (
              <p className={`text-[9px] font-medium ${confidenceCls(hoveredAi.confidenceLevel).ring}`}>
                🛡 {hoveredAi.confidenceReason}
              </p>
            )}

            {!hoveredAi && cvSnippet(hoveredCv) && (
              <p className="text-[11px] text-gray-500 leading-relaxed line-clamp-4 border-t border-gray-100 pt-2.5">
                {cvSnippet(hoveredCv)}
              </p>
            )}

            <p className="text-[10px] text-gray-300 mt-2">Click to select · ▼ to see breakdown</p>
          </div>
        )}
      </div>

      {/* Hiring Manager Report Modal */}
      {showReport && active && (
        <ReportModal
          cvs={active.candidates}
          projectJd={active.description}
          onClose={() => setShowReport(false)}
        />
      )}

      {/* Team Formation Modal */}
      {showTeam && active && (
        <TeamModal
          cvs={active.candidates}
          onClose={() => setShowTeam(false)}
        />
      )}

      {/* Email Shortlist Modal */}
      {showEmail && active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowEmail(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="font-bold text-gray-900">Recruiter Shortlist Email</h2>
                <p className="text-xs text-gray-400 mt-0.5">Ready to send to your hiring manager</p>
              </div>
              <button onClick={() => setShowEmail(false)} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              {(() => {
                const shortlistCvs = selected.size > 0
                  ? active.candidates.filter(c => selected.has(c.id))
                  : active.candidates;
                const emailBody = [
                  `Subject: Candidate Shortlist — ${active.title}`,
                  '',
                  `Hi [Hiring Manager],`,
                  '',
                  `I've completed the initial screening for the ${active.title} role. Here is my shortlist of ${shortlistCvs.length} candidate${shortlistCvs.length !== 1 ? 's' : ''} for your review:`,
                  '',
                  ...shortlistCvs.map((cv, i) => {
                    const score = currentAiScores[cv.id];
                    const stage = STAGE_CONFIG[getStage(cv.id)];
                    return [
                      `${i + 1}. ${cv.name}${score ? ` — AI Score: ${score.total}/100` : ''} [${stage.label}]`,
                      score?.summary ? `   ${score.summary}` : '',
                    ].filter(Boolean).join('\n');
                  }),
                  '',
                  `Please let me know your availability for interviews at your earliest convenience.`,
                  '',
                  `Best regards,`,
                  `[Your Name]`,
                ].join('\n');

                return (
                  <div>
                    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 font-mono text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">
                      {emailBody}
                    </div>
                    <button
                      onClick={() => navigator.clipboard.writeText(emailBody)}
                      className="mt-3 flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-xs font-semibold rounded-lg hover:bg-gray-700 transition-all"
                    >
                      Copy to Clipboard
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* JD Bias Audit Modal */}
      {showBiasAudit && biasResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowBiasAudit(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
              <div>
                <h2 className="font-bold text-gray-900">JD Bias Audit</h2>
                <p className="text-xs text-gray-400 mt-0.5">{biasResult.summary}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`px-3 py-1 text-xs font-bold rounded-full ${
                  biasResult.overallRisk === 'high' ? 'bg-red-100 text-red-700' :
                  biasResult.overallRisk === 'moderate' ? 'bg-amber-100 text-amber-700' :
                  'bg-emerald-100 text-emerald-700'
                }`}>
                  {biasResult.overallRisk?.toUpperCase()} RISK
                </span>
                <button onClick={() => setShowBiasAudit(false)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="p-6 space-y-3">
              {biasResult.flags.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <p className="text-2xl mb-2">✅</p>
                  <p className="text-sm font-medium text-gray-600">No bias patterns detected</p>
                  <p className="text-xs text-gray-400 mt-1">Your job description looks inclusive!</p>
                </div>
              ) : (
                biasResult.flags.map((flag: any, i: number) => (
                  <div key={i} className={`rounded-xl border p-4 ${
                    flag.severity === 'high' ? 'bg-red-50 border-red-200' :
                    flag.severity === 'medium' ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'
                  }`}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${
                        flag.type === 'gender' ? 'bg-pink-100 text-pink-600' :
                        flag.type === 'age' ? 'bg-blue-100 text-blue-600' :
                        flag.type === 'exclusionary' ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-600'
                      }`}>{flag.type}</span>
                      <span className={`text-[10px] font-semibold ${
                        flag.severity === 'high' ? 'text-red-500' : flag.severity === 'medium' ? 'text-amber-500' : 'text-gray-400'
                      }`}>{flag.severity}</span>
                    </div>
                    <p className="text-sm font-semibold text-gray-900 mb-1">"{flag.phrase}"</p>
                    <p className="text-xs text-gray-600 leading-relaxed">💡 {flag.suggestion}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Score Zoom Modal */}
      {zoomedScore && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setZoomedScore(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
              <div className={`w-11 h-11 rounded-full ${zoomedScore.colorClass} text-white flex items-center justify-center text-sm font-bold shrink-0`}>
                {initials(zoomedScore.name)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-900 text-base truncate">{zoomedScore.name}</p>
                <p className="text-xs text-gray-400">AI Score Breakdown</p>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <div className="text-right">
                  <div className={`text-4xl font-black tabular-nums leading-none ${
                    zoomedScore.aiScore.total >= 75 ? 'text-emerald-500' :
                    zoomedScore.aiScore.total >= 50 ? 'text-amber-500' : 'text-red-500'
                  }`}>
                    {zoomedScore.aiScore.total}
                  </div>
                  <div className="text-[10px] text-gray-400 font-medium">/ 100</div>
                </div>
                <button onClick={() => setZoomedScore(null)} className="text-gray-400 hover:text-gray-700 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Dimension breakdown */}
            <div className="px-6 pt-5 pb-2 space-y-5">
              {zoomedScore.aiScore.breakdown.map(dim => {
                const pct = Math.round((dim.score / dim.max) * 100);
                const barColor = dim.purple ? 'bg-purple-400' : pct >= 70 ? 'bg-emerald-400' : pct >= 40 ? 'bg-amber-400' : 'bg-red-400';
                return (
                  <div key={dim.label}>
                    <div className="flex items-center justify-between gap-3 mb-1">
                      <span className={`text-sm font-semibold ${dim.purple ? 'text-purple-600' : 'text-gray-800'}`}>
                        {dim.purple && <span className="mr-1">★</span>}{dim.label}
                      </span>
                      <span className="text-sm font-bold text-gray-900 tabular-nums shrink-0">
                        {dim.score}<span className="text-gray-400 font-normal text-xs">/{dim.max}</span>
                      </span>
                    </div>
                    <div className={`h-2.5 rounded-full overflow-hidden mb-1.5 ${dim.purple ? 'bg-purple-100' : 'bg-gray-100'}`}>
                      <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                    </div>
                    <p className={`text-xs leading-relaxed ${dim.purple ? 'text-purple-500 italic' : 'text-gray-500'}`}>{dim.reason}</p>
                  </div>
                );
              })}
            </div>

            {/* Summary */}
            {zoomedScore.aiScore.summary && (
              <div className="mx-6 mb-4 mt-2 p-4 bg-gray-50 rounded-xl border border-gray-100">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Overall Assessment</p>
                <p className="text-sm text-gray-700 leading-relaxed italic">{zoomedScore.aiScore.summary}</p>
              </div>
            )}

            {/* Confidence */}
            {zoomedScore.aiScore.confidence != null && (
              <div className={`mx-6 mb-6 p-4 rounded-xl ${confidenceCls(zoomedScore.aiScore.confidenceLevel).bg}`}>
                <p className={`text-sm font-bold ${confidenceCls(zoomedScore.aiScore.confidenceLevel).ring}`}>
                  🛡 {zoomedScore.aiScore.confidenceLevel?.toUpperCase()} CONFIDENCE — {zoomedScore.aiScore.confidence}%
                </p>
                {zoomedScore.aiScore.confidenceReason && (
                  <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">{zoomedScore.aiScore.confidenceReason}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Spark zoom modal ──────────────────────────────────────────────────── */}
      {zoomedSpark && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setZoomedSpark(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-sm w-full mx-4 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 bg-amber-50 border-b border-amber-100">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-full bg-amber-400 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                  {initials(zoomedSpark.name)}
                </div>
                <span className="text-sm font-bold text-gray-900 truncate">{zoomedSpark.name}</span>
              </div>
              <button onClick={() => setZoomedSpark(null)} className="text-gray-400 hover:text-gray-700 ml-3 shrink-0 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-5">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                  <Zap className="w-4 h-4 text-amber-500" />
                </div>
                <div>
                  <p className="text-[9px] font-bold text-amber-500 uppercase tracking-widest mb-2">Flash Point</p>
                  <p className="text-sm text-gray-800 leading-relaxed">{zoomedSpark.spark}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
