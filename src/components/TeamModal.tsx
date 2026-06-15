import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { X, Users, Loader2, ChevronRight, AlertCircle, Sparkles, SlidersHorizontal } from 'lucide-react';
import { CV } from '../types';

// ── Types ──────────────────────────────────────────────────────────────────────

interface TopDepartment { name: string; score: number; reason: string }

interface CandidateProfile {
  name: string;
  personalityType: string;
  personalityTraits: string[];
  communicationStyle: string;
  leadershipTendency: string;
  workStyle: string;
  coreStrengths: string[];
  departmentFit: Record<string, number>;
  topDepartments: TopDepartment[];
  suggestedTeamRole: string;
}

interface TeamMember {
  candidateName: string;
  assignedRole: string;
  whyThisRole: string;
  keyContribution: string;
}

interface OptimalGroup {
  members: string[];
  reason: string;
  synergyScore: number;
  balance: number;
  excluded: { name: string; reason: string }[];
}

interface TeamAnalysis {
  teamBalance: number;
  synergyScore: number;
  compositionSummary: string;
  members: TeamMember[];
  teamStrengths: string[];
  teamGaps: string[];
  potentialChallenges: string[];
  overallRecommendation: string;
  optimalGroup?: OptimalGroup | null;
}

interface TeamReport {
  candidates: CandidateProfile[];
  teamAnalysis: TeamAnalysis | null;
}

interface CustomEval {
  synergyScore: number;
  balance: number;
  summary: string;
  strengths: string[];
  gaps: string[];
  verdict: 'Strong' | 'Good' | 'Moderate' | 'Weak';
}

// ── Constants ──────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  'bg-violet-600', 'bg-blue-600', 'bg-emerald-600',
  'bg-amber-600',  'bg-rose-600', 'bg-cyan-600',
  'bg-purple-600', 'bg-teal-600',
];

const LEADER_COLORS: Record<string, string> = {
  'Natural Leader':            'bg-orange-100 text-orange-800 border-orange-200',
  'Strategic Coordinator':     'bg-blue-100   text-blue-800   border-blue-200',
  'Deep Specialist':           'bg-purple-100 text-purple-800 border-purple-200',
  'Collaborative Team Player': 'bg-green-100  text-green-800  border-green-200',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
}

function ringColor(s: number) {
  return s >= 70 ? '#10b981' : s >= 50 ? '#f59e0b' : '#9ca3af';
}

function barColor(s: number) {
  return s >= 70 ? 'bg-emerald-500' : s >= 45 ? 'bg-amber-400' : 'bg-gray-300';
}

function verdictStyle(v: string) {
  return v === 'Strong'   ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
    : v === 'Good'        ? 'bg-blue-100    text-blue-700    border-blue-200'
    : v === 'Moderate'    ? 'bg-amber-100   text-amber-700   border-amber-200'
    : 'bg-gray-100 text-gray-600 border-gray-200';
}

// ── ScoreRing ──────────────────────────────────────────────────────────────────

function ScoreRing({ value, size = 64 }: { value: number; size?: number }) {
  const r = size / 2 - 5;
  const circ = 2 * Math.PI * r;
  const dash = ((value ?? 0) / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={5} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ringColor(value)} strokeWidth={5}
        strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round" />
    </svg>
  );
}

function ScorePair({ synergy, balance, size = 64 }: { synergy: number; balance: number; size?: number }) {
  return (
    <div className="flex gap-8 justify-center">
      {[{ label: 'Synergy', val: synergy }, { label: 'Balance', val: balance }].map(({ label, val }) => (
        <div key={label} className="flex flex-col items-center gap-1.5">
          <div className="relative">
            <ScoreRing value={val} size={size} />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-base font-black text-gray-900">{val}</span>
            </div>
          </div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
        </div>
      ))}
    </div>
  );
}

// ── TeamArrangement ────────────────────────────────────────────────────────────
// Candidate squares that animate smoothly when a group is defined.
// In-group: cluster tightly together with indigo glow.
// Out-group: spread to the right, faded.

const CARD_W  = 64;
const TIGHT_G = 8;
const LOOSE_G = 22;
const SEP     = 44;

function computePositions(containerW: number, cvs: CV[], groupedNames: string[]): number[] {
  const n = cvs.length;
  if (n === 0) return [];

  if (groupedNames.length === 0) {
    // No grouping: evenly space
    const totalW = n * CARD_W + (n - 1) * TIGHT_G;
    const start = Math.max(8, (containerW - totalW) / 2);
    return cvs.map((_, i) => start + i * (CARD_W + TIGHT_G));
  }

  const inGroup  = cvs.filter(c => groupedNames.includes(c.name));
  const outGroup = cvs.filter(c => !groupedNames.includes(c.name));
  const inW  = inGroup.length  * CARD_W + Math.max(0, inGroup.length  - 1) * TIGHT_G;
  const outW = outGroup.length === 0 ? 0 : outGroup.length * CARD_W + Math.max(0, outGroup.length - 1) * LOOSE_G;
  const totalW = inW + (outGroup.length > 0 ? SEP + outW : 0);
  const start  = Math.max(8, (containerW - totalW) / 2);

  let ii = 0, oi = 0;
  return cvs.map(c =>
    groupedNames.includes(c.name)
      ? start + ii++ * (CARD_W + TIGHT_G)
      : start + inW + SEP + oi++ * (CARD_W + LOOSE_G)
  );
}

interface ArrangementProps {
  cvs: CV[];
  groupedNames: string[];     // names of cards that belong to the current group
  onToggle?: (name: string) => void;
  interactive?: boolean;
}

function TeamArrangement({ cvs, groupedNames, onToggle, interactive = false }: ArrangementProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions]   = useState<number[]>([]);
  const [animated,  setAnimated]    = useState(false);

  // Compute positions synchronously before paint
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setPositions(computePositions(Math.max(320, el.clientWidth), cvs, groupedNames));
  }, [cvs, groupedNames]);

  // Enable CSS transitions after initial paint so the first render doesn't jump-animate
  useEffect(() => {
    const id = setTimeout(() => setAnimated(true), 60);
    return () => clearTimeout(id);
  }, []);

  const hasGroup    = groupedNames.length > 0;
  const containerH  = 92;

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-visible"
      style={{ height: containerH }}
    >
      {cvs.map((cv, i) => {
        const inGrp = !hasGroup || groupedNames.includes(cv.name);
        const x = positions[i] ?? i * (CARD_W + TIGHT_G);

        return (
          <div
            key={cv.id}
            onClick={() => interactive && onToggle?.(cv.name)}
            style={{
              position:   'absolute',
              top:        0,
              left:       0,
              width:      CARD_W,
              transform:  `translateX(${x}px)`,
              opacity:    inGrp ? 1 : 0.28,
              zIndex:     inGrp ? 2 : 1,
              transition: animated
                ? 'transform 0.52s cubic-bezier(0.34,1.2,0.64,1), opacity 0.32s ease'
                : 'none',
              cursor:     interactive ? 'pointer' : 'default',
            }}
          >
            <div
              className={`flex flex-col items-center gap-1.5 py-2 px-1 rounded-xl border-2 select-none transition-colors duration-300 ${
                !hasGroup
                  ? 'border-gray-200 bg-white'
                  : inGrp
                  ? 'border-indigo-400 bg-indigo-50 shadow-md shadow-indigo-100'
                  : 'border-gray-100 bg-gray-50'
              } ${interactive ? (inGrp ? 'hover:border-indigo-500' : 'hover:opacity-60 hover:border-gray-300') : ''}`}
            >
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}
              >
                {initials(cv.name)}
              </div>
              <p
                className="text-[9px] font-semibold text-gray-700 text-center leading-tight truncate"
                style={{ width: CARD_W - 8 }}
              >
                {cv.name.split(' ')[0]}
              </p>
            </div>
            {/* In-group indicator dot */}
            {hasGroup && inGrp && (
              <div
                className="absolute -top-1 -right-1 w-3 h-3 bg-indigo-500 rounded-full border-2 border-white"
                style={{ transition: animated ? 'opacity 0.3s ease' : 'none' }}
              />
            )}
          </div>
        );
      })}

      {/* Dashed separator between in-group and out-group */}
      {hasGroup && groupedNames.length < cvs.length && positions.length === cvs.length && (() => {
        const lastInX = cvs.reduce((acc, c, i) =>
          groupedNames.includes(c.name) ? Math.max(acc, positions[i] ?? 0) : acc, 0);
        const sepX = lastInX + CARD_W + SEP / 2 - 1;
        return (
          <div
            style={{
              position:   'absolute',
              top:        8,
              left:       sepX,
              width:      1,
              height:     containerH - 16,
              background: 'repeating-linear-gradient(to bottom,#9ca3af 0,#9ca3af 4px,transparent 4px,transparent 8px)',
              opacity:    animated ? 0.35 : 0,
              transition: animated ? 'opacity 0.5s ease' : 'none',
            }}
          />
        );
      })()}
    </div>
  );
}

// ── LoadingBounce ──────────────────────────────────────────────────────────────

function LoadingBounce({ cvs }: { cvs: CV[] }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(k => k + 1), 550);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex items-center justify-center gap-2 py-4">
      {cvs.map((cv, i) => (
        <div
          key={cv.id}
          className="flex flex-col items-center gap-1.5 p-2 rounded-xl border-2 bg-white"
          style={{
            borderColor:    tick % cvs.length === i ? '#6366f1' : '#e5e7eb',
            backgroundColor: tick % cvs.length === i ? '#eef2ff' : 'white',
            transform: `translateY(${
              tick % 2 === 0 ? (i % 2 === 0 ? -5 : 5) : (i % 2 === 0 ? 5 : -5)
            }px) scale(${tick % cvs.length === i ? 1.1 : 0.94})`,
            transition: 'all 0.5s cubic-bezier(0.34,1.2,0.64,1)',
          }}
        >
          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}>
            {initials(cv.name)}
          </div>
          <p className="text-[9px] font-semibold text-gray-400">{cv.name.split(' ')[0]}</p>
        </div>
      ))}
    </div>
  );
}

// ── TraitBadge ────────────────────────────────────────────────────────────────

function TraitBadge({ trait }: { trait: string }) {
  const t = trait.toLowerCase();
  const cls = t.includes('lead') || t.includes('decisive') || t.includes('strateg')
    ? 'bg-orange-50 text-orange-700 border-orange-200'
    : t.includes('creat') || t.includes('innovat') || t.includes('vision')
    ? 'bg-purple-50 text-purple-700 border-purple-200'
    : t.includes('empat') || t.includes('collab') || t.includes('support')
    ? 'bg-green-50 text-green-700 border-green-200'
    : t.includes('analyt') || t.includes('data') || t.includes('detail')
    ? 'bg-blue-50 text-blue-700 border-blue-200'
    : 'bg-gray-50 text-gray-600 border-gray-200';
  return (
    <span className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded-full border ${cls}`}>
      {trait}
    </span>
  );
}

// ── DeptBar ───────────────────────────────────────────────────────────────────

function DeptBar({ name, score }: { name: string; score: number }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-36 text-gray-600 truncate shrink-0">{name}</span>
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor(score)}`} style={{ width: `${score}%` }} />
      </div>
      <span className="w-7 text-right font-semibold text-gray-700">{score}</span>
    </div>
  );
}

// ── CandidateCard ─────────────────────────────────────────────────────────────

function CandidateCard({ profile, colorClass }: { profile: CandidateProfile; colorClass: string }) {
  const [expanded, setExpanded] = useState(false);
  const topDepts = profile.topDepartments?.slice(0, 3) ?? [];
  const allDepts = Object.entries(profile.departmentFit ?? {}).sort(([, a], [, b]) => b - a);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3 hover:border-gray-300 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className={`w-9 h-9 rounded-full ${colorClass} text-white flex items-center justify-center text-xs font-bold shrink-0`}>
            {initials(profile.name)}
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">{profile.name}</h3>
            <p className="text-xs text-indigo-600 font-medium mt-0.5">{profile.personalityType}</p>
          </div>
        </div>
        <span className={`text-[10px] font-semibold px-2 py-1 rounded-full border whitespace-nowrap shrink-0 ${LEADER_COLORS[profile.leadershipTendency] ?? 'bg-gray-100 text-gray-700 border-gray-200'}`}>
          {profile.leadershipTendency}
        </span>
      </div>

      <div className="flex flex-wrap gap-1">
        {(profile.personalityTraits ?? []).map(t => <TraitBadge key={t} trait={t} />)}
      </div>

      <div className="bg-gray-50 rounded-lg px-3 py-2 space-y-1">
        <div className="text-[11px] text-gray-600">
          <span className="text-gray-400 font-semibold">Style:</span> {profile.communicationStyle}
        </div>
        <div className="text-[11px] text-gray-600">
          <span className="text-gray-400 font-semibold">Work:</span> {profile.workStyle}
        </div>
      </div>

      <div>
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Core Strengths</p>
        <div className="flex flex-wrap gap-1">
          {(profile.coreStrengths ?? []).map(s => (
            <span key={s} className="text-[10px] bg-gray-100 text-gray-700 px-2 py-0.5 rounded-md">{s}</span>
          ))}
        </div>
      </div>

      <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
        <p className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wide">Suggested Team Role</p>
        <p className="text-xs font-semibold text-indigo-800 mt-0.5">{profile.suggestedTeamRole}</p>
      </div>

      <div>
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Department Fit</p>
        <div className="space-y-2">
          {topDepts.map(d => (
            <div key={d.name}>
              <DeptBar name={d.name} score={d.score} />
              <p className="text-[10px] text-gray-400 mt-0.5 ml-[152px] leading-snug">{d.reason}</p>
            </div>
          ))}
        </div>
        {allDepts.length > 3 && (
          <>
            <button
              onClick={() => setExpanded(e => !e)}
              className="mt-2 text-[10px] text-indigo-500 hover:text-indigo-700 font-medium flex items-center gap-1"
            >
              <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
              {expanded ? 'Show less' : `Show all ${allDepts.length} departments`}
            </button>
            {expanded && (
              <div className="mt-2 space-y-1.5 border-t border-gray-100 pt-2">
                {allDepts.slice(3).map(([name, score]) => (
                  <DeptBar key={name} name={name} score={score as number} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── TeamView ──────────────────────────────────────────────────────────────────

function TeamView({ analysis }: { analysis: TeamAnalysis }) {
  return (
    <div className="space-y-5">
      <ScorePair synergy={analysis.synergyScore ?? 0} balance={analysis.teamBalance ?? 0} />

      <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
        <p className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wide mb-1">Team Character</p>
        <p className="text-sm text-indigo-900 leading-relaxed">{analysis.compositionSummary}</p>
      </div>

      <div>
        <p className="text-xs font-bold text-gray-900 mb-3">Role Assignments</p>
        <div className="space-y-2">
          {(analysis.members ?? []).map(m => (
            <div key={m.candidateName} className="bg-white border border-gray-200 rounded-lg p-3 grid grid-cols-3 gap-3 text-[11px]">
              <div>
                <p className="text-[10px] text-gray-400 font-medium">Candidate</p>
                <p className="font-bold text-gray-900 mt-0.5">{m.candidateName}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400 font-medium">Role</p>
                <p className="font-semibold text-indigo-700 mt-0.5">{m.assignedRole}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400 font-medium">Contribution</p>
                <p className="text-gray-600 mt-0.5 leading-snug">{m.keyContribution}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
          <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wide mb-2">Team Strengths</p>
          <ul className="space-y-1">
            {(analysis.teamStrengths ?? []).map(s => (
              <li key={s} className="text-[11px] text-emerald-800 flex items-start gap-1.5">
                <span className="shrink-0 mt-0.5">✓</span> {s}
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
          <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide mb-2">Gaps to Address</p>
          <ul className="space-y-1">
            {(analysis.teamGaps ?? []).map(g => (
              <li key={g} className="text-[11px] text-amber-800 flex items-start gap-1.5">
                <span className="shrink-0 mt-0.5">△</span> {g}
              </li>
            ))}
          </ul>
        </div>
      </div>

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

      <div className="bg-gray-900 rounded-xl p-4">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">AI Recommendation</p>
        <p className="text-sm text-white leading-relaxed">{analysis.overallRecommendation}</p>
      </div>
    </div>
  );
}

// ── Main Modal ─────────────────────────────────────────────────────────────────

export default function TeamModal({ cvs, onClose }: { cvs: CV[]; onClose: () => void }) {
  const [selected,         setSelected]         = useState<string[]>([]);
  const [phase,            setPhase]            = useState<'select' | 'loading' | 'result'>('select');
  const [report,           setReport]           = useState<TeamReport | null>(null);
  const [error,            setError]            = useState('');
  const [resultTab,        setResultTab]        = useState<'arrangement' | 'profiles' | 'team'>('arrangement');
  const [arrangementMode,  setArrangementMode]  = useState<'optimal' | 'custom'>('optimal');
  const [customGroup,      setCustomGroup]      = useState<string[]>([]);
  const [customEval,       setCustomEval]       = useState<CustomEval | null>(null);
  const [customEvalLoading,setCustomEvalLoading]= useState(false);
  const [customEvalError,  setCustomEvalError]  = useState('');

  const selectedCvs = cvs.filter(c => selected.includes(c.id));

  const reset = () => {
    setPhase('select'); setReport(null); setSelected([]);
    setCustomGroup([]); setCustomEval(null); setCustomEvalError(''); setError('');
  };

  const generate = async () => {
    if (!selectedCvs.length) return;
    setPhase('loading');
    setError('');
    try {
      const resp = await fetch('/api/team-formation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidates: selectedCvs.map(c => ({ name: c.name, content: c.content || '' })) }),
      });
      if (!resp.ok) throw new Error(`Server error ${resp.status}: ${await resp.text()}`);
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || 'Analysis failed');
      setReport(data);
      // Pre-seed custom group with AI's optimal group (or all if no optimal)
      const optMembers = data.teamAnalysis?.optimalGroup?.members ?? data.candidates.map((c: CandidateProfile) => c.name);
      setCustomGroup(optMembers);
      setResultTab('arrangement');
      setArrangementMode('optimal');
      setPhase('result');
    } catch (e: any) {
      setError(e.message);
      setPhase('select');
    }
  };

  const evaluateCustomGroup = async () => {
    if (!report || customGroup.length < 2) return;
    setCustomEvalLoading(true);
    setCustomEvalError('');
    setCustomEval(null);
    try {
      const profiles = report.candidates
        .filter(c => customGroup.includes(c.name))
        .map(c => ({
          name: c.name,
          personalityType: c.personalityType,
          leadershipTendency: c.leadershipTendency,
          coreStrengths: c.coreStrengths,
          suggestedTeamRole: c.suggestedTeamRole,
        }));
      const resp = await fetch('/api/evaluate-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profiles }),
      });
      if (!resp.ok) throw new Error(`Server error ${resp.status}`);
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || 'Evaluation failed');
      setCustomEval(data);
    } catch (e: any) {
      setCustomEvalError(e.message);
    } finally {
      setCustomEvalLoading(false);
    }
  };

  const optimalGroup = report?.teamAnalysis?.optimalGroup;
  const optimalNames = optimalGroup?.members
    ?? report?.candidates.map(c => c.name)
    ?? [];

  const toggleCustom = (name: string) => {
    setCustomGroup(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
    setCustomEval(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-gray-50 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center">
              <Users className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900">Team Formation Intelligence</h2>
              <p className="text-[10px] text-gray-400">Department fit · Personality profiling · Optimal grouping · Custom evaluation</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {phase === 'result' && (
              <button
                onClick={reset}
                className="text-xs text-gray-500 hover:text-gray-800 px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-all"
              >
                ← New Analysis
              </button>
            )}
            <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-all">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto">

          {/* ────── SELECT ────── */}
          {phase === 'select' && (
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-800">Select candidates to analyse</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    1 candidate → department fit · 2+ → team formation, optimal grouping & custom build
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setSelected(cvs.map(c => c.id))} className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium">Select all</button>
                  {selected.length > 0 && (
                    <button onClick={() => setSelected([])} className="text-[11px] text-gray-400 hover:text-gray-600">Clear</button>
                  )}
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                  <p className="text-xs text-red-700">{error}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                {cvs.map((cv, i) => (
                  <button
                    key={cv.id}
                    onClick={() => setSelected(prev =>
                      prev.includes(cv.id) ? prev.filter(x => x !== cv.id) : [...prev, cv.id]
                    )}
                    className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                      selected.includes(cv.id)
                        ? 'border-indigo-400 bg-indigo-50'
                        : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className={`w-9 h-9 rounded-full ${AVATAR_COLORS[i % AVATAR_COLORS.length]} text-white flex items-center justify-center text-xs font-bold shrink-0`}>
                      {initials(cv.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-gray-900 truncate">{cv.name}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {cv.type === 'linkedin' ? 'LinkedIn' : cv.type === 'pdf' ? 'PDF' : 'Text'} ·{' '}
                        {cv.content ? `${(cv.content.length / 1000).toFixed(1)}k chars` : 'No content'}
                      </p>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                      selected.includes(cv.id) ? 'border-indigo-500 bg-indigo-500' : 'border-gray-300'
                    }`}>
                      {selected.includes(cv.id) && <span className="text-white text-[8px] font-bold">✓</span>}
                    </div>
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                <p className="text-[11px] text-gray-500">
                  {selected.length === 0
                    ? 'No candidates selected'
                    : selected.length === 1
                    ? '1 candidate — department fit only'
                    : `${selected.length} candidates — full team intelligence`}
                </p>
                <button
                  onClick={generate}
                  disabled={selected.length === 0}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-xs font-semibold rounded-lg hover:bg-gray-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  <Users className="w-3.5 h-3.5" />
                  Analyse {selected.length > 0 ? `${selected.length} candidate${selected.length > 1 ? 's' : ''}` : ''}
                </button>
              </div>
            </div>
          )}

          {/* ────── LOADING ────── */}
          {phase === 'loading' && (
            <div className="flex flex-col items-center justify-center py-14 gap-6 px-8">
              <LoadingBounce cvs={selectedCvs} />
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-1.5">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                  <p className="text-sm font-semibold text-gray-900">Analysing team dynamics…</p>
                </div>
                <p className="text-[11px] text-gray-400">Profiling personalities · inferring department fit · finding optimal groupings</p>
                <p className="text-[11px] text-indigo-400 font-medium mt-1.5">{selectedCvs.map(c => c.name).join(' · ')}</p>
              </div>
            </div>
          )}

          {/* ────── RESULT ────── */}
          {phase === 'result' && report && (
            <div className="flex flex-col">
              {/* Tabs */}
              <div className="flex border-b border-gray-200 bg-white px-6 shrink-0">
                {[
                  { key: 'arrangement' as const, label: 'Arrangement' },
                  { key: 'profiles'    as const, label: `Profiles (${report.candidates.length})` },
                  ...(report.teamAnalysis ? [{ key: 'team' as const, label: 'Team Analysis' }] : []),
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setResultTab(tab.key)}
                    className={`px-4 py-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
                      resultTab === tab.key
                        ? 'border-gray-900 text-gray-900'
                        : 'border-transparent text-gray-400 hover:text-gray-700'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="p-6">

                {/* ── ARRANGEMENT TAB ── */}
                {resultTab === 'arrangement' && (
                  <div className="space-y-5 max-w-3xl mx-auto">

                    {/* Mode switcher (only when team analysis exists) */}
                    {report.teamAnalysis && (
                      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit mx-auto">
                        <button
                          onClick={() => setArrangementMode('optimal')}
                          className={`flex items-center gap-1.5 text-xs font-medium px-4 py-2 rounded-lg transition-all ${
                            arrangementMode === 'optimal' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                          }`}
                        >
                          <Sparkles className="w-3 h-3" /> AI Best Group
                        </button>
                        <button
                          onClick={() => { setArrangementMode('custom'); setCustomEval(null); }}
                          className={`flex items-center gap-1.5 text-xs font-medium px-4 py-2 rounded-lg transition-all ${
                            arrangementMode === 'custom' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                          }`}
                        >
                          <SlidersHorizontal className="w-3 h-3" /> Custom Build
                        </button>
                      </div>
                    )}

                    {/* ── OPTIMAL MODE ── */}
                    {arrangementMode === 'optimal' && (
                      <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-5">

                        <div>
                          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-3">
                            {optimalGroup && optimalNames.length < report.candidates.length
                              ? 'AI Recommended Group — squares cluster to show the best team'
                              : 'All candidates — arranged for team view'}
                          </p>
                          <TeamArrangement
                            cvs={selectedCvs}
                            groupedNames={optimalNames}
                          />
                        </div>

                        {optimalGroup && (
                          <>
                            <div className="border-t border-gray-100 pt-4">
                              <ScorePair synergy={optimalGroup.synergyScore} balance={optimalGroup.balance} />
                            </div>

                            <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3">
                              <p className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wide mb-1">Why This Group</p>
                              <p className="text-sm text-indigo-900 leading-relaxed">{optimalGroup.reason}</p>
                            </div>

                            {(optimalGroup.excluded ?? []).length > 0 && (
                              <div>
                                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Not in Optimal Group</p>
                                <div className="space-y-2">
                                  {optimalGroup.excluded.map(ex => (
                                    <div key={ex.name} className="flex items-start gap-2.5 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                                      <span className="text-[11px] text-gray-400 mt-0.5 shrink-0">✕</span>
                                      <div>
                                        <p className="text-xs font-semibold text-gray-700">{ex.name}</p>
                                        <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{ex.reason}</p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        )}

                        {/* Fallback when optimalGroup is missing but teamAnalysis exists */}
                        {!optimalGroup && report.teamAnalysis && (
                          <>
                            <div className="border-t border-gray-100 pt-4">
                              <ScorePair synergy={report.teamAnalysis.synergyScore} balance={report.teamAnalysis.teamBalance} />
                            </div>
                            <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3">
                              <p className="text-sm text-indigo-900 leading-relaxed">{report.teamAnalysis.compositionSummary}</p>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* ── CUSTOM MODE ── */}
                    {arrangementMode === 'custom' && (
                      <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">

                        <div>
                          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Build Your Own Group</p>
                          <p className="text-[11px] text-gray-400 mb-3">
                            Click candidates to add or remove them. Squares animate to reflect your selection.
                          </p>
                          <TeamArrangement
                            cvs={selectedCvs}
                            groupedNames={customGroup}
                            onToggle={toggleCustom}
                            interactive={true}
                          />
                        </div>

                        <div className="flex items-center justify-between border-t border-gray-100 pt-3">
                          <p className="text-[11px] text-gray-500">
                            {customGroup.length === 0
                              ? 'Click candidates above to build your group'
                              : customGroup.length === 1
                              ? '1 selected — add at least one more to evaluate'
                              : `${customGroup.length} selected — ready to evaluate`}
                          </p>
                          <button
                            onClick={evaluateCustomGroup}
                            disabled={customGroup.length < 2 || customEvalLoading}
                            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
                          >
                            {customEvalLoading
                              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Evaluating…</>
                              : <><Sparkles className="w-3.5 h-3.5" /> Evaluate This Group</>}
                          </button>
                        </div>

                        {customEvalError && (
                          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                            <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                            <p className="text-xs text-red-700">{customEvalError}</p>
                          </div>
                        )}

                        {customEval && (
                          <div className="border-t border-gray-100 pt-4 space-y-4">
                            <div className="flex items-center justify-between">
                              <ScorePair synergy={customEval.synergyScore} balance={customEval.balance} />
                              <span className={`text-sm font-bold px-4 py-2 rounded-xl border ${verdictStyle(customEval.verdict)}`}>
                                {customEval.verdict}
                              </span>
                            </div>
                            <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
                              <p className="text-sm text-gray-700 leading-relaxed">{customEval.summary}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                                <p className="text-[10px] font-semibold text-emerald-600 uppercase mb-1.5">Strengths</p>
                                <ul className="space-y-1">
                                  {(customEval.strengths ?? []).map(s => (
                                    <li key={s} className="text-[11px] text-emerald-800 flex gap-1.5">✓ {s}</li>
                                  ))}
                                </ul>
                              </div>
                              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
                                <p className="text-[10px] font-semibold text-amber-600 uppercase mb-1.5">Gaps</p>
                                <ul className="space-y-1">
                                  {(customEval.gaps ?? []).map(g => (
                                    <li key={g} className="text-[11px] text-amber-800 flex gap-1.5">△ {g}</li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ── PROFILES TAB ── */}
                {resultTab === 'profiles' && (
                  <div className={`grid gap-4 ${report.candidates.length === 1 ? 'grid-cols-1 max-w-xl mx-auto' : 'grid-cols-2'}`}>
                    {report.candidates.map((c, i) => (
                      <CandidateCard
                        key={c.name}
                        profile={c}
                        colorClass={AVATAR_COLORS[i % AVATAR_COLORS.length]}
                      />
                    ))}
                  </div>
                )}

                {/* ── TEAM ANALYSIS TAB ── */}
                {resultTab === 'team' && report.teamAnalysis && (
                  <div className="max-w-3xl mx-auto">
                    <TeamView analysis={report.teamAnalysis} />
                  </div>
                )}

              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
