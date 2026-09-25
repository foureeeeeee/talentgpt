// Sends the TalentGPT access code with same-origin /api requests. When the server
// replies ACCESS_CODE_REQUIRED, asks for the code via <AccessCodePrompt> and retries once.

const STORAGE_KEY = 'talentgpt_access_code';
const ACCESS_HEADER = 'x-talentgpt-access-code';

const nativeFetch: typeof fetch = window.fetch.bind(window);

type Waiter = (code: string | null) => void;
let waiters: Waiter[] = [];
let showPrompt: ((open: boolean) => void) | null = null;

function getAccessCode(): string {
  try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; }
}

function saveAccessCode(code: string) {
  try { localStorage.setItem(STORAGE_KEY, code); } catch { /* storage blocked — code lasts this session only */ }
}

let sessionCode = '';

/**
 * Access code handed over by People & Governance for users with governance access.
 * Memory only, never stored, so opening TalentGPT directly by link still asks for the code.
 */
export function setSessionAccessCode(code: string) {
  sessionCode = code;
}

/** Registers the prompt component; returns an unsubscribe function. */
export function onAccessPrompt(fn: (open: boolean) => void) {
  showPrompt = fn;
  return () => { if (showPrompt === fn) showPrompt = null; };
}

/** Checks a code against the server without storing it. */
export async function verifyAccessCode(code: string): Promise<boolean> {
  const r = await nativeFetch('/api/access-check', { method: 'POST', headers: { [ACCESS_HEADER]: code } });
  return r.ok;
}

/** Called by the prompt: a verified code (stored and used for the retry) or null when cancelled. */
export function resolveAccessPrompt(code: string | null) {
  if (code) { sessionCode = code; saveAccessCode(code); }
  const pending = waiters;
  waiters = [];
  showPrompt?.(false);
  pending.forEach(w => w(code));
}

function requestAccessCode(): Promise<string | null> {
  if (!showPrompt) return Promise.resolve(null);
  return new Promise(resolve => {
    waiters.push(resolve);
    if (waiters.length === 1) showPrompt?.(true);
  });
}

async function needsAccessCode(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  try { return (await res.clone().json())?.code === 'ACCESS_CODE_REQUIRED'; } catch { return false; }
}

export function installApiAccess() {
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
      return nativeFetch(input, init);
    }
    const send = (code: string) => {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (code) headers.set(ACCESS_HEADER, code);
      return nativeFetch(input, { ...init, headers });
    };
    let res = await send(sessionCode || getAccessCode());
    if (await needsAccessCode(res)) {
      const code = await requestAccessCode();
      if (code) res = await send(code);
    }
    return res;
  };
}
