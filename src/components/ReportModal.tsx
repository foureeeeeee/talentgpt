import { useState, useRef } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
import {
  X, Printer, FileText, CheckCircle2, AlertCircle, Brain, Clock,
  TrendingUp, Shield, DollarSign, MessageSquare, Star, AlertTriangle,
  ChevronDown, ChevronRight, Loader2, Users, User, Award, Zap,
  Search,
} from 'lucide-react';

// ── CV type ───────────────────────────────────────────────────────────────────

interface CV {
  id: string;
  name: string;
  content?: string;
  type?: string;
  fileData?: string;
}

// ── PDF helpers (same pipeline as Dashboard) ──────────────────────────────────

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

async function extractCvText(cv: CV): Promise<string> {
  if (cv.content?.trim()) return cv.content.trim();
  if (!cv.fileData) return '';
  try {
    const r = await fetch('/api/extract-pdf-text', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileData: cv.fileData }),
    });
    const d = await r.json();
    if (d.text?.trim()) return d.text.trim();
  } catch { /* fall through */ }
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

// ── Report types ──────────────────────────────────────────────────────────────

interface CandidateInfo {
  currentPosition: string; yearsExperience: string; education: string;
  location: string; availability: string; expectedSalary: string;
}
interface ScoreField { score: number; evidence: string }
interface CandidateReport {
  id: string; name: string;
  executiveSummary: { candidateInfo: CandidateInfo; summary: string };
  hiringReadiness: {
    technicalSkillMatch: ScoreField; relevantExperience: ScoreField;
    learningAgility: ScoreField; communication: ScoreField;
    teamCollaboration: ScoreField; leadershipPotential: ScoreField;
    overallHireability: { score: number; explanation: string };
  };
  topReasonsToInterview: { strength: string; evidence: string; businessImpact: string }[];
  biggestConcerns: { concern: string; evidence: string; risk: string; interviewQuestion: string }[];
  hiddenPotential: { transferableSkills: string[]; analysis: string; whyATSMissed: string };
  productivityEstimation: {
    timeToProductivity: string; reasoning: string;
    training: { technical: string[]; domain: string[]; process: string[] };
  };
  personalityInsights: { collaboration: string; initiative: string; adaptability: string; ownership: string; problemSolving: string };
  riskAnalysis: { riskLevel: 'Low' | 'Medium' | 'High'; risks: string[]; evidence: string };
  salaryAnalysis: { expected: string; marketAlignment: string; rejectionRisk: string; recommendation: string };
  interviewFocusAreas: { area: string; reason: string; question: string }[];
  finalRecommendation: { decision: 'Strong Hire' | 'Hire' | 'Interview Recommended' | 'Consider' | 'Hold' | 'Reject'; justification: string };
}
interface Comparison {
  table: { candidateId: string; name: string; hireability: number; potential: number; risk: string; readiness: string; recommendation: string }[];
  ranking: { rank: number; candidateId: string; name: string; justification: string }[];
  bestImmediateHire: { candidateId: string; name: string; evidence: string };
  highestPotential: { candidateId: string; name: string; evidence: string };
  lowestRisk: { candidateId: string; name: string; evidence: string };
  executiveRecommendation: { preferred: string; alternative: string; development: string; reasoning: string };
}
interface Report { generatedAt: string; candidates: CandidateReport[]; comparison: Comparison | null }

interface Props { cvs: CV[]; projectJd?: string; onClose: () => void }

// ── Shared UI atoms ───────────────────────────────────────────────────────────

function ScoreBar({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-400' : score >= 40 ? 'bg-orange-400' : 'bg-red-500';
  const text  = score >= 80 ? 'text-emerald-700' : score >= 60 ? 'text-amber-700' : score >= 40 ? 'text-orange-700' : 'text-red-700';
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className={`text-sm font-bold w-7 text-right tabular-nums ${text}`}>{score}</span>
    </div>
  );
}

function RiskBadge({ level }: { level: string }) {
  const s: Record<string, string> = {
    Low:    'bg-emerald-100 text-emerald-700 border-emerald-200',
    Medium: 'bg-amber-100 text-amber-700 border-amber-200',
    High:   'bg-red-100 text-red-700 border-red-200',
  };
  return <span className={`inline-flex items-center px-2.5 py-1 text-xs font-bold rounded-full border ${s[level] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>{level} Risk</span>;
}

function DecisionBadge({ decision }: { decision: string }) {
  const s: Record<string, string> = {
    'Strong Hire':            'bg-emerald-600 text-white',
    'Hire':                   'bg-green-500 text-white',
    'Interview Recommended':  'bg-blue-600 text-white',
    'Consider':               'bg-amber-500 text-white',
    'Hold':                   'bg-orange-500 text-white',
    'Reject':                 'bg-red-600 text-white',
  };
  return <span className={`inline-flex items-center px-4 py-2 text-sm font-bold rounded-xl ${s[decision] ?? 'bg-gray-600 text-white'}`}>{decision}</span>;
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-4 pb-2 border-b border-gray-200">
        <span className="text-gray-400">{icon}</span>
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-700">{title}</h3>
      </div>
      {children}
    </div>
  );
}

// ── Candidate Report View ─────────────────────────────────────────────────────

function CandidateReportView({ report, cvText }: { report: CandidateReport; cvText: string }) {
  if (!report) return <p className="text-sm text-gray-400 p-8">Report data unavailable.</p>;
  const r = report;
  const scores = r.hiringReadiness ?? {} as any;
  const scoreRows: { label: string; field: ScoreField }[] = [
    { label: 'Technical Skill Match',  field: scores.technicalSkillMatch },
    { label: 'Relevant Experience',    field: scores.relevantExperience },
    { label: 'Learning Agility',       field: scores.learningAgility },
    { label: 'Communication Ability',  field: scores.communication },
    { label: 'Team Collaboration',     field: scores.teamCollaboration },
    { label: 'Leadership Potential',   field: scores.leadershipPotential },
  ];

  return (
    <div className="space-y-0">

      {/* PAGE 1 — Source Document */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-200">
          <FileText className="w-4 h-4 text-gray-400" />
          <h3 className="text-sm font-bold uppercase tracking-wider text-gray-700">Source Document — Original CV</h3>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
          {cvText ? (
            <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">{cvText}</pre>
          ) : (
            <p className="text-xs text-gray-400 italic">No text content was extractable for this candidate.</p>
          )}
        </div>
      </div>

      {/* Executive Summary */}
      <Section icon={<Star className="w-4 h-4" />} title="Executive Summary">
        <div className="grid grid-cols-2 gap-3 mb-4">
          {[
            ['Current Position', r.executiveSummary.candidateInfo.currentPosition],
            ['Experience',       r.executiveSummary.candidateInfo.yearsExperience],
            ['Education',        r.executiveSummary.candidateInfo.education],
            ['Location',         r.executiveSummary.candidateInfo.location],
            ['Availability',     r.executiveSummary.candidateInfo.availability],
            ['Expected Salary',  r.executiveSummary.candidateInfo.expectedSalary],
          ].map(([label, val]) => (
            <div key={label} className="bg-gray-50 rounded-lg p-3">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">{label}</p>
              <p className="text-xs text-gray-800 mt-0.5 font-medium">{val || '—'}</p>
            </div>
          ))}
        </div>
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
          <p className="text-xs text-blue-900 leading-relaxed">{r.executiveSummary.summary}</p>
        </div>
      </Section>

      {/* Overall Hireability */}
      <Section icon={<Award className="w-4 h-4" />} title="Overall Hireability Score">
        <div className="flex items-center gap-6 mb-3">
          <div className={`w-20 h-20 rounded-full flex flex-col items-center justify-center border-4 shrink-0 ${
            scores.overallHireability.score >= 80 ? 'border-emerald-400 bg-emerald-50' :
            scores.overallHireability.score >= 60 ? 'border-amber-400 bg-amber-50' : 'border-red-400 bg-red-50'
          }`}>
            <span className={`text-2xl font-black ${
              scores.overallHireability.score >= 80 ? 'text-emerald-700' :
              scores.overallHireability.score >= 60 ? 'text-amber-700' : 'text-red-700'
            }`}>{scores.overallHireability.score}</span>
            <span className="text-[9px] text-gray-400 uppercase">/ 100</span>
          </div>
          <p className="text-xs text-gray-700 leading-relaxed">{scores.overallHireability.explanation}</p>
        </div>
      </Section>

      {/* Hiring Readiness */}
      <Section icon={<TrendingUp className="w-4 h-4" />} title="Hiring Readiness Analysis">
        <div className="space-y-4">
          {scoreRows.map(({ label, field }) => (
            <div key={label}>
              <span className="text-xs font-semibold text-gray-700">{label}</span>
              <ScoreBar score={field.score} />
              <p className="text-[11px] text-gray-500 mt-1 leading-snug">{field.evidence}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Top Reasons */}
      <Section icon={<CheckCircle2 className="w-4 h-4" />} title="Top Reasons to Interview">
        <div className="space-y-3">
          {(r.topReasonsToInterview ?? []).map((item, i) => (
            <div key={i} className="border border-emerald-100 bg-emerald-50 rounded-xl p-4">
              <div className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                <div className="flex-1">
                  <p className="text-xs font-bold text-emerald-800">{item.strength}</p>
                  <p className="text-[11px] text-emerald-700 mt-1"><span className="font-semibold">Evidence:</span> {item.evidence}</p>
                  <p className="text-[11px] text-emerald-600 mt-1"><span className="font-semibold">Business Impact:</span> {item.businessImpact}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Biggest Concerns */}
      <Section icon={<AlertCircle className="w-4 h-4" />} title="Biggest Concerns">
        <div className="space-y-3">
          {(r.biggestConcerns ?? []).map((item, i) => (
            <div key={i} className="border border-amber-100 bg-amber-50 rounded-xl p-4">
              <p className="text-xs font-bold text-amber-800">{item.concern}</p>
              <p className="text-[11px] text-amber-700 mt-1"><span className="font-semibold">Evidence:</span> {item.evidence}</p>
              <p className="text-[11px] text-amber-600 mt-1"><span className="font-semibold">Risk:</span> {item.risk}</p>
              <div className="mt-2 pt-2 border-t border-amber-200">
                <p className="text-[10px] text-amber-500 uppercase font-bold tracking-wide mb-1">Interview Validation Question</p>
                <p className="text-[11px] text-amber-800 italic">"{item.interviewQuestion}"</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Hidden Potential */}
      <Section icon={<Zap className="w-4 h-4" />} title="Hidden Potential Analysis">
        <div className="bg-violet-50 border border-violet-100 rounded-xl p-4 space-y-3">
          {(r.hiddenPotential?.transferableSkills ?? []).length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-violet-600 uppercase tracking-wide mb-2">Transferable Skills</p>
              <div className="flex flex-wrap gap-1.5">
                {(r.hiddenPotential?.transferableSkills ?? []).map((s, i) => (
                  <span key={i} className="px-2 py-0.5 bg-violet-100 text-violet-700 text-[11px] font-medium rounded-full">{s}</span>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="text-[10px] font-bold text-violet-600 uppercase tracking-wide mb-1">Analysis</p>
            <p className="text-[11px] text-violet-800 leading-relaxed">{r.hiddenPotential.analysis}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-violet-600 uppercase tracking-wide mb-1">Why Traditional ATS May Overlook This Candidate</p>
            <p className="text-[11px] text-violet-700 leading-relaxed">{r.hiddenPotential.whyATSMissed}</p>
          </div>
        </div>
      </Section>

      {/* Productivity */}
      <Section icon={<Clock className="w-4 h-4" />} title="Productivity Estimation">
        <div className="flex items-start gap-4 mb-4">
          <div className="bg-gray-900 text-white rounded-xl px-4 py-3 text-center shrink-0">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Time to Productivity</p>
            <p className="text-sm font-bold mt-0.5">{r.productivityEstimation.timeToProductivity}</p>
          </div>
          <p className="text-[11px] text-gray-600 leading-relaxed mt-1">{r.productivityEstimation.reasoning}</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {(['technical', 'domain', 'process'] as const).map(type => (
            <div key={type} className="bg-gray-50 rounded-lg p-3">
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-2">{type} Training</p>
              {(r.productivityEstimation?.training?.[type] ?? []).length > 0 ? (
                <ul className="space-y-1">
                  {(r.productivityEstimation?.training?.[type] ?? []).map((t, i) => (
                    <li key={i} className="text-[11px] text-gray-700 flex items-start gap-1"><span className="text-gray-400 mt-0.5">·</span>{t}</li>
                  ))}
                </ul>
              ) : <p className="text-[11px] text-gray-400 italic">None identified</p>}
            </div>
          ))}
        </div>
      </Section>

      {/* Personality Insights */}
      <Section icon={<Brain className="w-4 h-4" />} title="Personality & Working Style Insights">
        <div className="grid grid-cols-1 gap-2">
          {Object.entries(r.personalityInsights ?? {}).map(([trait, insight]) => (
            <div key={trait} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide w-28 shrink-0 mt-0.5 capitalize">{trait}</span>
              <p className="text-[11px] text-gray-700 leading-snug">{insight as string}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Risk Analysis */}
      <Section icon={<Shield className="w-4 h-4" />} title="Risk Analysis">
        <div className="flex items-start gap-4 mb-3">
          <RiskBadge level={r.riskAnalysis?.riskLevel ?? 'Medium'} />
          <p className="text-[11px] text-gray-600 leading-relaxed">{r.riskAnalysis?.evidence}</p>
        </div>
        {(r.riskAnalysis?.risks ?? []).length > 0 && (
          <ul className="space-y-1">
            {(r.riskAnalysis?.risks ?? []).map((risk, i) => (
              <li key={i} className="flex items-start gap-2 text-[11px] text-gray-700">
                <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />{risk}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Salary */}
      <Section icon={<DollarSign className="w-4 h-4" />} title="Salary Analysis">
        <div className="grid grid-cols-2 gap-3">
          {[
            ['Expected Salary',        r.salaryAnalysis.expected],
            ['Market Alignment',       r.salaryAnalysis.marketAlignment],
            ['Risk of Offer Rejection',r.salaryAnalysis.rejectionRisk],
            ['Recommendation',         r.salaryAnalysis.recommendation],
          ].map(([label, val]) => (
            <div key={label} className="bg-gray-50 rounded-lg p-3">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">{label}</p>
              <p className="text-xs text-gray-800 mt-0.5">{val || '—'}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Interview Focus Areas */}
      <Section icon={<MessageSquare className="w-4 h-4" />} title="Interview Focus Areas">
        <div className="space-y-3">
          {(r.interviewFocusAreas ?? []).map((item, i) => (
            <div key={i} className="border border-blue-100 rounded-xl p-4 bg-blue-50">
              <div className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                <div className="flex-1">
                  <p className="text-xs font-bold text-blue-800">{item.area}</p>
                  <p className="text-[11px] text-blue-700 mt-1">{item.reason}</p>
                  <p className="text-[11px] text-blue-800 mt-2 italic border-t border-blue-200 pt-2">"{item.question}"</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Final Recommendation */}
      <Section icon={<Star className="w-4 h-4" />} title="Final AI Recommendation">
        <div className="bg-gray-900 rounded-2xl p-6 text-center">
          <p className="text-xs text-gray-400 uppercase tracking-widest mb-3">AI Decision</p>
          <DecisionBadge decision={r.finalRecommendation.decision} />
          <p className="text-xs text-gray-300 leading-relaxed mt-4 max-w-prose mx-auto">{r.finalRecommendation.justification}</p>
        </div>
      </Section>
    </div>
  );
}

// ── Comparison Section ────────────────────────────────────────────────────────

function ComparisonSection({ comparison }: { comparison: Comparison }) {
  const c = comparison;
  return (
    <div className="mt-12 pt-8 border-t-2 border-gray-200 print:break-before-page">
      <h2 className="text-lg font-black text-gray-900 mb-6 flex items-center gap-2">
        <Users className="w-5 h-5" /> Finalist Comparison
      </h2>
      <div className="mb-8 overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-900 text-white">
              {['Candidate','Hireability','Potential','Risk','Readiness','Recommendation'].map((h, i) => (
                <th key={h} className={`p-3 font-semibold ${i === 0 ? 'text-left rounded-tl-lg' : i === 5 ? 'text-left rounded-tr-lg' : 'text-center'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {c.table.map((row, i) => (
              <tr key={row.candidateId} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="p-3 font-medium text-gray-900 border-b border-gray-100">{row.name}</td>
                <td className="p-3 text-center border-b border-gray-100">
                  <span className={`font-bold ${row.hireability >= 80 ? 'text-emerald-600' : row.hireability >= 60 ? 'text-amber-600' : 'text-red-500'}`}>{row.hireability}</span>
                </td>
                <td className="p-3 text-center border-b border-gray-100">
                  <span className={`font-bold ${row.potential >= 80 ? 'text-emerald-600' : row.potential >= 60 ? 'text-amber-600' : 'text-red-500'}`}>{row.potential}</span>
                </td>
                <td className="p-3 text-center border-b border-gray-100"><RiskBadge level={row.risk} /></td>
                <td className="p-3 text-center border-b border-gray-100 text-gray-600">{row.readiness}</td>
                <td className="p-3 border-b border-gray-100"><DecisionBadge decision={row.recommendation} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mb-8">
        <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">AI Recommended Ranking</h3>
        <div className="space-y-2">
          {c.ranking.map(item => (
            <div key={item.rank} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-black shrink-0 ${
                item.rank === 1 ? 'bg-yellow-400 text-yellow-900' : item.rank === 2 ? 'bg-gray-300 text-gray-700' : 'bg-amber-700 text-white'
              }`}>{item.rank}</span>
              <div>
                <p className="text-xs font-bold text-gray-900">{item.name}</p>
                <p className="text-[11px] text-gray-600 mt-0.5">{item.justification}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Best Immediate Hire', color: 'blue',   icon: <Zap className="w-4 h-4" />,         data: c.bestImmediateHire },
          { label: 'Highest Potential',   color: 'violet', icon: <TrendingUp className="w-4 h-4" />,  data: c.highestPotential },
          { label: 'Lowest Risk',         color: 'emerald',icon: <Shield className="w-4 h-4" />,      data: c.lowestRisk },
        ].map(({ label, color, icon, data }) => (
          <div key={label} className={`bg-${color}-50 border border-${color}-100 rounded-xl p-4`}>
            <div className={`flex items-center gap-1.5 text-${color}-600 mb-2`}>{icon}<span className="text-[10px] font-bold uppercase tracking-wide">{label}</span></div>
            <p className={`text-sm font-black text-${color}-900`}>{data?.name}</p>
            <p className={`text-[11px] text-${color}-700 mt-1 leading-snug`}>{data?.evidence}</p>
          </div>
        ))}
      </div>

      <div className="bg-gray-900 rounded-2xl p-6">
        <h3 className="text-xs text-gray-400 uppercase tracking-widest font-bold mb-4">Executive Recommendation</h3>
        <div className="grid grid-cols-3 gap-4 mb-4">
          {[
            ['Preferred Candidate',    c.executiveRecommendation.preferred],
            ['Alternative Candidate',  c.executiveRecommendation.alternative],
            ['Development Candidate',  c.executiveRecommendation.development],
          ].map(([label, val]) => (
            <div key={label}>
              <p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p>
              <p className="text-sm font-black text-white mt-0.5">{val || '—'}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-300 leading-relaxed border-t border-gray-700 pt-4">{c.executiveRecommendation.reasoning}</p>
      </div>
    </div>
  );
}

// ── Main Modal ────────────────────────────────────────────────────────────────

export default function ReportModal({ cvs, projectJd, onClose }: Props) {
  const [phase, setPhase]           = useState<'select' | 'loading' | 'report'>('select');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(cvs.map(c => c.id)));
  const [search, setSearch]         = useState('');
  const [report, setReport]         = useState<Report | null>(null);
  const [resolvedTexts, setResolvedTexts] = useState<Record<string, string>>({});
  const [error, setError]           = useState<string | null>(null);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [activeIdx, setActiveIdx]   = useState(0);
  const printRef                    = useRef<HTMLDivElement>(null);

  const filteredCvs = cvs.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));
  const selectedCvs = cvs.filter(c => selectedIds.has(c.id));

  const toggle = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const handleGenerate = async () => {
    if (!selectedCvs.length) return;
    setPhase('loading');
    setError(null);

    // Step 1: Resolve text for every selected CV (same 3-step pipeline)
    const texts: Record<string, string> = {};
    for (let i = 0; i < selectedCvs.length; i++) {
      const cv = selectedCvs[i];
      setLoadingMsg(`Extracting CV text… ${i + 1} / ${selectedCvs.length} (${cv.name})`);
      texts[cv.id] = await extractCvText(cv);
    }
    setResolvedTexts(texts);

    // Step 2: Generate report
    setLoadingMsg(`Generating report for ${selectedCvs.length} candidate${selectedCvs.length !== 1 ? 's' : ''}…`);
    try {
      const res = await fetch('/api/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidates: selectedCvs.map(c => ({
            id: c.id,
            name: c.name,
            content: texts[c.id] || '',
          })),
          jobDescription: projectJd || '',
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setReport(data.report);
      setActiveIdx(0);
      setPhase('report');
    } catch (err: any) {
      setError(err.message || 'Report generation failed');
      setPhase('select');
    }
  };

  const activeReport = report?.candidates[activeIdx];

  // Build the shared HTML snippet + base styles used by both export functions
  const buildExportHtml = (): { bodyHtml: string; title: string } | null => {
    const el = document.getElementById('report-body-scroll');
    if (!el || !report) return null;
    const names  = report.candidates.map(c => c.name).join(', ');
    const date   = new Date(report.generatedAt).toLocaleString();
    const count  = report.candidates.length;
    return {
      title:    `Hiring Report — ${names}`,
      bodyHtml: `<!-- Generated by TalentGPT · ${date} · ${count} candidate${count !== 1 ? 's' : ''} -->
${el.innerHTML}`,
    };
  };

  const sharedStyles = `
    @page { margin: 1.5cm; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: white; color: #111827; }
    pre  { white-space: pre-wrap !important; word-break: break-word; }
    .max-h-96 { max-height: none !important; }
    .overflow-y-auto { overflow: visible !important; }
    [class*='overflow-y'] { overflow: visible !important; max-height: none !important; }
    @media print { .no-print { display: none !important; } }
  `;

  // PDF export — fresh window avoids all fixed/overflow modal constraints
  const handleExportPdf = () => {
    const built = buildExportHtml();
    if (!built) return;
    const win = window.open('', '_blank');
    if (!win) { alert('Allow pop-ups to export PDF.'); return; }
    win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${built.title}</title>
  <script src="https://cdn.tailwindcss.com"><\/script>
  <style>${sharedStyles}</style>
</head>
<body class="p-0 m-0">
  <div class="max-w-4xl mx-auto px-10 py-10">
    ${built.bodyHtml}
    <p style="font-size:10px;color:#d1d5db;text-align:center;margin-top:48px;">
      Generated by TalentGPT AI · For internal hiring use only
    </p>
  </div>
  <script>
    // Wait for Tailwind CDN to finish before printing
    document.addEventListener('DOMContentLoaded', () => setTimeout(() => { window.print(); }, 900));
  <\/script>
</body>
</html>`);
    win.document.close();
  };

  // Interactive HTML export — self-contained file, opens in any browser
  const handleExportHtml = () => {
    const built = buildExportHtml();
    if (!built) return;
    const names = report?.candidates.map(c => c.name).join(', ') ?? 'report';
    const date  = new Date(report?.generatedAt ?? Date.now()).toLocaleString();
    const count = report?.candidates.length ?? 0;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${built.title}</title>
  <script src="https://cdn.tailwindcss.com"><\/script>
  <style>
    ${sharedStyles}
    body { background: #f3f4f6; }
    #topbar { position: sticky; top: 0; z-index: 50; background: white; border-bottom: 1px solid #e5e7eb;
              display: flex; align-items: center; justify-content: space-between;
              padding: 12px 24px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
    #topbar-left { display: flex; align-items: center; gap: 12px; }
    #topbar-icon { width: 32px; height: 32px; background: #111827; border-radius: 8px;
                   display: flex; align-items: center; justify-content: center; }
    #topbar-title { font-weight: 900; font-size: 14px; color: #111827; }
    #topbar-sub   { font-size: 11px; color: #9ca3af; margin-top: 1px; }
    #topbar-actions { display: flex; gap: 8px; }
    .tbtn { display: flex; align-items: center; gap: 6px; padding: 6px 12px;
            font-size: 12px; font-weight: 500; border-radius: 8px; border: 1px solid #e5e7eb;
            cursor: pointer; background: white; color: #374151; text-decoration: none; }
    .tbtn:hover { background: #f9fafb; }
    .tbtn-primary { background: #111827; color: white; border-color: #111827; }
    .tbtn-primary:hover { background: #1f2937; }
    #content { max-width: 900px; margin: 0 auto; padding: 40px 32px 80px; background: white;
               min-height: 100vh; }
    @media print {
      #topbar { display: none !important; }
      body { background: white; }
      #content { padding: 0; max-width: none; }
    }
  </style>
</head>
<body>
  <div id="topbar">
    <div id="topbar-left">
      <div id="topbar-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14,2 14,8 20,8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10,9 9,9 8,9"/>
        </svg>
      </div>
      <div>
        <div id="topbar-title">Hiring Manager Report</div>
        <div id="topbar-sub">Generated ${date} · ${count} candidate${count !== 1 ? 's' : ''}</div>
      </div>
    </div>
    <div id="topbar-actions">
      <button class="tbtn" onclick="window.scrollTo({top:0,behavior:'smooth'})">↑ Top</button>
      <button class="tbtn tbtn-primary" onclick="window.print()">🖨 Print / Save PDF</button>
    </div>
  </div>
  <div id="content">
    ${built.bodyHtml}
    <p style="font-size:10px;color:#d1d5db;text-align:center;margin-top:48px;">
      Generated by TalentGPT AI · For internal hiring use only · Not a substitute for human judgment
    </p>
  </div>
</body>
</html>`;

    const slug = names.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 40);
    const dateStr = new Date().toISOString().slice(0, 10);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `hiring-report-${slug}-${dateStr}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <style>{`
        @media print {
          @page { margin: 1.5cm; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }

          /* Hide all UI chrome — header, sidebar, buttons */
          body * { visibility: hidden !important; }
          .no-print { display: none !important; }

          /* Show only the report content — flows across as many pages as needed */
          #report-print-root { visibility: visible !important; position: static !important; height: auto !important; overflow: visible !important; }
          #report-modal-body { visibility: visible !important; display: block !important; height: auto !important; overflow: visible !important; }
          #report-body-scroll { visibility: visible !important; }
          #report-body-scroll * { visibility: visible !important; }

          #report-body-scroll {
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            flex: none !important;
            max-width: 860px !important;
            margin: 0 auto !important;
            padding: 40px !important;
          }

          /* Lift all inner scroll/height constraints */
          #report-body-scroll pre {
            max-height: none !important;
            overflow: visible !important;
            white-space: pre-wrap !important;
          }
          #report-body-scroll .overflow-y-auto,
          #report-body-scroll [class*="overflow-y"] {
            overflow: visible !important;
            max-height: none !important;
            height: auto !important;
          }
        }
      `}</style>

      <div className="fixed inset-0 z-50 flex flex-col bg-white" id="report-print-root">

        {/* Header */}
        <div className="no-print shrink-0 flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center">
              <FileText className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-black text-gray-900">Hiring Manager Report</h2>
              {report && (
                <p className="text-[11px] text-gray-400">
                  Generated {new Date(report.generatedAt).toLocaleString()} · {report.candidates.length} candidate{report.candidates.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {phase === 'report' && (
              <>
                <button
                  onClick={() => { setPhase('select'); setReport(null); setSearch(''); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-all"
                >
                  ← New Report
                </button>
                <button
                  onClick={handleExportPdf}
                  title="Open a clean print preview in a new tab and trigger Save as PDF"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-900 text-white border border-gray-900 rounded-lg hover:bg-gray-700 transition-all"
                >
                  <Printer className="w-3.5 h-3.5" /> Export PDF
                </button>
                <button
                  onClick={handleExportHtml}
                  title="Download a self-contained interactive HTML file you can open in any browser"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 border border-indigo-300 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-all"
                >
                  <FileText className="w-3.5 h-3.5" /> Export HTML
                </button>
              </>
            )}
            <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-all">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div id="report-modal-body" className="flex-1 min-h-0 overflow-hidden flex">

          {/* ── Phase: Select ── */}
          {phase === 'select' && (
            <div className="flex-1 flex items-start justify-center p-8 overflow-y-auto">
              <div className="w-full max-w-lg">
                <h3 className="text-lg font-black text-gray-900 mb-1">Generate Hiring Report</h3>
                <p className="text-sm text-gray-500 mb-6">
                  Select candidates to include. Single candidate → individual report. Multiple → comparison section added.
                  <br />
                  <span className="text-[11px] text-gray-400">CV text will be auto-extracted (including PDF vision OCR if needed).</span>
                </p>

                {error && (
                  <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-700">{error}</p>
                  </div>
                )}

                {/* Search bar */}
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search candidates…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:border-gray-900 focus:ring-1 focus:ring-gray-900 outline-none transition-colors"
                  />
                  {search && (
                    <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Select all / none */}
                <div className="flex items-center justify-between mb-3 px-1">
                  <span className="text-xs text-gray-500">{selectedIds.size} of {cvs.length} selected</span>
                  <div className="flex gap-3">
                    <button onClick={() => setSelectedIds(new Set(cvs.map(c => c.id)))} className="text-[11px] text-blue-600 hover:underline">All</button>
                    <button onClick={() => setSelectedIds(new Set())} className="text-[11px] text-gray-400 hover:underline">None</button>
                  </div>
                </div>

                {/* Candidate list */}
                <div className="space-y-2 mb-6 max-h-[50vh] overflow-y-auto pr-1">
                  {filteredCvs.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-6">No candidates match "{search}"</p>
                  ) : filteredCvs.map(cv => {
                    const hasText = !!cv.content?.trim();
                    const hasPdf  = !!cv.fileData;
                    const checked = selectedIds.has(cv.id);
                    return (
                      <label key={cv.id} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                        checked ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-300'
                      }`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(cv.id)}
                          className="rounded accent-gray-900"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{cv.name}</p>
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            {hasText ? '✓ Text ready' : hasPdf ? '⟳ PDF — will extract on generate' : '⚠ No content'}
                          </p>
                        </div>
                        {hasText ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        ) : hasPdf ? (
                          <span className="text-[10px] text-blue-500 font-medium shrink-0">PDF</span>
                        ) : (
                          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                        )}
                      </label>
                    );
                  })}
                </div>

                <button
                  onClick={handleGenerate}
                  disabled={selectedIds.size === 0}
                  className="w-full py-3 bg-gray-900 text-white text-sm font-bold rounded-xl hover:bg-gray-800 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Generate Report · {selectedIds.size} candidate{selectedIds.size !== 1 ? 's' : ''}
                </button>
              </div>
            </div>
          )}

          {/* ── Phase: Loading ── */}
          {phase === 'loading' && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center max-w-sm">
                <Loader2 className="w-10 h-10 animate-spin text-gray-400 mx-auto mb-4" />
                <p className="text-sm font-bold text-gray-900">Please wait…</p>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">{loadingMsg}</p>
                <div className="mt-6 space-y-2 text-left">
                  {[
                    'Extracting CV text (PDF + vision OCR if needed)',
                    'Evaluating hiring readiness per dimension',
                    'Identifying hidden potential & risks',
                    'Assessing salary fit & interview areas',
                    'Compiling final AI recommendation',
                  ].map((step, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-gray-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-pulse" style={{ animationDelay: `${i * 0.3}s` }} />
                      {step}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Phase: Report ── */}
          {phase === 'report' && report && (
            <>
              {/* Candidate sidebar (multi only) */}
              {report.candidates.length > 1 && (
                <div className="no-print w-52 shrink-0 border-r border-gray-100 overflow-y-auto py-4 px-3 bg-gray-50">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider font-bold mb-3 px-1">Candidates</p>
                  {report.candidates.map((cr, i) => (
                    <button
                      key={cr.id}
                      onClick={() => setActiveIdx(i)}
                      className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-medium mb-1 transition-all ${
                        i === activeIdx ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <User className="w-3 h-3 shrink-0" />
                        <span className="truncate">{cr.name}</span>
                      </div>
                      <div className={`mt-1 text-[10px] ${i === activeIdx ? 'text-gray-400' : 'text-gray-500'}`}>
                        Score: <span className="font-bold">{cr.hiringReadiness.overallHireability.score}</span> · {cr.finalRecommendation.decision}
                      </div>
                    </button>
                  ))}
                  {report.comparison && (
                    <button
                      onClick={() => setActiveIdx(report.candidates.length)}
                      className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-medium mb-1 transition-all mt-2 ${
                        activeIdx === report.candidates.length ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      <div className="flex items-center gap-2"><Users className="w-3 h-3 shrink-0" /><span>Comparison</span></div>
                    </button>
                  )}
                </div>
              )}

              {/* Report content */}
              <div ref={printRef} id="report-body-scroll" className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto w-full">
                <div className="hidden print:block mb-8">
                  <h1 className="text-2xl font-black text-gray-900">Hiring Manager Report</h1>
                  <p className="text-xs text-gray-400 mt-1">Generated {new Date(report.generatedAt).toLocaleString()}</p>
                </div>

                {activeIdx < report.candidates.length && activeReport ? (
                  <>
                    <div className="mb-6 flex items-center justify-between">
                      <div>
                        <h1 className="text-xl font-black text-gray-900">{activeReport.name}</h1>
                        <p className="text-xs text-gray-400 mt-0.5">{activeReport.executiveSummary.candidateInfo.currentPosition || 'Candidate'}</p>
                      </div>
                      <DecisionBadge decision={activeReport.finalRecommendation.decision} />
                    </div>
                    <CandidateReportView
                      report={activeReport}
                      cvText={resolvedTexts[activeReport.id] || ''}
                    />
                  </>
                ) : report.comparison ? (
                  <ComparisonSection comparison={report.comparison} />
                ) : null}

                {/* Print: comparison appended after individual reports */}
                {activeIdx < report.candidates.length && report.comparison && (
                  <div className="hidden print:block">
                    <ComparisonSection comparison={report.comparison} />
                  </div>
                )}

                <p className="text-[10px] text-gray-300 text-center mt-10 pb-4">
                  Generated by TalentGPT AI · For internal hiring use only · Not a substitute for human judgment
                </p>
              </div>
            </>
          )}

        </div>
      </div>
    </>
  );
}
