import React, { useEffect, useRef, useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { onAccessPrompt, resolveAccessPrompt, verifyAccessCode } from '../apiAccess';

// Asks for the TalentGPT access code the first time an AI feature needs it.
export function AccessCodePrompt() {
  const [open, setOpen]       = useState(false);
  const [code, setCode]       = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => onAccessPrompt(o => { setOpen(o); if (o) { setCode(''); setError(null); } }), []);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = code.trim();
    if (!value) return;
    setChecking(true);
    setError(null);
    try {
      if (await verifyAccessCode(value)) resolveAccessPrompt(value);
      else setError('That code is not correct.');
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="access-code-title"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4">
        <div className="px-6 pt-5 pb-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
            <KeyRound className="w-4 h-4 text-gray-700" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="access-code-title" className="font-bold text-gray-900">Enter access code</h2>
            <p className="text-xs text-gray-500 mt-1">AI features need your TalentGPT access code. It's remembered in this browser.</p>
            <input ref={inputRef} type="password" value={code} onChange={e => setCode(e.target.value)}
              autoComplete="off" placeholder="Access code"
              className="mt-3 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400" />
            {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
          </div>
        </div>
        <div className="px-6 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button type="button" onClick={() => resolveAccessPrompt(null)}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-all">
            Cancel
          </button>
          <button type="submit" disabled={checking || !code.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-black rounded-lg hover:bg-gray-800 disabled:opacity-40 transition-all">
            {checking && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Unlock
          </button>
        </div>
      </form>
    </div>
  );
}
