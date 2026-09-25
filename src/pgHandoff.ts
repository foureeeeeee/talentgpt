import { useEffect } from 'react';
import { CV, JobProject } from './types';

// People & Governance handoff receiver (protocol v1).
// P&G posts a project over postMessage; context never travels in a URL.
const ALLOWED = String(import.meta.env.VITE_PG_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

type Handoff = {
  type: 'pg:handoff'; v: 1; nonce: string; ref: string;
  project: { title: string; description: string; managerNotes?: string; candidates?: CV[] };
};

const isHandoff = (d: any): d is Handoff =>
  d && d.type === 'pg:handoff' && d.v === 1 && typeof d.ref === 'string' && /^[A-Z]+-\d+$/.test(d.ref) &&
  d.project && typeof d.project.title === 'string' && typeof d.project.description === 'string';

export function usePgHandoff(onProject: (p: JobProject) => void) {
  useEffect(() => {
    const host = window.parent !== window ? window.parent : window.opener;
    if (!host || !ALLOWED.length) return;
    const onMsg = (e: MessageEvent) => {
      if (!ALLOWED.includes(e.origin) || !isHandoff(e.data)) return;
      const d = e.data;
      const candidates = (d.project.candidates || []).slice(0, 200).map((c) => ({
        id: String(c.id), name: String(c.name).slice(0, 120), type: 'text' as const,
        content: String(c.content || '').slice(0, 60000), // untrusted: existing injection checks still apply
      }));
      onProject({
        id: 'pg-' + d.ref, title: d.project.title.slice(0, 200),
        description: d.project.description.slice(0, 20000),
        managerNotes: String(d.project.managerNotes || '').slice(0, 5000),
        candidates, createdAt: Date.now(),
      });
      (e.source as Window | null)?.postMessage(
        { type: 'talentgpt:handoff-ack', nonce: d.nonce, ref: d.ref, status: 'imported' }, e.origin);
      if (window.opener) window.opener = null; // drop the link back once the handoff lands
    };
    window.addEventListener('message', onMsg);
    host.postMessage({ type: 'talentgpt:ready', v: 1 }, '*'); // carries no data
    return () => window.removeEventListener('message', onMsg);
  }, []);
}
