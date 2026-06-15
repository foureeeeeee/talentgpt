import React from 'react';
import { clsx } from 'clsx';
import {
  User,
  Briefcase,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  BrainCircuit,
  MessageSquare,
  DollarSign,
  XOctagon,
  ShieldCheck,
  Users,
  ListOrdered,
  GitCompare,
  CheckCircle2,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { AnalysisModule } from '../types';

interface SidebarProps {
  activeModule: AnalysisModule;
  setActiveModule: (m: AnalysisModule) => void;
  cvCount: number;
  moduleLoading: Record<string, boolean>;
  moduleResults: Record<string, string>;
  moduleErrors: Record<string, string | null>;
}

const MODULES: { id: AnalysisModule; label: string; icon: React.ElementType }[] = [
  { id: 'snapshot', label: 'Candidate Snapshot', icon: User },
  { id: 'match', label: 'Job Match Analysis', icon: Briefcase },
  { id: 'potential', label: 'Potential Assessment', icon: TrendingUp },
  { id: 'risk', label: 'HR Risk Assessment', icon: AlertTriangle },
  { id: 'psychology', label: 'Org Psychology', icon: BrainCircuit },
  { id: 'interview', label: 'Interview Questions', icon: MessageSquare },
  { id: 'compensation', label: 'Compensation Intel', icon: DollarSign },
  { id: 'rejection', label: 'Ethical Rejection', icon: XOctagon },
  { id: 'audit', label: 'AI Verification Audit', icon: ShieldCheck },
  { id: 'retention', label: 'Retention & Flight Risk', icon: TrendingDown },
];

const MULTI_MODULES: { id: AnalysisModule; label: string; icon: React.ElementType }[] = [
  { id: 'ranking', label: 'Candidate Ranking', icon: ListOrdered },
  { id: 'team_optimization', label: 'Team Optimization', icon: Users },
  { id: 'similarity', label: 'Similarity Agent', icon: GitCompare },
];

function ModuleStatusDot({ id, moduleLoading, moduleResults, moduleErrors }: {
  id: string;
  moduleLoading: Record<string, boolean>;
  moduleResults: Record<string, string>;
  moduleErrors: Record<string, string | null>;
}) {
  if (moduleLoading[id]) {
    return <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400 shrink-0" />;
  }
  if (moduleErrors[id]) {
    return <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />;
  }
  if (moduleResults[id]) {
    return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
  }
  return null;
}

export function Sidebar({ activeModule, setActiveModule, cvCount, moduleLoading, moduleResults, moduleErrors }: SidebarProps) {
  return (
    <aside className="w-64 bg-[#0a0a0a] text-gray-300 h-full flex flex-col border-r border-white/10">
      <div className="p-5 border-b border-white/10 shrink-0">
        <h1 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
          <BrainCircuit className="w-5 h-5 text-white" />
          TalentGPT
        </h1>
        <p className="text-[10px] font-semibold text-gray-500 mt-1.5 tracking-widest uppercase">AI Recruitment Intelligence</p>
      </div>

      <div className="overflow-y-auto p-3 flex-1 space-y-6">
        <div className="space-y-0.5">
          <p className="text-[9px] font-bold tracking-widest text-gray-600 mb-2 px-2 uppercase">Single Candidate</p>
          {MODULES.map((mod) => (
            <button
              key={mod.id}
              onClick={() => setActiveModule(mod.id)}
              className={clsx(
                'w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-medium rounded-md transition-all',
                activeModule === mod.id
                  ? 'bg-white text-black'
                  : 'text-gray-400 hover:bg-white/8 hover:text-white'
              )}
            >
              <mod.icon className="w-3.5 h-3.5 shrink-0" />
              <span className="flex-1 text-left">{mod.label}</span>
              <ModuleStatusDot id={mod.id} moduleLoading={moduleLoading} moduleResults={moduleResults} moduleErrors={moduleErrors} />
            </button>
          ))}
        </div>

        <div className="space-y-0.5">
          <div className="flex items-center justify-between px-2 mb-2">
            <p className="text-[9px] font-bold tracking-widest text-gray-600 uppercase">Multi-Candidate</p>
            {cvCount < 2 && (
              <span className="text-[9px] bg-white/5 text-gray-600 px-1.5 py-0.5 rounded border border-white/10">
                2+ needed
              </span>
            )}
          </div>
          {MULTI_MODULES.map((mod) => {
            const disabled = cvCount < 2;
            return (
              <button
                key={mod.id}
                disabled={disabled}
                onClick={() => !disabled && setActiveModule(mod.id)}
                className={clsx(
                  'w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-medium rounded-md transition-all',
                  disabled ? 'opacity-30 cursor-not-allowed' : '',
                  activeModule === mod.id
                    ? 'bg-white text-black'
                    : !disabled ? 'text-gray-400 hover:bg-white/8 hover:text-white' : 'text-gray-600'
                )}
              >
                <mod.icon className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1 text-left">{mod.label}</span>
                {!disabled && (
                  <ModuleStatusDot id={mod.id} moduleLoading={moduleLoading} moduleResults={moduleResults} moduleErrors={moduleErrors} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-3 border-t border-white/10 shrink-0">
        <div className="flex gap-3 text-[10px] text-gray-600 px-2">
          {Object.values(moduleResults).filter(Boolean).length > 0 && (
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              {Object.values(moduleResults).filter(Boolean).length} loaded
            </span>
          )}
          {Object.values(moduleErrors).filter(Boolean).length > 0 && (
            <span className="flex items-center gap-1">
              <AlertCircle className="w-3 h-3 text-red-400" />
              {Object.values(moduleErrors).filter(Boolean).length} failed
            </span>
          )}
        </div>
      </div>
    </aside>
  );
}
