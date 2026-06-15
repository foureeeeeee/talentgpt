import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
import {
  Loader2, AlertCircle, Copy, Check, RefreshCw,
  BarChart2, Search, X, User, Tag,
  ZoomIn, ZoomOut, Maximize2, RotateCcw,
  FileText, Sparkles, Download,
} from 'lucide-react';
import { AnalysisModule, CV } from '../types';

interface AnalysisResultsProps {
  loading: boolean;
  error: string | null;
  result: string | null;
  activeModule: AnalysisModule;
  onRetry: () => void;
  cvs: CV[];
  allScores: Record<string, Record<string, any>>;
  activeFilter: string;
  jobDescription: string;
  managerNotes: string;
  showCvPanel: boolean;
  onCloseCvPanel: () => void;
  showScorePanel: boolean;
  onCloseScorePanel: () => void;
}

const LOADING_MESSAGES: Record<AnalysisModule, { title: string; sub: string }> = {
  snapshot:          { title: 'Generating candidate snapshot…',    sub: 'Extracting skills, achievements, and career trajectory.' },
  match:             { title: 'Analyzing job match…',              sub: 'Comparing candidate profile against job requirements.' },
  potential:         { title: 'Assessing growth potential…',       sub: 'Detecting explicit & implicit signals from activities.' },
  risk:              { title: 'Running HR risk assessment…',       sub: 'Reviewing employment gaps, claim consistency, and red flags.' },
  psychology:        { title: 'Building psychological profile…',   sub: 'Estimating MBTI, Big Five traits, and team dynamics.' },
  interview:         { title: 'Generating interview questions…',   sub: 'Crafting tailored technical, behavioral, and situational questions.' },
  compensation:      { title: 'Calculating compensation range…',   sub: 'Benchmarking against market data and candidate qualifications.' },
  rejection:         { title: 'Drafting ethical rejection…',       sub: 'Preparing constructive, evidence-based feedback.' },
  audit:             { title: 'Auditing CV claims…',               sub: 'Verifying evidence behind key claims and achievements.' },
  ranking:           { title: 'Ranking candidates…',               sub: 'Scoring across match, potential, experience, and cultural fit.' },
  team_optimization: { title: 'Optimizing team composition…',      sub: 'Balancing skills, personalities, and leadership potential.' },
  similarity:        { title: 'Comparing candidate profiles…',     sub: 'Finding overlaps and distinguishing differences across applicants.' },
  retention:         { title: 'Analyzing retention risk…',         sub: 'Examining tenure patterns and flight risk indicators.' },
};

const FILTER_LABEL: Record<string, string> = {
  all: 'Overall Profile', skills: 'Skills Profile', experience: 'Experience Depth',
  impact: 'Impact & Results', education: 'Education Fit', culture: 'Culture Fit', leadership: 'Leadership',
};

// ─── Semantic search concept expansion ───────────────────────────────────────

const CONCEPT_SYNONYMS: [string, string[]][] = [
  ['lead',    ['leader', 'leadership', 'leading', 'led', 'headed', 'captain', 'president', 'chair', 'direct', 'aiesec', 'foundat', 'initiative']],
  ['manag',   ['manage', 'managed', 'manager', 'management', 'organiz', 'coordinat', 'supervis', 'oversee']],
  ['commun',  ['communic', 'present', 'speech', 'speak', 'report', 'pitch', 'negotiat', 'articul', 'write', 'writing']],
  ['team',    ['teamwork', 'collaborat', 'cooperat', 'partner', 'group', 'collective', 'cross-func']],
  ['analyt',  ['analytics', 'analytical', 'data', 'statistic', 'metric', 'insight', 'research', 'analys']],
  ['problem', ['problem', 'solv', 'solution', 'debug', 'troubleshoot', 'optim', 'fix', 'resolve']],
  ['creativ', ['creative', 'creativity', 'design', 'innovat', 'idea', 'original', 'concept']],
  ['program', ['programm', 'code', 'codi', 'software', 'develop', 'implement', 'engineer', 'build', 'architect']],
  ['project', ['project', 'agile', 'scrum', 'sprint', 'deliver', 'deadline', 'milestone', 'plan']],
  ['potenti', ['potential', 'growth', 'trajectory', 'upward', 'promot', 'ambiti', 'aspir']],
  ['skill',   ['skill', 'competenc', 'proficien', 'expert', 'ablity', 'capab']],
  ['experienc', ['experience', 'background', 'work history', 'intern', 'career', 'role', 'position']],
  ['risk',    ['risk', 'concern', 'gap', 'inconsistenc', 'flag', 'missing', 'weak']],
  ['strong',  ['strength', 'strong', 'excel', 'outstanding', 'excellent', 'top', 'best']],
];

function buildSearchTerms(query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const terms = new Set<string>(words);
  for (const word of words) {
    if (word.length > 4) terms.add(word.slice(0, 5));
    for (const [key, synonyms] of CONCEPT_SYNONYMS) {
      const matchesKey = word.startsWith(key.slice(0, 4)) || key.startsWith(word.slice(0, 4));
      const matchesSyn = synonyms.some(s => word.startsWith(s.slice(0, 4)) || s.startsWith(word.slice(0, 4)));
      if (matchesKey || matchesSyn) {
        terms.add(key);
        synonyms.forEach(s => terms.add(s.slice(0, 5)));
      }
    }
  }
  return [...terms].filter(t => t.length >= 2);
}

function scoreSectionByTerms(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  return terms.reduce((acc, term) => {
    try {
      const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      return acc + (lower.match(re) || []).length;
    } catch { return acc; }
  }, 0);
}

// ─── Mind Map ─────────────────────────────────────────────────────────────────

interface MindMapData { center: string; branches: { label: string; items: string[] }[] }

function parseSkillsMindMap(text: string): MindMapData | null {
  const section = text.match(/##\s*Technical Skills([\s\S]*?)(?=\n##\s|$)/i)?.[1];
  if (!section) return null;
  const branches: { label: string; items: string[] }[] = [];
  const re = /\*\*([^*:]+?):\*\*\s*([^\n]+)/g;
  let m;
  while ((m = re.exec(section)) !== null) {
    const label = m[1].trim();
    const items = m[2].split(/[,;]/).map(s => s.replace(/\*+/g, '').trim()).filter(s => s.length > 0 && s.length < 18).slice(0, 3);
    if (items.length > 0 && label.length < 20) branches.push({ label, items });
    if (branches.length >= 6) break;
  }
  return branches.length >= 2 ? { center: 'Tech Skills', branches } : null;
}

function parseGenericMindMap(text: string, center: string): MindMapData | null {
  const branches: { label: string; items: string[] }[] = [];
  for (const sec of text.split(/(?=^## )/m)) {
    const hdr = sec.match(/^## (.+)/);
    if (!hdr) continue;
    const label = hdr[1].replace(/[*_#📊🎯💡🔍✅⚠️❌→]/g, '').trim().slice(0, 15);
    const items = sec.split('\n')
      .filter(l => /^\s*[-*•]\s+/.test(l))
      .map(l => l.replace(/^\s*[-*•]\s+/, '').replace(/\*+/g, '').replace(/[✅⚠️❌🎯📊→]/g, '').replace(/:\s*\d+\/100/g, '').trim().slice(0, 12))
      .filter(Boolean).slice(0, 3);
    if (label && items.length >= 1) branches.push({ label, items });
    if (branches.length >= 6) break;
  }
  return branches.length >= 2 ? { center, branches } : null;
}

const CX = 700, CY = 380;
const R1 = 210, R2 = 155;

function computeLayout(branches: MindMapData['branches']) {
  const N = branches.length;
  const maxLeaves  = N >= 6 ? 2 : 3;
  const leafSpread = (2 * Math.PI / N) * 0.40;
  return branches.map((b, i) => {
    const bAngle = (i / N) * 2 * Math.PI - Math.PI / 2;
    const bx = CX + R1 * Math.cos(bAngle);
    const by = CY + R1 * Math.sin(bAngle);
    const items = b.items.slice(0, maxLeaves);
    const M = items.length;
    const leaves = items.map((item, j) => {
      const spread = M === 1 ? 0 : ((j / (M - 1)) - 0.5) * leafSpread;
      const a = bAngle + spread;
      return { item, lx: bx + R2 * Math.cos(a), ly: by + R2 * Math.sin(a) };
    });
    return { label: b.label, bx, by, leaves };
  });
}

function trunc(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function MindMapDiagram({ data }: { data: MindMapData }) {
  const layout = useMemo(() => computeLayout(data.branches), [data]);
  const words = data.center.split(' ');
  const half = Math.ceil(words.length / 2);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan]   = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const dragRef  = useRef({ startX: 0, startY: 0, panX: 0, panY: 0 });
  const pinchRef = useRef({ dist: 0, zoom: 1 });

  const clampZoom = (z: number) => Math.max(0.2, Math.min(5, z));

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => clampZoom(z * (e.deltaY < 0 ? 1.12 : 0.89)));
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setPan({ x: dragRef.current.panX + e.clientX - dragRef.current.startX, y: dragRef.current.panY + e.clientY - dragRef.current.startY });
  };
  const onMouseUp = () => setDragging(false);

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setDragging(true);
      dragRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, panX: pan.x, panY: pan.y };
    } else if (e.touches.length === 2) {
      pinchRef.current = { dist: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), zoom };
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1 && dragging) {
      setPan({ x: dragRef.current.panX + e.touches[0].clientX - dragRef.current.startX, y: dragRef.current.panY + e.touches[0].clientY - dragRef.current.startY });
    } else if (e.touches.length === 2) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      setZoom(clampZoom(pinchRef.current.zoom * (d / pinchRef.current.dist)));
    }
  };
  const onTouchEnd = () => setDragging(false);

  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const zoomIn  = () => setZoom(z => clampZoom(z * 1.2));
  const zoomOut = () => setZoom(z => clampZoom(z / 1.2));

  const transform = `translate(${pan.x + CX * (1 - zoom)}, ${pan.y + CY * (1 - zoom)}) scale(${zoom})`;

  const toggleNode = (text: string) => setSelectedNode(prev => prev === text ? null : text);

  const svgNodes = (
    <g transform={transform}>
      {layout.map((b, i) => (
        <g key={`ln-${i}`}>
          <line x1={CX} y1={CY} x2={b.bx} y2={b.by} stroke="#64748b" strokeWidth="2.5" strokeLinecap="round" />
          {b.leaves.map((l, j) => (
            <line key={j} x1={b.bx} y1={b.by} x2={l.lx} y2={l.ly} stroke="#334155" strokeWidth="1.5" strokeLinecap="round" />
          ))}
        </g>
      ))}
      {/* Center node */}
      <circle cx={CX} cy={CY} r={62} fill="#1e3a5f" stroke="#3b82f6" strokeWidth="2" />
      <text textAnchor="middle" fill="white" fontSize="13" fontWeight="700" fontFamily="system-ui,sans-serif">
        {words.length === 1
          ? <tspan x={CX} y={CY + 5}>{data.center}</tspan>
          : <><tspan x={CX} y={CY - 7}>{words.slice(0, half).join(' ')}</tspan><tspan x={CX} y={CY + 12}>{words.slice(half).join(' ')}</tspan></>}
      </text>
      {/* Branch + leaf nodes */}
      {layout.map((b, i) => {
        const lbl = trunc(b.label, 13);
        const bW = Math.max(88, lbl.length * 8 + 22);
        const isSelectedBranch = selectedNode === b.label;
        return (
          <g key={`nd-${i}`}>
            <title>{b.label}</title>
            <rect x={b.bx - bW / 2} y={b.by - 18} width={bW} height={36} rx={8}
              fill={isSelectedBranch ? '#2563eb' : '#1e293b'}
              stroke={isSelectedBranch ? '#93c5fd' : '#60a5fa'} strokeWidth="1.5"
              onClick={() => toggleNode(b.label)} style={{ cursor: 'pointer' }} />
            <text x={b.bx} y={b.by + 1} textAnchor="middle" dominantBaseline="middle"
              fill={isSelectedBranch ? '#ffffff' : '#e2e8f0'}
              fontSize="12" fontWeight="600" fontFamily="system-ui,sans-serif"
              onClick={() => toggleNode(b.label)} style={{ cursor: 'pointer', pointerEvents: 'none' }}>
              {lbl}
            </text>
            {b.leaves.map((l, j) => {
              const ll = trunc(l.item, 11);
              const lW = Math.max(72, ll.length * 7.5 + 18);
              const isSelectedLeaf = selectedNode === l.item;
              return (
                <g key={j}>
                  <title>{l.item}</title>
                  <rect x={l.lx - lW / 2} y={l.ly - 13} width={lW} height={26} rx={5}
                    fill={isSelectedLeaf ? '#1d4ed8' : '#0f172a'}
                    stroke={isSelectedLeaf ? '#60a5fa' : '#475569'} strokeWidth="1.5"
                    onClick={() => toggleNode(l.item)} style={{ cursor: 'pointer' }} />
                  <text x={l.lx} y={l.ly} textAnchor="middle" dominantBaseline="middle"
                    fill={isSelectedLeaf ? '#ffffff' : '#94a3b8'}
                    fontSize="11" fontFamily="system-ui,sans-serif"
                    onClick={() => toggleNode(l.item)} style={{ cursor: 'pointer', pointerEvents: 'none' }}>
                    {ll}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );

  const sharedSvgProps = {
    width: '100%',
    viewBox: '0 0 1400 760',
    onWheel, onMouseDown, onMouseMove, onMouseUp, onMouseLeave: onMouseUp,
    onTouchStart, onTouchMove, onTouchEnd,
    style: {
      background: 'linear-gradient(135deg,#0a0f1e 0%,#0f172a 60%,#111827 100%)',
      display: 'block',
      cursor: dragging ? 'grabbing' : 'grab',
      userSelect: 'none' as const,
      touchAction: 'none' as const,
    },
  };

  const Controls = ({ white = false }: { white?: boolean }) => {
    const cls = `p-1.5 rounded hover:bg-white/10 transition-colors ${white ? 'text-slate-300' : 'text-slate-400'}`;
    return (
      <div className="flex items-center gap-0.5">
        <button onClick={zoomOut}   title="Zoom out"    className={cls}><ZoomOut    className="w-3.5 h-3.5" /></button>
        <span className={`text-[11px] w-10 text-center tabular-nums ${white ? 'text-slate-300' : 'text-slate-500'}`}>{Math.round(zoom * 100)}%</span>
        <button onClick={zoomIn}    title="Zoom in"     className={cls}><ZoomIn     className="w-3.5 h-3.5" /></button>
        <button onClick={resetView} title="Reset view"  className={`${cls} ml-1`}><RotateCcw className="w-3.5 h-3.5" /></button>
        <button onClick={() => setFullscreen(true)} title="Fullscreen" className={cls}><Maximize2 className="w-3.5 h-3.5" /></button>
      </div>
    );
  };

  const NodeLabel = () => selectedNode ? (
    <div className="px-4 py-2 flex items-center gap-2 border-t border-slate-800" style={{ background: '#060d1a' }}>
      <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
      <span className="text-xs text-slate-300 font-medium flex-1 break-words">{selectedNode}</span>
      <button onClick={() => setSelectedNode(null)} className="text-slate-500 hover:text-slate-300 shrink-0 ml-1">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  ) : (
    <div className="px-4 py-1.5 text-center text-[10px] text-slate-600 border-t border-slate-800" style={{ background: '#060d1a' }}>
      Scroll to zoom · Drag to pan · <span className="text-slate-500">Click a node to expand full label</span> ·{' '}
      <button onClick={() => setFullscreen(true)} className="underline hover:text-slate-400">Fullscreen</button>
    </div>
  );

  return (
    <>
      <div className="mb-6 rounded-2xl overflow-hidden border border-slate-700/60 shadow-xl select-none">
        <div className="px-4 py-2.5 border-b border-slate-700/60 flex items-center justify-between" style={{ background: '#060d1a' }}>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">
              Mind Map · {data.center}
            </span>
          </div>
          <Controls />
        </div>
        <svg {...sharedSvgProps} height={370}>{svgNodes}</svg>
        <NodeLabel />
      </div>

      {fullscreen && (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#060d1a' }}>
          <div className="flex items-center justify-between px-6 py-3 border-b border-slate-800 shrink-0">
            <span className="text-[11px] font-bold tracking-widest text-slate-400 uppercase">{data.center} · Mind Map</span>
            <div className="flex items-center gap-3">
              <Controls white />
              <button onClick={() => setFullscreen(false)} className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 rounded transition-colors ml-2">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            <svg {...sharedSvgProps} height="100%">{svgNodes}</svg>
          </div>
          <NodeLabel />
        </div>
      )}
    </>
  );
}

// ─── Multi-candidate parser + tabs ────────────────────────────────────────────

interface CandidateSection { name: string; initials: string; content: string }

function parseCandidates(text: string): CandidateSection[] {
  const parts = text.split(/^## Candidate:\s*/mi);
  if (parts.length < 2) return [];
  return parts.slice(1).map(part => {
    const nl = part.indexOf('\n');
    const name = part.slice(0, nl).trim().replace(/[*_]/g, '');
    const content = part.slice(nl).trim();
    const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return { name, initials, content };
  }).filter(c => c.name.length > 0);
}

const AVATAR_COLORS = [
  'bg-violet-600', 'bg-blue-600', 'bg-emerald-600',
  'bg-amber-600',  'bg-rose-600', 'bg-cyan-600',
];

const MODULE_CENTERS: Partial<Record<AnalysisModule, string>> = {
  snapshot:          'Candidate Profile',
  match:             'Job Match',
  potential:         'Growth Potential',
  risk:              'Risk Factors',
  psychology:        'Psych Profile',
  interview:         'Interview Focus',
  compensation:      'Pay Drivers',
  rejection:         'Gap Analysis',
  audit:             'CV Reliability',
  ranking:           'Ranking Factors',
  team_optimization: 'Team Fit',
};

function CandidateContent({ candidate, idx, activeModule, aiScore }: {
  candidate: CandidateSection; idx: number; activeModule: AnalysisModule; aiScore?: any;
}) {
  const mindMap = useMemo(() => {
    if (activeModule === 'similarity' || activeModule === 'audit') return null;
    if (activeModule === 'snapshot') return parseSkillsMindMap(candidate.content);
    const center = MODULE_CENTERS[activeModule];
    return center ? parseGenericMindMap(candidate.content, center) : null;
  }, [candidate.content, activeModule]);

  const externalMetrics = useMemo(() => {
    if (!aiScore?.breakdown) return undefined;
    return (aiScore.breakdown as any[])
      .map(d => ({ label: (d.label || d.dimension || '').toString(), value: Number(d.score) || 0 }))
      .filter(m => m.label);
  }, [aiScore]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-6 p-4 bg-gray-50 rounded-xl border border-gray-200">
        <div className={`w-10 h-10 rounded-full ${AVATAR_COLORS[idx % AVATAR_COLORS.length]} text-white flex items-center justify-center text-sm font-bold shrink-0`}>
          {candidate.initials}
        </div>
        <div>
          <p className="font-semibold text-gray-900 text-sm">{candidate.name}</p>
          <p className="text-[11px] text-gray-400 capitalize">{activeModule.replace('_', ' ')} analysis</p>
        </div>
        {aiScore && (
          <div className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-violet-50 border border-violet-200 rounded-lg">
            <Sparkles className="w-3 h-3 text-violet-500" />
            <span className="text-xs font-bold text-violet-700">{aiScore.total}/100</span>
          </div>
        )}
      </div>
      {mindMap && <MindMapDiagram data={mindMap} />}
      <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{candidate.content}</Markdown>
    </div>
  );
}

function MultiCandidateLayout({ result, activeModule, scores }: { result: string; activeModule: AnalysisModule; scores: Record<string, any> }) {
  const [activeTab, setActiveTab] = useState(0);
  const candidates = useMemo(() => parseCandidates(result), [result]);

  const findScore = useCallback((name: string) => {
    const lname = name.toLowerCase().trim();
    return Object.values(scores).find((s: any) => {
      const sname = (s.name || '').toLowerCase().trim();
      return sname === lname || sname.includes(lname) || lname.includes(sname);
    });
  }, [scores]);

  if (!candidates.length) {
    return <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{result}</Markdown>;
  }

  return (
    <div>
      <div className="flex gap-1.5 mb-6 pb-3 border-b border-gray-100 flex-wrap">
        {candidates.map((c, i) => (
          <button key={i} onClick={() => setActiveTab(i)}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
              activeTab === i ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
            }`}>
            <span className={`w-5 h-5 rounded-full ${AVATAR_COLORS[i % AVATAR_COLORS.length]} text-white flex items-center justify-center text-[10px] font-bold shrink-0`}>
              {c.initials}
            </span>
            {c.name}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-gray-400 flex items-center">{candidates.length} candidates</span>
      </div>
      {candidates[activeTab] && (
        <CandidateContent
          candidate={candidates[activeTab]}
          idx={activeTab}
          activeModule={activeModule}
          aiScore={findScore(candidates[activeTab].name)}
        />
      )}
    </div>
  );
}

// ─── Metric bars ──────────────────────────────────────────────────────────────

function extractMetrics(text: string): { label: string; value: number }[] {
  const seen = new Set<string>();
  const metrics: { label: string; value: number }[] = [];
  const patterns = [
    /\*\*([^*\n]{3,50}?)\*\*\s*:\s*\*\*(\d{1,3})(?:\/100)?\*\*/gi,
    /\*\*([^*\n]{3,50}?)\*\*\s*:\s*(\d{1,3})(?:\/100)?(?!\d)/gi,
    /([A-Za-z][A-Za-z\s]{2,45}?)\s*:\s*\*\*(\d{1,3})(?:\/100)?\*\*/gi,
    /\*\*([^*\n]{3,50}?(?:score|match|potential|rating|fit|index|level|rank|assessment))\*\*\s*:\s*(\d{1,3})(?:\/100)?/gi,
    /([A-Za-z][A-Za-z ]{2,40}(?:score|match|potential|rating|fit|index|level|rank|assessment|evaluation))\s*:\s*\*?\*?(\d{1,3})(?:\/100)?\*?\*?/gi,
    /\|\s*([A-Za-z][A-Za-z\s/]{3,35}?)\s*\|\s*(\d{1,3})(?:\/100)?\s*\|/gim,
  ];
  for (const re of patterns) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(text)) !== null) {
      const label = m[1].trim().replace(/\*+/g, '').replace(/:$/, '').trim();
      const val = parseInt(m[2]);
      const key = label.toLowerCase().replace(/\s+/g, ' ');
      if (val >= 0 && val <= 100 && !seen.has(key) && label.length >= 3) { seen.add(key); metrics.push({ label, value: val }); }
    }
  }
  return metrics.slice(0, 6);
}

function scoreColor(v: number) {
  if (v >= 75) return { bar: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (v >= 50) return { bar: 'bg-amber-500',   badge: 'bg-amber-50 text-amber-700 border-amber-200' };
  return              { bar: 'bg-red-500',      badge: 'bg-red-50 text-red-700 border-red-200' };
}

function MetricsDashboard({ text, externalMetrics }: { text: string; externalMetrics?: { label: string; value: number }[] }) {
  const textMetrics = useMemo(() => extractMetrics(text), [text]);
  const metrics = useMemo(() => {
    const safeExt = (externalMetrics || []).filter(m => m.label);
    if (safeExt.length) {
      const seen = new Set(safeExt.map(m => m.label.toLowerCase()));
      const extra = textMetrics.filter(m => m.label && !seen.has(m.label.toLowerCase()));
      return [...safeExt, ...extra].slice(0, 6);
    }
    return textMetrics;
  }, [externalMetrics, textMetrics]);

  if (!metrics.length) return null;
  return (
    <div className="mb-5 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100 bg-gray-50/60">
        <BarChart2 className="w-3.5 h-3.5 text-gray-400" />
        <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase">Key Metrics</p>
      </div>
      <div className={`grid gap-5 p-5 ${metrics.length > 3 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {metrics.map(m => {
          const c = scoreColor(m.value);
          return (
            <div key={m.label} className="space-y-1.5">
              <div className="flex justify-between items-center gap-3">
                <span className="text-xs font-medium text-gray-600 truncate capitalize">{m.label}</span>
                <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border shrink-0 ${c.badge}`}>
                  {m.value}<span className="opacity-50">/100</span>
                </span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full ${c.bar} rounded-full transition-all`} style={{ width: `${m.value}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── AI Score Panel ───────────────────────────────────────────────────────────

const SCORE_FILTERS = [
  { key: 'all', label: 'Overall' },
  { key: 'skills', label: 'Skills' },
  { key: 'experience', label: 'Experience' },
  { key: 'impact', label: 'Impact' },
  { key: 'education', label: 'Education' },
  { key: 'culture', label: 'Culture' },
  { key: 'leadership', label: 'Leadership' },
];

function ScorePanel({ cvs, initialAllScores, defaultFilter, jobDescription, managerNotes, onClose }: {
  cvs: CV[];
  initialAllScores: Record<string, Record<string, any>>;
  defaultFilter: string;
  jobDescription: string;
  managerNotes: string;
  onClose: () => void;
}) {
  const [allScores, setAllScores] = useState<Record<string, Record<string, any>>>(initialAllScores);
  const [selectedFilter, setSelectedFilter] = useState<string>(() => {
    for (const f of [defaultFilter, ...SCORE_FILTERS.map(f => f.key)]) {
      if (cvs.some(cv => initialAllScores[f]?.[cv.id])) return f;
    }
    return defaultFilter || 'all';
  });
  const [selectedCvIdx, setSelectedCvIdx] = useState(0);
  const [scoringFilter, setScoringFilter] = useState<string | null>(null);
  const [scoreError, setScoreError] = useState<string | null>(null);

  const filterScores = allScores[selectedFilter] || {};
  const activeCv = cvs[Math.min(selectedCvIdx, cvs.length - 1)];
  const score = activeCv ? filterScores[activeCv.id] : null;
  const breakdown: any[] = score?.breakdown || [];
  const hasCvScores = cvs.some(cv => filterScores[cv.id]);

  const scoreNow = async (filter: string) => {
    if (scoringFilter) return;
    setScoringFilter(filter);
    setScoreError(null);
    try {
      const res = await fetch('/api/score-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cvs, jobDescription, managerNotes, filter }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Scoring failed');
      setAllScores(prev => ({ ...prev, [filter]: data.scores }));
      setSelectedFilter(filter);
    } catch (err: any) {
      setScoreError(err.message || 'Scoring failed');
    } finally {
      setScoringFilter(null);
    }
  };

  return (
    <div className="shrink-0 border-b border-gray-200 bg-white shadow-sm" style={{ maxHeight: 260 }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-gradient-to-r from-violet-50 to-purple-50 shrink-0">
        <Sparkles className="w-3.5 h-3.5 text-violet-500 shrink-0" />
        <span className="text-xs font-bold text-violet-700">AI Dimension Scores</span>
        {score && (
          <>
            <span className="text-xs text-violet-300">·</span>
            <span className="text-xs font-bold text-violet-700 bg-violet-100 px-2 py-0.5 rounded-full">{score.total}/100</span>
          </>
        )}
        <button onClick={onClose} className="ml-auto p-1 text-gray-400 hover:text-gray-600 rounded transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 px-3 py-1.5 border-b border-gray-100 overflow-x-auto shrink-0">
        {SCORE_FILTERS.map(({ key, label }) => {
          const isScored = cvs.some(cv => allScores[key]?.[cv.id]);
          const isLoading = scoringFilter === key;
          const isSelected = selectedFilter === key;
          return (
            <button key={key} onClick={() => setSelectedFilter(key)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold whitespace-nowrap transition-colors border ${
                isSelected && isScored ? 'bg-violet-600 text-white border-violet-600' :
                isSelected ? 'bg-gray-100 text-gray-700 border-gray-200' :
                isScored ? 'bg-violet-50 text-violet-600 border-violet-200 hover:bg-violet-100' :
                'text-gray-400 border-gray-100 hover:bg-gray-50'
              }`}>
              {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex overflow-hidden" style={{ maxHeight: 186 }}>
        {/* Candidate selector (multi-CV, only when scores exist) */}
        {hasCvScores && cvs.length > 1 && (
          <div className="flex flex-col border-r border-gray-100 shrink-0 overflow-y-auto" style={{ width: 110 }}>
            {cvs.map((cv, i) => (
              <button key={cv.id} onClick={() => setSelectedCvIdx(i)}
                className={`px-2.5 py-1.5 text-[10px] text-left font-medium border-b border-gray-50 transition-colors ${
                  i === selectedCvIdx ? 'bg-violet-50 text-violet-700 border-l-2 border-l-violet-500' : 'text-gray-500 hover:bg-gray-50'
                }`}>
                <span className="block truncate">{cv.name}</span>
                {allScores[selectedFilter]?.[cv.id]?.total != null && (
                  <span className="text-[9px] text-gray-400">{allScores[selectedFilter][cv.id].total}/100</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Scores or prompt to score */}
        <div className="flex-1 p-3 overflow-y-auto">
          {hasCvScores && score ? (
            <>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {breakdown.map((dim: any, di: number) => {
                  const dimLabel = dim.label || dim.dimension || `Dim ${di + 1}`;
                  const pct = Math.min(100, Math.max(0, dim.score ?? 0));
                  const col = pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-400';
                  return (
                    <div key={dimLabel} className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] text-gray-500 truncate shrink-0" style={{ width: 90 }}>{dimLabel}</span>
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full ${col} rounded-full`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] font-bold text-gray-600 w-5 text-right shrink-0">{dim.score}</span>
                    </div>
                  );
                })}
              </div>
              {score.summary && (
                <p className="text-[10px] text-gray-400 mt-2 pt-2 border-t border-gray-50 leading-relaxed line-clamp-2">{score.summary}</p>
              )}
            </>
          ) : scoringFilter === selectedFilter ? (
            <div className="flex flex-col items-center justify-center py-4 gap-2">
              <Loader2 className="w-5 h-5 text-violet-500 animate-spin" />
              <p className="text-xs text-gray-500">Scoring candidates…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-4 gap-2">
              <p className="text-xs text-gray-400 text-center">
                No scores for <span className="font-semibold">{SCORE_FILTERS.find(f => f.key === selectedFilter)?.label || selectedFilter}</span>
              </p>
              {scoreError && <p className="text-[10px] text-red-400 text-center">{scoreError}</p>}
              <button onClick={() => scoreNow(selectedFilter)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-xs font-medium rounded-lg hover:bg-violet-700 transition-colors">
                <Sparkles className="w-3 h-3" />Score Now
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Render each PDF page to a base64 PNG — used for vision-based text extraction
async function renderPdfPages(fileData: string): Promise<string[]> {
  const b64 = fileData.includes(',') ? fileData.split(',')[1] : fileData;
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const pdf = await getDocument({ data: bytes }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
    pages.push(canvas.toDataURL('image/png'));
  }
  return pages;
}

// ─── PDF viewer with zoom, download, and text extraction ─────────────────────

function PdfViewer({ fileData, cvName, onTextExtracted }: {
  fileData: string;
  cvName?: string;
  onTextExtracted?: (text: string) => void;
}) {
  const [pages, setPages] = useState<string[]>([]);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setPdfLoading(true);
    setPdfError(null);
    setPages([]);

    (async () => {
      try {
        const b64 = fileData.includes(',') ? fileData.split(',')[1] : fileData;
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const pdf = await getDocument({ data: bytes }).promise;
        const urls: string[] = [];
        const textParts: string[] = [];

        for (let p = 1; p <= pdf.numPages; p++) {
          if (cancelled) return;
          const page = await pdf.getPage(p);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
          urls.push(canvas.toDataURL('image/png'));

          // Extract text from this page while the PDF is already open
          const tc = await page.getTextContent();
          let line = '';
          const lines: string[] = [];
          for (const item of tc.items as any[]) {
            if (typeof item.str !== 'string') continue;
            line += item.str;
            if (item.hasEOL) { lines.push(line.trimEnd()); line = ''; }
          }
          if (line.trim()) lines.push(line.trimEnd());
          textParts.push(lines.filter(l => l.trim()).join('\n'));
        }

        if (!cancelled) {
          setPages(urls);
          setPdfLoading(false);
          onTextExtracted?.(textParts.join('\n\n').trim());
        }
      } catch (err: any) {
        if (!cancelled) { setPdfError(err.message || 'Failed to render PDF'); setPdfLoading(false); }
      }
    })();

    return () => { cancelled = true; };
  }, [fileData]);

  const handleDownload = () => {
    const b64 = fileData.includes(',') ? fileData.split(',')[1] : fileData;
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cvName || 'cv'}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (pdfLoading) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-xs">Rendering PDF…</span>
      </div>
    );
  }
  if (pdfError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-4 gap-1">
        <AlertCircle className="w-5 h-5 text-red-300" />
        <p className="text-xs text-red-400 text-center">{pdfError}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-200 bg-gray-50 shrink-0">
        <button onClick={() => setScale(s => Math.max(0.5, +((s - 0.25).toFixed(2))))}
          className="p-1 rounded hover:bg-gray-200 text-gray-500 transition-colors" title="Zoom out">
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <span className="text-[10px] text-gray-500 w-9 text-center tabular-nums select-none">
          {Math.round(scale * 100)}%
        </span>
        <button onClick={() => setScale(s => Math.min(3, +((s + 0.25).toFixed(2))))}
          className="p-1 rounded hover:bg-gray-200 text-gray-500 transition-colors" title="Zoom in">
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => setScale(1)}
          className="px-1.5 py-0.5 text-[10px] text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors">
          Reset
        </button>
        <div className="flex-1" />
        <button onClick={handleDownload}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-200 rounded transition-colors">
          <Download className="w-3 h-3" />Download
        </button>
      </div>
      {/* Scrollable pages */}
      <div className="flex-1 overflow-auto bg-gray-300 py-3 px-2">
        <div style={{ width: scale <= 1 ? '100%' : `${scale * 100}%` }}>
          {pages.map((url, i) => (
            <img key={i} src={url} alt={`Page ${i + 1}`} className="block w-full mx-auto mb-3 shadow-md" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── CV Viewer Panel ──────────────────────────────────────────────────────────

interface EvidenceHighlight { category: string; text: string; keywords: string[] }

const CATEGORY_STYLE: Record<string, { bg: string; border: string; pill: string }> = {
  'Technical Skills':   { bg: '#dbeafe88', border: '#3b82f6', pill: 'bg-blue-100 text-blue-700 border-blue-200' },
  'Leadership':         { bg: '#f3e8ff88', border: '#9333ea', pill: 'bg-purple-100 text-purple-700 border-purple-200' },
  'Communication':      { bg: '#dcfce788', border: '#16a34a', pill: 'bg-green-100 text-green-700 border-green-200' },
  'Education':          { bg: '#fef9c388', border: '#ca8a04', pill: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  'Work Experience':    { bg: '#ffedd588', border: '#ea580c', pill: 'bg-orange-100 text-orange-700 border-orange-200' },
  'Certifications':     { bg: '#fce7f388', border: '#db2777', pill: 'bg-pink-100 text-pink-700 border-pink-200' },
  'Project Experience': { bg: '#e0f2fe88', border: '#0284c7', pill: 'bg-sky-100 text-sky-700 border-sky-200' },
};
const DEFAULT_STYLE = { bg: '#fef08a88', border: '#f59e0b', pill: 'bg-amber-100 text-amber-700 border-amber-200' };

function getCategoryStyle(cat: string) {
  return CATEGORY_STYLE[cat] ?? DEFAULT_STYLE;
}

// Build annotated segments from evidence highlights — longest match first
function buildSegments(content: string, highlights: EvidenceHighlight[]) {
  type Seg = { text: string; category: string | null };
  if (!highlights.length || !content) return [{ text: content, category: null }] as Seg[];

  // Collect all unique phrases (text snippets + keywords), sorted longest first
  const phrases: { phrase: string; category: string }[] = [];
  for (const h of highlights) {
    phrases.push({ phrase: h.text, category: h.category });
    for (const kw of h.keywords) phrases.push({ phrase: kw, category: h.category });
  }
  phrases.sort((a, b) => b.phrase.length - a.phrase.length);

  const result: Seg[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    let bestIdx = remaining.length;
    let bestLen = 0;
    let bestCat = '';

    for (const { phrase, category } of phrases) {
      if (!phrase.trim()) continue;
      const idx = remaining.toLowerCase().indexOf(phrase.toLowerCase());
      if (idx !== -1 && (idx < bestIdx || (idx === bestIdx && phrase.length > bestLen))) {
        bestIdx = idx; bestLen = phrase.length; bestCat = category;
      }
    }

    if (bestLen > 0) {
      if (bestIdx > 0) result.push({ text: remaining.slice(0, bestIdx), category: null });
      result.push({ text: remaining.slice(bestIdx, bestIdx + bestLen), category: bestCat });
      remaining = remaining.slice(bestIdx + bestLen);
    } else {
      result.push({ text: remaining, category: null });
      break;
    }
  }
  return result;
}

function CvViewer({ cvs, onClose }: {
  cvs: CV[]; onClose: () => void;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [viewMode, setViewMode] = useState<'pdf' | 'text'>('pdf');
  const [pdfText, setPdfText] = useState('');
  // Evidence from AI Evidence Locator
  const [highlights, setHighlights] = useState<EvidenceHighlight[]>([]);
  const [highlightOn, setHighlightOn] = useState(false);
  const [highlightLoading, setHighlightLoading] = useState(false);
  const [highlightError, setHighlightError] = useState<string | null>(null);
  const [textExtracting, setTextExtracting] = useState(false);

  const activeCv = cvs[Math.min(activeIdx, cvs.length - 1)];
  const hasPdf = !!(activeCv?.type === 'pdf' && activeCv?.fileData);
  const content = activeCv?.content?.trim() || pdfText;

  // Reset when switching candidates
  useEffect(() => {
    setViewMode(hasPdf ? 'pdf' : 'text');
    setHighlightOn(false);
    setHighlights([]);
    setPdfText('');
    setTextExtracting(false);
  }, [activeIdx, hasPdf]);


  const handleHighlight = useCallback(async () => {
    if (highlightOn) { setHighlightOn(false); return; }

    setViewMode('text');

    if (highlights.length > 0) { setHighlightOn(true); return; }

    setHighlightLoading(true);
    setHighlightError(null);
    try {
      // Step 1: get text — cached, then server extraction, then vision OCR fallback
      let text = activeCv?.content?.trim() || pdfText;

      if (!text && activeCv?.fileData) {
        // Try server-side text extraction first
        const extractRes = await fetch('/api/extract-pdf-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileData: activeCv.fileData }),
        });
        const extractData = await extractRes.json();
        text = extractData.text?.trim() || '';
      }

      if (!text && activeCv?.fileData) {
        // PDF has no text layer — render pages and use Claude vision OCR
        setHighlightError('No text layer found — using vision OCR…');
        const pages = await renderPdfPages(activeCv.fileData);
        const visionRes = await fetch('/api/extract-pdf-text-vision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pages }),
        });
        const visionData = await visionRes.json();
        text = visionData.text?.trim() || '';
        setHighlightError(null);
      }

      if (!text) {
        setHighlightError('Could not extract text from this CV.');
        return;
      }

      if (text !== pdfText) setPdfText(text);

      // Step 2: locate evidence
      const res = await fetch('/api/locate-evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cvText: text }),
      });
      const data = await res.json();
      setHighlights(data.highlights || []);
      setHighlightOn(true);
    } catch (err: any) {
      setHighlightError('Could not locate evidence');
    } finally {
      setHighlightLoading(false);
    }
  }, [highlightOn, highlights, activeCv, pdfText]);

  const segments = useMemo(
    () => highlightOn ? buildSegments(content, highlights) : [{ text: content, category: null }],
    [content, highlights, highlightOn]
  );

  const categories = useMemo(
    () => [...new Set(highlights.map(h => h.category))],
    [highlights]
  );

  return (
    <div className="w-[380px] shrink-0 flex flex-col border-l border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-gray-50 shrink-0">
        <FileText className="w-3.5 h-3.5 text-gray-500 shrink-0" />
        <span className="text-xs font-bold text-gray-700">Original CV</span>
        {cvs.length > 1 && <span className="text-xs text-gray-400">· {cvs.length}</span>}
        <div className="ml-auto flex items-center gap-1">
          {hasPdf && (
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              <button onClick={() => setViewMode('pdf')}
                className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${viewMode === 'pdf' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                PDF
              </button>
              <button onClick={() => setViewMode('text')}
                className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${viewMode === 'text' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                Text
              </button>
            </div>
          )}
          <button onClick={handleHighlight} disabled={highlightLoading}
            className={`flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-lg border transition-colors disabled:opacity-60 ${
              highlightOn ? 'bg-amber-400 text-white border-amber-400' : 'text-gray-500 border-gray-200 hover:bg-gray-50'
            }`}>
            {highlightLoading
              ? <><Loader2 className="w-3 h-3 animate-spin" />Locating…</>
              : highlightOn ? `✓ ${highlights.length} refs` : 'Highlight'}
          </button>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors ml-0.5">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Candidate tabs */}
      {cvs.length > 1 && (
        <div className="flex border-b border-gray-100 overflow-x-auto shrink-0 bg-white">
          {cvs.map((cv, i) => (
            <button key={cv.id} onClick={() => setActiveIdx(i)}
              className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                i === activeIdx ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}>
              {cv.name.split(' ')[0]}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
        {viewMode === 'pdf' && hasPdf ? (
          <PdfViewer
            key={activeCv!.id}
            fileData={activeCv!.fileData!}
            cvName={activeCv!.name}
          />
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* Category legend */}
            {highlightOn && categories.length > 0 && (
              <div className="px-3 pt-3 pb-2 flex flex-wrap gap-1 border-b border-gray-100 bg-gray-50/80">
                {categories.map(cat => {
                  const s = getCategoryStyle(cat);
                  return (
                    <span key={cat} className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${s.pill}`}>
                      {cat}
                    </span>
                  );
                })}
              </div>
            )}
            {highlightError && (
              <p className="text-[10px] text-red-400 px-4 pt-2">{highlightError}</p>
            )}
            {!content ? (
              <div className="text-center py-8">
                {textExtracting ? (
                  <>
                    <Loader2 className="w-6 h-6 text-gray-300 mx-auto mb-2 animate-spin" />
                    <p className="text-xs text-gray-400">Extracting text…</p>
                  </>
                ) : hasPdf ? (
                  <>
                    <FileText className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                    <p className="text-xs text-gray-400 italic">Click Highlight to extract and display text.</p>
                  </>
                ) : (
                  <>
                    <FileText className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                    <p className="text-xs text-gray-400 italic">No text content available.</p>
                    <p className="text-[10px] text-gray-300 mt-1">Re-upload this PDF to restore it.</p>
                  </>
                )}
              </div>
            ) : (
              <pre className="text-[11px] text-gray-700 whitespace-pre-wrap font-mono leading-relaxed break-words p-4">
                {segments.map((seg, i) => {
                  if (!seg.category) return <span key={i}>{seg.text}</span>;
                  const s = getCategoryStyle(seg.category);
                  return (
                    <mark key={i} title={seg.category}
                      style={{ background: s.bg, borderBottom: `2px solid ${s.border}`, borderRadius: 2, cursor: 'default' }}>
                      {seg.text}
                    </mark>
                  );
                })}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-gray-100 bg-gray-50 shrink-0">
        <p className="text-[10px] text-gray-400">
          {activeCv?.type === 'pdf'
            ? hasPdf ? 'PDF' : 'PDF (text only)'
            : activeCv?.type === 'linkedin' ? 'LinkedIn' : 'Text CV'}
          {content && ` · ${content.length.toLocaleString()} chars`}
        </p>
      </div>
    </div>
  );
}

// ─── Similarity search (semantic) ────────────────────────────────────────────

function isQuestionLike(q: string): boolean {
  const lower = q.toLowerCase().trim();
  return (
    lower.endsWith('?') ||
    /^(who|what|which|why|how|when|where|is|are|can|could|should|would|does|did)\b/.test(lower) ||
    /\b(best|most|least|worst|better|more|top|strongest|weakest|highest|lowest|compare|versus|vs|suitable|fit|recommend|suitable|ideal|perfect)\b/.test(lower)
  );
}

function SimilaritySearch({ result }: { result: string }) {
  const [query, setQuery] = useState('');
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  const searchTerms = useMemo(() => buildSearchTerms(query), [query]);

  const isConceptExpanded = useMemo(() => {
    if (!query.trim()) return false;
    const rawWords = query.toLowerCase().split(/\s+/).filter(Boolean);
    return searchTerms.length > rawWords.length;
  }, [query, searchTerms]);

  const candidates = useMemo(() => {
    const found = new Set<string>();
    for (const re of [
      /^##\s+Candidate[:\s]+([^\n#*]{2,40})/gm,
      /^###\s+([A-Z][A-Za-z\s]{1,35}?)(?:\s*[-–(]|\s*$)/gm,
    ]) {
      let m;
      while ((m = re.exec(result)) !== null) {
        const n = m[1].trim().replace(/[*_]/g, '');
        if (n.length > 1 && n.length < 40) found.add(n);
      }
    }
    return [...found].slice(0, 8);
  }, [result]);

  const keywords = useMemo(() => {
    const freq = new Map<string, number>();
    const re = /\*\*([A-Za-z][A-Za-z.#+\s]{1,22}?)\*\*/g;
    let m;
    while ((m = re.exec(result)) !== null) {
      const w = m[1].trim();
      if (w.length >= 2 && w.length <= 25 && !/^\d/.test(w) && !w.includes(':') && !/score|rank|match|%/i.test(w))
        freq.set(w, (freq.get(w) || 0) + 1);
    }
    return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w]) => w);
  }, [result]);

  const { filtered, matchCount } = useMemo(() => {
    if (!query.trim()) return { filtered: result, matchCount: 0 };
    const secs = result.split(/(?=^## )/m);
    const scored = secs.map(sec => ({ sec, score: scoreSectionByTerms(sec, searchTerms) }));
    const matching = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score);
    const total = matching.reduce((acc, s) => acc + s.score, 0);
    if (!matching.length) {
      return { filtered: `> No results found for "${query}" — try AI search above for broader questions\n\n${result}`, matchCount: 0 };
    }
    return { filtered: matching.map(s => s.sec).join('\n\n'), matchCount: total };
  }, [result, query, searchTerms]);

  const showAiButton = query.trim().length >= 4 && (isQuestionLike(query) || matchCount === 0);

  const toggle = (v: string) => {
    setAiAnswer('');
    setAiError('');
    setQuery(q => q === v ? '' : v);
  };

  const handleQueryChange = (val: string) => {
    setQuery(val);
    if (!val.trim()) { setAiAnswer(''); setAiError(''); }
  };

  const askAI = async () => {
    if (!query.trim()) return;
    setAiLoading(true);
    setAiAnswer('');
    setAiError('');
    try {
      const resp = await fetch('/api/search-similarity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, analysisText: result }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || 'AI search failed');
      setAiAnswer(data.answer);
    } catch (e: any) {
      setAiError(e.message || 'AI search failed');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div>
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={e => handleQueryChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && showAiButton) askAI(); }}
          placeholder="Search keywords, or ask a question like 'who is best for a startup?'"
          className="w-full pl-10 pr-9 py-2.5 text-sm bg-white border border-gray-200 rounded-xl focus:border-gray-900 focus:ring-1 focus:ring-gray-900 outline-none shadow-sm"
        />
        {query && (
          <button onClick={() => { handleQueryChange(''); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* AI search bar */}
      {showAiButton && (
        <div className="mb-3">
          <button
            onClick={askAI}
            disabled={aiLoading}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl bg-violet-600 hover:bg-violet-700 text-white transition-all disabled:opacity-60 shadow-sm"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {aiLoading ? 'Asking AI…' : 'Ask AI'}
          </button>
        </div>
      )}

      {/* AI answer */}
      {aiAnswer && (
        <div className="mb-5 p-4 rounded-xl bg-violet-50 border border-violet-200">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-violet-600" />
            <span className="text-xs font-bold text-violet-700 uppercase tracking-wide">AI Answer</span>
          </div>
          <p className="text-sm text-gray-800 leading-relaxed">{aiAnswer}</p>
        </div>
      )}
      {aiError && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-600">{aiError}</div>
      )}

      {query && !aiAnswer && (
        <div className="mb-3 flex items-center flex-wrap gap-2">
          {matchCount > 0 ? (
            <p className="text-xs text-gray-500">
              <span className="font-bold text-gray-800">{matchCount}</span> relevant mentions
              {isConceptExpanded && (
                <span className="ml-1.5 px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-[10px] font-semibold border border-blue-100">
                  concepts expanded
                </span>
              )}
            </p>
          ) : (
            <p className="text-xs text-red-400">No results — try broader terms or Ask AI above</p>
          )}
        </div>
      )}

      {candidates.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-1.5 mb-2">
            <User className="w-3 h-3 text-gray-400" />
            <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase">Candidates</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {candidates.map(n => (
              <button key={n} onClick={() => toggle(n)}
                className={`px-3 py-1 text-xs rounded-full border font-medium transition-all ${
                  query === n ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-500'
                }`}>
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {keywords.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-1.5 mb-2">
            <Tag className="w-3 h-3 text-gray-400" />
            <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase">Keywords</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {keywords.map(kw => (
              <button key={kw} onClick={() => toggle(kw)}
                className={`px-2.5 py-0.5 text-[11px] rounded-full border transition-all ${
                  query === kw ? 'bg-black text-white border-black' : 'bg-gray-50 text-gray-500 border-gray-200 hover:border-gray-400'
                }`}>
                {kw}
              </button>
            ))}
          </div>
        </div>
      )}

      <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{filtered}</Markdown>
    </div>
  );
}

// ─── Markdown components ──────────────────────────────────────────────────────

const tdStyle: React.CSSProperties = { padding: '11px 16px', fontSize: '13px', color: '#374151', verticalAlign: 'top', borderRight: '1px solid #f3f4f6', lineHeight: '1.55', wordBreak: 'break-word' };
const thStyle: React.CSSProperties = { padding: '11px 16px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: '#e5e7eb', textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap', borderRight: '1px solid rgba(255,255,255,0.1)' };

const mdComponents: Record<string, React.ComponentType<any>> = {
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', margin: '20px 0', borderRadius: '12px', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'auto' }}>{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead style={{ background: 'linear-gradient(90deg,#111827 0%,#1f2937 100%)' }}>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr:    ({ children }) => <tr style={{ borderBottom: '1px solid #f3f4f6' }} className="even:bg-gray-50/50 hover:bg-indigo-50/30 transition-colors">{children}</tr>,
  th:    ({ children }) => <th style={thStyle}>{children}</th>,
  td:    ({ children }) => <td style={tdStyle}>{children}</td>,
  blockquote: ({ children }) => (
    <div className="my-5 flex gap-3 p-4 bg-indigo-50 border border-indigo-200 rounded-xl">
      <span className="w-1 shrink-0 bg-indigo-500 rounded-full self-stretch" />
      <div className="text-sm text-indigo-900 font-medium leading-relaxed [&>p]:m-0">{children}</div>
    </div>
  ),
  h1: ({ children }) => <h1 className="text-xl font-bold text-gray-900 mt-6 mb-4 first:mt-0">{children}</h1>,
  h2: ({ children }) => (
    <h2 className="flex items-center gap-2.5 text-base font-bold text-gray-900 mt-8 mb-3 pt-6 border-t border-gray-100 first:border-0 first:pt-0 first:mt-0">
      <span className="w-1 h-5 bg-black rounded-sm shrink-0" />{children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="flex items-center gap-1.5 text-sm font-bold text-gray-800 mt-5 mb-2">
      <span className="w-2 h-2 rounded-full bg-gray-400 shrink-0" />{children}
    </h3>
  ),
  h4:     ({ children }) => <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mt-4 mb-1.5">{children}</h4>,
  ul:     ({ children }) => <ul className="my-3 pl-5 space-y-1.5 list-disc marker:text-gray-300">{children}</ul>,
  ol:     ({ children }) => <ol className="my-3 pl-5 space-y-1.5 list-decimal marker:text-gray-400">{children}</ol>,
  li:     ({ children }) => <li className="text-sm text-gray-700 leading-relaxed [&>p]:m-0">{children}</li>,
  p:      ({ children }) => <p className="text-sm text-gray-700 leading-relaxed my-2 first:mt-0 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
  em:     ({ children }) => <em className="italic text-gray-600">{children}</em>,
  hr:     () => <hr className="my-6 border-gray-200" />,
  code: ({ children, className }: any) =>
    className?.startsWith('language-')
      ? <pre className="text-xs font-mono bg-gray-900 text-gray-100 p-4 rounded-xl overflow-x-auto my-4"><code>{children}</code></pre>
      : <code className="text-xs font-mono bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded">{children}</code>,
};

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handle = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };
  return (
    <button onClick={handle} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 border border-transparent hover:border-gray-200 transition-all">
      {copied
        ? <><Check className="w-3.5 h-3.5 text-emerald-500" /><span className="text-emerald-600 font-medium">Copied</span></>
        : <><Copy className="w-3.5 h-3.5" /><span>Copy</span></>}
    </button>
  );
}

// ─── Team Optimization View ───────────────────────────────────────────────────

interface TODepartmentFit { [dept: string]: number }
interface TOTopDept { name: string; score: number; reason: string }
interface TOCandidate {
  name: string;
  personalityType: string;
  personalityTraits: string[];
  communicationStyle: string;
  leadershipTendency: string;
  workStyle: string;
  coreStrengths: string[];
  departmentFit: TODepartmentFit;
  topDepartments: TOTopDept[];
  suggestedTeamRole: string;
}
interface TOTeamMember { candidateName: string; assignedRole: string; whyThisRole: string; keyContribution: string }
interface TOTeamAnalysis {
  teamBalance: number; synergyScore: number; compositionSummary: string;
  members: TOTeamMember[]; teamStrengths: string[]; teamGaps: string[];
  potentialChallenges: string[]; overallRecommendation: string;
}
interface TOReport { candidates: TOCandidate[]; teamAnalysis: TOTeamAnalysis | null }

function toLeaderBadge(t: string) {
  const map: Record<string, string> = {
    'Natural Leader':            'bg-orange-100 text-orange-800 border-orange-200',
    'Strategic Coordinator':     'bg-blue-100   text-blue-800   border-blue-200',
    'Deep Specialist':           'bg-purple-100 text-purple-800 border-purple-200',
    'Collaborative Team Player': 'bg-green-100  text-green-800  border-green-200',
  };
  return map[t] ?? 'bg-gray-100 text-gray-700 border-gray-200';
}
function toScoreColor(s: number) { return s >= 70 ? 'bg-emerald-500' : s >= 45 ? 'bg-amber-400' : 'bg-gray-300'; }

function TOScoreRing({ value, size = 72 }: { value: number; size?: number }) {
  const r = size / 2 - 6, circ = 2 * Math.PI * r;
  const dash = ((value ?? 0) / 100) * circ;
  const color = value >= 80 ? '#10b981' : value >= 60 ? '#f59e0b' : '#6b7280';
  return (
    <svg width={size} height={size} className="rotate-[-90deg]">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={6} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={6}
        strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round" />
    </svg>
  );
}

function TOTraitBadge({ trait }: { trait: string }) {
  const t = trait.toLowerCase();
  const cls = t.includes('lead') || t.includes('decisive') || t.includes('strateg')
    ? 'bg-orange-50 text-orange-700 border-orange-200'
    : t.includes('creat') || t.includes('innovat') || t.includes('vision')
    ? 'bg-purple-50 text-purple-700 border-purple-200'
    : t.includes('empat') || t.includes('collab') || t.includes('support')
    ? 'bg-green-50 text-green-700 border-green-200'
    : t.includes('analyt') || t.includes('data') || t.includes('detail') || t.includes('systematic')
    ? 'bg-blue-50 text-blue-700 border-blue-200'
    : 'bg-gray-50 text-gray-600 border-gray-200';
  return <span className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded-full border ${cls}`}>{trait}</span>;
}

function TODeptBar({ name, score }: { name: string; score: number }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-40 text-gray-600 truncate shrink-0">{name}</span>
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${toScoreColor(score)}`} style={{ width: `${score}%` }} />
      </div>
      <span className="w-7 text-right font-semibold text-gray-700">{score}</span>
    </div>
  );
}

function TOCandidateCard({ profile, avatarColor }: { profile: TOCandidate; avatarColor: string }) {
  const [expanded, setExpanded] = useState(false);
  const topDepts = profile.topDepartments?.slice(0, 3) ?? [];
  const allDepts = Object.entries(profile.departmentFit ?? {}).sort(([,a],[,b]) => b - a);
  const initials = profile.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4 hover:border-gray-300 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full ${avatarColor} text-white flex items-center justify-center text-sm font-bold shrink-0`}>
            {initials}
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">{profile.name}</h3>
            <p className="text-xs text-indigo-600 font-medium mt-0.5">{profile.personalityType}</p>
          </div>
        </div>
        <span className={`text-[10px] font-semibold px-2 py-1 rounded-full border whitespace-nowrap shrink-0 ${toLeaderBadge(profile.leadershipTendency)}`}>
          {profile.leadershipTendency}
        </span>
      </div>

      {/* Traits */}
      <div className="flex flex-wrap gap-1">
        {(profile.personalityTraits ?? []).map(t => <TOTraitBadge key={t} trait={t} />)}
      </div>

      {/* Style + Work */}
      <div className="space-y-1.5 bg-gray-50 rounded-lg px-3 py-2.5">
        <div className="flex items-start gap-1.5 text-[11px] text-gray-700">
          <span className="text-gray-400 font-semibold shrink-0 w-20">Comm Style:</span>
          <span>{profile.communicationStyle}</span>
        </div>
        <div className="flex items-start gap-1.5 text-[11px] text-gray-700">
          <span className="text-gray-400 font-semibold shrink-0 w-20">Work Style:</span>
          <span>{profile.workStyle}</span>
        </div>
      </div>

      {/* Strengths */}
      <div>
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Core Strengths</p>
        <div className="flex flex-wrap gap-1">
          {(profile.coreStrengths ?? []).map(s => (
            <span key={s} className="text-[10px] bg-gray-100 text-gray-700 px-2 py-0.5 rounded-md">{s}</span>
          ))}
        </div>
      </div>

      {/* Suggested role */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
        <p className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wide">Suggested Team Role</p>
        <p className="text-xs font-semibold text-indigo-800 mt-0.5">{profile.suggestedTeamRole}</p>
      </div>

      {/* Dept fit */}
      <div>
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Department Fit</p>
        <div className="space-y-2">
          {topDepts.map(d => (
            <div key={d.name}>
              <TODeptBar name={d.name} score={d.score} />
              <p className="text-[10px] text-gray-400 mt-0.5 ml-[168px] leading-snug">{d.reason}</p>
            </div>
          ))}
        </div>
        {allDepts.length > 3 && (
          <button onClick={() => setExpanded(e => !e)}
            className="mt-2 text-[10px] text-indigo-500 hover:text-indigo-700 font-medium flex items-center gap-1">
            <span className={`inline-block transition-transform ${expanded ? 'rotate-90' : ''}`}>›</span>
            {expanded ? 'Show less' : `Show all ${allDepts.length} departments`}
          </button>
        )}
        {expanded && (
          <div className="mt-2 space-y-1.5 border-t border-gray-100 pt-2">
            {allDepts.slice(3).map(([name, score]) => <TODeptBar key={name} name={name} score={score} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function TOTeamView({ analysis }: { analysis: TOTeamAnalysis }) {
  const synergy = analysis.synergyScore ?? 0;
  const balance = analysis.teamBalance ?? 0;
  return (
    <div className="space-y-6">
      {/* Score rings */}
      <div className="grid grid-cols-2 gap-4">
        {[
          { label: 'Team Synergy', val: synergy, desc: synergy >= 80 ? 'Excellent chemistry' : synergy >= 60 ? 'Good compatibility' : 'Some friction expected' },
          { label: 'Team Balance', val: balance, desc: balance >= 80 ? 'Well-rounded team' : balance >= 60 ? 'Mostly balanced' : 'Notable skill gaps' },
        ].map(({ label, val, desc }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-4">
            <div className="relative shrink-0">
              <TOScoreRing value={val} size={72} />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-black text-gray-900">{val}</span>
              </div>
            </div>
            <div>
              <p className="text-xs font-bold text-gray-900">{label}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Composition summary */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
        <p className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wide mb-1">Team Character</p>
        <p className="text-sm text-indigo-900 leading-relaxed">{analysis.compositionSummary}</p>
      </div>

      {/* Role assignments */}
      <div>
        <p className="text-xs font-bold text-gray-900 mb-3">Role Assignments</p>
        <div className="space-y-2">
          {(analysis.members ?? []).map(m => (
            <div key={m.candidateName} className="bg-white border border-gray-200 rounded-lg p-3 grid grid-cols-[1fr_1fr_1.5fr] gap-3 text-[11px]">
              <div><p className="text-[10px] text-gray-400 font-medium">Candidate</p><p className="font-bold text-gray-900 mt-0.5">{m.candidateName}</p></div>
              <div><p className="text-[10px] text-gray-400 font-medium">Assigned Role</p><p className="font-semibold text-indigo-700 mt-0.5">{m.assignedRole}</p></div>
              <div>
                <p className="text-[10px] text-gray-400 font-medium">Key Contribution</p>
                <p className="text-gray-600 mt-0.5 leading-snug">{m.keyContribution}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Strengths & Gaps */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
          <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wide mb-2">Team Strengths</p>
          <ul className="space-y-1">
            {(analysis.teamStrengths ?? []).map(s => (
              <li key={s} className="flex items-start gap-1.5 text-[11px] text-emerald-800">
                <span className="text-emerald-500 mt-0.5 shrink-0">✓</span> {s}
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
          <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide mb-2">Gaps to Address</p>
          <ul className="space-y-1">
            {(analysis.teamGaps ?? []).map(g => (
              <li key={g} className="flex items-start gap-1.5 text-[11px] text-amber-800">
                <span className="text-amber-500 mt-0.5 shrink-0">△</span> {g}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Challenges */}
      {(analysis.potentialChallenges ?? []).length > 0 && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-3">
          <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wide mb-2">Potential Challenges</p>
          <ul className="space-y-1">
            {analysis.potentialChallenges.map(c => (
              <li key={c} className="text-[11px] text-red-700 flex items-start gap-1.5">
                <span className="shrink-0 mt-0.5">⚠</span> {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recommendation */}
      <div className="bg-gray-900 rounded-xl p-4">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">AI Recommendation</p>
        <p className="text-sm text-white leading-relaxed">{analysis.overallRecommendation}</p>
      </div>
    </div>
  );
}

function TeamOptimizationView({ result }: { result: string }) {
  const [activeTab, setActiveTab] = useState<'individual' | 'team'>('individual');

  const report = useMemo((): TOReport | null => {
    try {
      const cleaned = result
        .replace(/^```json\s*/i, '').replace(/```\s*$/i, '')
        .replace(/^```\s*/i, '').trim();
      const parsed = JSON.parse(cleaned);
      if (parsed?.candidates && Array.isArray(parsed.candidates)) return parsed as TOReport;
    } catch {}
    return null;
  }, [result]);

  if (!report) {
    return <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{result}</Markdown>;
  }

  const hasTeam = !!report.teamAnalysis;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-gray-900">Team Formation Intelligence</h2>
          <p className="text-xs text-gray-400 mt-0.5">Department fit · Personality profiling · Team composition</p>
        </div>
        <span className="text-xs text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
          {report.candidates.length} candidate{report.candidates.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Tabs */}
      {hasTeam && (
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          <button
            onClick={() => setActiveTab('individual')}
            className={`text-xs font-medium px-4 py-2 rounded-lg transition-all ${activeTab === 'individual' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Individual Profiles ({report.candidates.length})
          </button>
          <button
            onClick={() => setActiveTab('team')}
            className={`text-xs font-medium px-4 py-2 rounded-lg transition-all ${activeTab === 'team' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Team Formation
            {report.teamAnalysis && (
              <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white ${report.teamAnalysis.synergyScore >= 70 ? 'bg-emerald-500' : report.teamAnalysis.synergyScore >= 50 ? 'bg-amber-400' : 'bg-gray-400'}`}>
                {report.teamAnalysis.synergyScore}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Content */}
      {activeTab === 'individual' ? (
        <div className="grid grid-cols-1 gap-4">
          {report.candidates.map((c, i) => (
            <TOCandidateCard key={c.name} profile={c} avatarColor={AVATAR_COLORS[i % AVATAR_COLORS.length]} />
          ))}
        </div>
      ) : (
        report.teamAnalysis && <TOTeamView analysis={report.teamAnalysis} />
      )}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function AnalysisResults({
  loading, error, result, activeModule, onRetry,
  cvs, allScores, activeFilter, jobDescription, managerNotes,
  showCvPanel, onCloseCvPanel,
  showScorePanel, onCloseScorePanel,
}: AnalysisResultsProps) {
  const msg = LOADING_MESSAGES[activeModule];

  const candidates = useMemo(() => parseCandidates(result || ''), [result]);
  const isMulti    = candidates.length >= 2;

  const singleMindMap = useMemo(() => {
    if (!result || isMulti || activeModule === 'similarity' || activeModule === 'audit') return null;
    if (activeModule === 'snapshot') return parseSkillsMindMap(result);
    const center = MODULE_CENTERS[activeModule];
    return center ? parseGenericMindMap(result, center) : null;
  }, [result, activeModule, isMulti]);

  // For single-candidate: best score across all filters
  const singleScore = useMemo(() => {
    if (isMulti || !result || cvs.length === 0) return undefined;
    const cvId = cvs[0].id;
    const filterPriority = [activeFilter, 'all', ...Object.keys(allScores).filter(f => f !== activeFilter && f !== 'all')];
    for (const f of filterPriority) {
      const s = allScores[f]?.[cvId];
      if (s) return s;
    }
    return undefined;
  }, [isMulti, cvs, allScores, activeFilter, result]);

  const singleExternalMetrics = useMemo(() => {
    if (!singleScore?.breakdown) return undefined;
    return (singleScore.breakdown as any[])
      .map((d: any) => ({ label: (d.label || d.dimension || '').toString(), value: Number(d.score) || 0 }))
      .filter(m => m.label);
  }, [singleScore]);

  // Flat scores for the best available filter (used by MultiCandidateLayout)
  const flatScores = useMemo(() => {
    const filterPriority = [activeFilter, 'all', ...Object.keys(allScores).filter(f => f !== activeFilter && f !== 'all')];
    for (const f of filterPriority) {
      const fs = allScores[f];
      if (fs && cvs.some(cv => fs[cv.id])) return fs;
    }
    return {};
  }, [allScores, activeFilter, cvs]);

  const hasCvPanel    = showCvPanel && cvs.length > 0;
  const hasScorePanel = showScorePanel && cvs.length > 0;

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-500 h-full gap-4">
        <div className="w-14 h-14 rounded-full border-2 border-gray-100 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-black" />
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-gray-800">{msg.title}</p>
          <p className="text-xs mt-1 text-gray-400 max-w-xs">{msg.sub}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 h-full">
        <div className="bg-red-50 text-red-700 p-6 rounded-2xl border border-red-200 max-w-lg w-full">
          <div className="flex items-start gap-3 mb-4">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-500" />
            <div><h3 className="font-semibold text-sm">Analysis Failed</h3><p className="text-sm mt-1 text-red-600/80">{error}</p></div>
          </div>
          <button onClick={onRetry} className="flex items-center gap-2 text-sm font-medium text-red-700 hover:text-red-900 px-3 py-1.5 bg-red-100 hover:bg-red-200 rounded-lg transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 h-full">
        <p className="text-sm">Select a module from the sidebar to begin analysis.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {/* Score panel — slides from top as flex item */}
      {hasScorePanel && (
        <ScorePanel
          cvs={cvs}
          initialAllScores={allScores}
          defaultFilter={activeFilter}
          jobDescription={jobDescription}
          managerNotes={managerNotes}
          onClose={onCloseScorePanel}
        />
      )}

      {/* Content row: main content + optional CV panel */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* Main analysis content */}
        <div className="flex-1 overflow-y-auto bg-gray-50/50 min-w-0">
          <div className="max-w-4xl mx-auto p-8">
            <div className="flex justify-end items-center gap-2 mb-4">
              <CopyButton text={result} />
            </div>

            {!isMulti && activeModule !== 'similarity' && activeModule !== 'team_optimization' && activeModule !== 'ranking' && singleMindMap && (
              <MindMapDiagram data={singleMindMap} />
            )}

            <div className="bg-white border border-gray-200 p-8 rounded-2xl shadow-sm">
              {activeModule === 'team_optimization' ? (
                <TeamOptimizationView result={result} />
              ) : activeModule === 'similarity' ? (
                <SimilaritySearch result={result} />
              ) : activeModule === 'ranking' ? (
                // ranking is always a single cross-candidate document — never split into tabs
                <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{result}</Markdown>
              ) : isMulti ? (
                <MultiCandidateLayout result={result} activeModule={activeModule} scores={flatScores} />
              ) : (
                <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{result}</Markdown>
              )}
            </div>
          </div>
        </div>

        {/* CV viewer panel — slides in from right */}
        {hasCvPanel && (
          <CvViewer
            cvs={cvs}
            onClose={onCloseCvPanel}
          />
        )}
      </div>
    </div>
  );
}
