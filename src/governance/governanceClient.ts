/**
 * governanceClient.ts — federation client for TalentGPT (Node/Express).
 *
 * INSTALL
 * -------
 *   1. Copy this file to talentgpt/src/governance/governanceClient.ts
 *   2. Add to .env:
 *        GOVERNANCE_SIGNING_KEY=<value from the hub's printSigningKey()>
 *        GOVERNANCE_URL=<the hub's /exec URL>
 *   3. In server.ts, mount the router and guard the analysis routes:
 *
 *        import { federationRouter, requireGovernance, requireCapability, audit }
 *          from './src/governance/governanceClient';
 *
 *        app.use('/api/federation', federationRouter());
 *        app.use('/api', requireGovernance());
 *        app.post('/api/analyze', requireCapability('talent.candidate.view'), ...)
 *
 *   4. Register http://<host>/api/federation as TALENT in the hub's
 *      Domain_Registry.
 *
 * WHY THIS MATTERS MOST HERE
 * --------------------------
 * Of the three domains, TalentGPT has the largest governance gap. It has no
 * authentication, no authorisation and no audit trail: every /api/analyze call
 * is anonymous, and candidate CVs — name, contact details, education, work
 * history, and an AI assessment of the person — are processed with no record of
 * who asked. This file closes that gap without touching the analysis code.
 *
 * CRYPTOGRAPHIC COMPATIBILITY
 * ---------------------------
 * Byte-compatible with the hub's Federation.gs and GovernanceClient.gs. Apps
 * Script's Utilities.computeHmacSha256Signature(string, key) hashes the UTF-8
 * bytes of both, which is what createHmac does here. Same version tag, same
 * signing input, same base64url. All three must change together.
 */

import crypto from 'crypto';
import type { Request, Response, NextFunction, RequestHandler, Router } from 'express';
import express from 'express';

const VERSION = 'v1';
const ISSUER = 'GRETECH-GOV';
const LEEWAY_SECONDS = 60;
const DOMAIN_CODE = 'TALENT';

export interface Principal {
  email: string;
  employeeId: string;
  name: string;
  department: string;
  platformRole: string;
  domainRoles: Record<string, string>;
  capabilities: string[];
  sessionRef: string;
  issuedAt: number;
  expiresAt: number;
  token: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { principal?: Principal; }
  }
}

// ---------------------------------------------------------------------------
// Capability model — mirrors the hub's Rbac.gs for the Talent domain only
// ---------------------------------------------------------------------------

/**
 * Recomputed here from the token's roles rather than carried in the token, so
 * the hub stays the single definition of the matrix and correcting it does not
 * require reissuing anyone's session. Only the TALENT slice is mirrored: this
 * process has no business deciding what someone may do in Case or Asset.
 */
const TALENT_CAPS: Record<string, string[]> = {
  VIEWER:         ['talent.open', 'talent.candidate.view'],
  RECRUITER:      ['talent.open', 'talent.candidate.view', 'talent.candidate.manage'],
  HIRING_MANAGER: ['talent.open', 'talent.candidate.view', 'talent.candidate.manage'],
  TALENT_ADMIN:   ['talent.open', 'talent.candidate.view', 'talent.candidate.manage',
                   'talent.audit.view'],
};

const PLATFORM_TALENT_CAPS: Record<string, string[]> = {
  HR: ['talent.open', 'talent.candidate.view', 'talent.candidate.manage'],
};

function capabilitiesFor(platformRole: string, domainRoles: Record<string, string>): string[] {
  const set = new Set<string>(['portal.access']);
  (PLATFORM_TALENT_CAPS[platformRole] || []).forEach((c) => set.add(c));
  (TALENT_CAPS[domainRoles[DOMAIN_CODE]] || []).forEach((c) => set.add(c));
  return [...set].sort();
}

// ---------------------------------------------------------------------------
// Token verification
// ---------------------------------------------------------------------------

function signingKey(): string {
  const key = process.env.GOVERNANCE_SIGNING_KEY;
  if (!key) {
    // Never a default. A signing routine that quietly falls back to a constant
    // verifies everything and proves nothing, and the failure is invisible
    // precisely because the app keeps working.
    throw new Error('GOVERNANCE_SIGNING_KEY is not set.');
  }
  return key;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export type VerifyResult =
  | { ok: true; principal: Principal }
  | { ok: false; reason: string };

export function verifyToken(token: string | undefined): VerifyResult {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'MISSING' };

  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'MALFORMED' };
  if (parts[0] !== VERSION) return { ok: false, reason: 'VERSION' };

  const signingInput = `${parts[0]}.${parts[1]}`;

  let expected: string;
  try {
    expected = b64url(crypto.createHmac('sha256', signingKey()).update(signingInput, 'utf8').digest());
  } catch {
    return { ok: false, reason: 'NO_KEY' };
  }

  // Signature BEFORE parsing — the payload is attacker-supplied until this
  // passes. timingSafeEqual needs equal lengths, so guard first.
  const a = Buffer.from(expected);
  const b = Buffer.from(parts[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'BAD_SIGNATURE' };
  }

  let claims: any;
  try {
    claims = JSON.parse(b64urlDecode(parts[1]).toString('utf8'));
  } catch {
    return { ok: false, reason: 'BAD_PAYLOAD' };
  }

  if (claims.iss !== ISSUER) return { ok: false, reason: 'BAD_ISSUER' };

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + LEEWAY_SECONDS < now) {
    return { ok: false, reason: 'EXPIRED' };
  }

  const platformRole = claims.prl || 'EMPLOYEE';
  const domainRoles = claims.drl || {};

  return {
    ok: true,
    principal: {
      email: String(claims.sub || '').trim().toLowerCase(),
      employeeId: claims.eid || '',
      name: claims.nam || '',
      department: claims.dep || '',
      platformRole,
      domainRoles,
      capabilities: capabilitiesFor(platformRole, domainRoles),
      sessionRef: claims.jti || '',
      issuedAt: claims.iat,
      expiresAt: claims.exp,
      token,
    },
  };
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Require a valid federation token on every guarded route.
 *
 * Accepts `Authorization: Bearer <token>` or an `X-Governance-Token` header.
 * Not a cookie: the browser must send this deliberately, so a cross-site
 * request cannot carry it along by default and CSRF does not arise.
 */
export function requireGovernance(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.get('authorization');
    const token = header?.startsWith('Bearer ')
      ? header.slice(7).trim()
      : req.get('x-governance-token');

    const result = verifyToken(token);
    if (result.ok === false) {
      // Reason is logged, not returned. "Expired" and "bad signature" tell a
      // caller which half of the problem to work on next.
      console.warn(`[governance] rejected ${req.method} ${req.path}: ${result.reason}`);
      return res.status(401).json({ error: 'Not authenticated. Sign in through the portal.' });
    }

    req.principal = result.principal;
    next();
  };
}

export function requireCapability(capability: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const p = req.principal;
    if (!p) return res.status(401).json({ error: 'Not authenticated.' });

    if (!p.capabilities.includes(capability)) {
      // Denials ARE audited. A refusal is the record that the control worked,
      // and repeated refusals against candidate data are worth being able to find.
      void audit(p, 'ACCESS_DENIED', 'Capability', '',
        `${capability} required for ${req.method} ${req.path}`, 'Denied');
      return res.status(403).json({ error: `You do not have permission (${capability}).` });
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/**
 * Write to the platform's unified audit log.
 *
 * Fire-and-forget and never throws: an audit failure must not fail the analysis
 * it describes. Failures go to the process log, where they are a platform fault.
 *
 * WHAT IS SENT. The action, the module, and a short description — never CV
 * text, never the model's assessment, never the candidate's contact details. An
 * audit row records THAT a named recruiter analysed a named candidate at a given
 * time. The analysis itself stays in the Talent domain.
 */
export async function audit(
  principal: Principal,
  action: string,
  entityType: string,
  recordId: string,
  description: string,
  status: 'Success' | 'Denied' | 'Failure' = 'Success',
): Promise<boolean> {
  const url = process.env.GOVERNANCE_URL;
  if (!url) return false;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'audit',
        token: principal.token,
        module: DOMAIN_CODE,
        auditAction: action,
        entityType,
        recordId,
        description,
        status,
      }),
      signal: AbortSignal.timeout(8000),
    });

    const body = (await res.json()) as { ok?: boolean };
    if (!body.ok) console.warn(`[governance] audit write refused: ${action} ${recordId}`);
    return !!body.ok;
  } catch (err) {
    console.warn(`[governance] audit write failed: ${(err as Error).message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Federation endpoint
// ---------------------------------------------------------------------------

/**
 * Counts for the portal's Talent tile.
 *
 * IMPORTANT, AND A REAL LIMITATION: TalentGPT persists projects and candidates
 * in the BROWSER's localStorage (see src/App.tsx). The server therefore holds no
 * candidate data at all and cannot count it. Rather than invent figures, the
 * default provider reports nothing and the portal tile shows "Metrics
 * unavailable", which is the truth.
 *
 * Supplying a real provider is the remaining integration step for this domain,
 * and it is a genuine architectural change to TalentGPT — moving project state
 * server-side — not a wiring detail. Until then, everything else in this file
 * works: sign-in, authorisation and the audit trail do not depend on it.
 */
export type MetricsProvider = (principal: Principal) => Promise<Record<string, number | null>>;

const unavailableMetrics: MetricsProvider = async () => ({
  candidates: null,
  shortlisted: null,
  highPotential: null,
  auditFlags: null,
});

export function federationRouter(metricsProvider: MetricsProvider = unavailableMetrics): Router {
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));

  router.post('/', async (req: Request, res: Response) => {
    const { action, token } = req.body ?? {};

    if (action === 'ping') {
      return res.json({ ok: true, version: '1.0.0', domain: DOMAIN_CODE });
    }

    if (action !== 'metrics') {
      return res.json({ ok: false, error: 'UNKNOWN_ACTION' });
    }

    const result = verifyToken(token);
    if (!result.ok) return res.json({ ok: false, error: 'INVALID_TOKEN' });

    try {
      // Scoped to the asking user, exactly as the Case and Asset spokes are:
      // the portal tile must never show more than the module itself would.
      return res.json({ ok: true, metrics: await metricsProvider(result.principal) });
    } catch (err) {
      console.error(`[governance] metrics failed: ${(err as Error).message}`);
      return res.json({ ok: false, error: 'METRICS_FAILED' });
    }
  });

  return router;
}

/**
 * Audit an AI analysis run.
 *
 * Spec §12 positions the AI as decision support, not hiring authority. The
 * governance counterpart of that position is this: every run is attributable to
 * the person who requested it, so an AI assessment is always traceable to a
 * human who asked for it and remains answerable for the decision.
 */
export function auditAnalysis(
  principal: Principal,
  module: string,
  candidateCount: number,
  jobTitle: string,
): void {
  void audit(
    principal,
    'AI_ANALYSIS_RUN',
    'Analysis',
    module,
    `${module} analysis run over ${candidateCount} candidate(s)` +
      (jobTitle ? ` for "${jobTitle}"` : ''),
    'Success',
  );
}
