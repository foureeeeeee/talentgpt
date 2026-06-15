const TALENTGPT = 'http://localhost:3000';

const app = document.getElementById('app');

// ── helpers ──────────────────────────────────────────────────────────────────

function isProfileUrl(url) {
  return url && /linkedin\.com\/in\/[^/?#]+/.test(url);
}

// Extract a readable name from a LinkedIn profile URL slug.
// linkedin.com/in/john-smith-3b4c5d  →  "John Smith"
// linkedin.com/in/jane-doe-123456    →  "Jane Doe"
function nameFromUrl(url) {
  const m = url && url.match(/linkedin\.com\/in\/([^/?#]+)/);
  if (!m) return '';
  return m[1]
    .replace(/-[0-9a-f]{5,}$/i, '')   // strip trailing hex ID  (e.g. -3b4c5d)
    .replace(/-\d{4,}$/, '')           // strip trailing numeric ID (e.g. -123456)
    .replace(/-/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function setStatus(type, html) {
  const el = document.getElementById('status');
  if (!el) return;
  el.className = 'status ' + type;
  el.innerHTML = html;
}

function setBtn(state, label) {
  const btn = document.getElementById('send-btn');
  if (!btn) return;
  if (state === 'loading') {
    btn.disabled = true;
    btn.className = 'btn btn-primary';
    btn.innerHTML = '<div class="spinner"></div>' + label;
  } else if (state === 'success') {
    btn.disabled = true;
    btn.className = 'btn btn-success';
    btn.innerHTML = '✓ ' + label;
  } else {
    btn.disabled = false;
    btn.className = 'btn btn-primary';
    btn.innerHTML = label;
  }
}

// ── DOM extraction (runs inside the LinkedIn tab) ────────────────────────────

async function extractProfile() {
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // ── Pass 1: scroll to trigger lazy-loaded sections ─────────────────────────
  async function scrollPass() {
    const h = Math.max(document.body.scrollHeight, 4000);
    for (let i = 1; i <= 10; i++) {
      window.scrollTo(0, (h / 10) * i);
      await wait(250);
    }
    await wait(600);
  }

  // ── Expand every collapsed section ("Show all", "See more", etc.) ──────────
  async function expandAll() {
    const keywords = ['show all', 'see all', 'show more', 'see more', 'load more', 'view all'];
    const candidates = [
      ...document.querySelectorAll('button'),
      ...document.querySelectorAll('a[role="button"]'),
      ...document.querySelectorAll('span[role="button"]'),
    ];
    let clicked = 0;
    for (const el of candidates) {
      const label = (
        (el.innerText || '') + ' ' +
        (el.getAttribute('aria-label') || '')
      ).toLowerCase();
      if (keywords.some(kw => label.includes(kw))) {
        try { el.click(); clicked++; } catch {}
        if (clicked % 5 === 0) await wait(300);
      }
    }
    if (clicked > 0) await wait(800);
  }

  await scrollPass();
  await expandAll();
  await scrollPass();   // second pass after content is revealed
  window.scrollTo(0, 0);
  await wait(300);

  // ── Section finder (three strategies) ─────────────────────────────────────
  // Strategy A: direct id look-up (LinkedIn encodes section ids reliably)
  // Strategy B: aria-label on the section element
  // Strategy C: scan heading text (span[aria-hidden], h2, h3) then walk up to <section>
  function findSection(variants) {
    const list = Array.isArray(variants) ? variants : [variants];

    for (const v of list) {
      const slug = v.toLowerCase().replace(/\s*[&/]\s*/g, '_').replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

      // A — by id
      for (const id of [slug, slug.replace(/_/g, '-'), v.toLowerCase().replace(/\s+/g, '_')]) {
        const el = document.getElementById(id);
        if (el) return el.tagName === 'SECTION' ? el : (el.closest('section') || el);
      }

      // B — section[aria-label]
      const byLabel = document.querySelector(`section[aria-label*="${v}" i]`);
      if (byLabel) return byLabel;

      // C — heading text scan
      const headingSelectors = [
        'span[aria-hidden="true"]',
        'h2', 'h3',
        '[class*="pvs-header__title"] span',
        '[class*="section-title"] span',
        '[class*="pv-profile-section__headline"]',
      ].join(', ');

      for (const el of document.querySelectorAll(headingSelectors)) {
        const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (txt === v.toLowerCase() || txt === slug.replace(/_/g, ' ')) {
          let node = el;
          for (let i = 0; i < 12; i++) {
            if (!node.parentElement) break;
            node = node.parentElement;
            if (node.tagName === 'SECTION') return node;
          }
        }
      }
    }
    return null;
  }

  // ── Text cleaner ───────────────────────────────────────────────────────────
  // NOTE: do NOT use [aria-hidden="true"] + * here — LinkedIn puts aria-hidden on icon
  // spans and the NEXT sibling is the real text (job title, company name, etc.).
  function clean(el, maxLen = 6000) {
    if (!el) return '';
    const c = el.cloneNode(true);
    // Only remove elements that are genuinely empty (icons, images with no text)
    c.querySelectorAll('svg, img, .visually-hidden, .sr-only').forEach(e => {
      if (!(e.innerText || e.textContent || '').trim()) e.remove();
    });
    return (c.innerText || c.textContent || '')
      .replace(/\t/g, ' ')
      .replace(/ {3,}/g, '  ')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim()
      .slice(0, maxLen);
  }

  // ── Extract all profile sections ───────────────────────────────────────────
  const SECTIONS = [
    { key: 'About',                    variants: ['About', 'about'] },
    { key: 'Experience',               variants: ['Experience', 'experience'] },
    { key: 'Education',                variants: ['Education', 'education'] },
    { key: 'Skills',                   variants: ['Skills', 'skills', 'Top skills'] },
    { key: 'Licenses & Certifications',variants: ['Licenses & certifications', 'Licenses and certifications', 'Certifications', 'licenses_and_certifications', 'Licenses & Certifications'] },
    { key: 'Honors & Awards',          variants: ['Honors & awards', 'Honors and awards', 'Awards', 'honors_and_awards', 'Honors & Awards'] },
    { key: 'Publications',             variants: ['Publications', 'publications'] },
    { key: 'Languages',                variants: ['Languages', 'languages'] },
    { key: 'Volunteer Experience',     variants: ['Volunteer experience', 'Volunteering', 'volunteer_experience', 'Volunteer'] },
    { key: 'Courses',                  variants: ['Courses', 'courses'] },
    { key: 'Patents',                  variants: ['Patents', 'patents'] },
    { key: 'Projects',                 variants: ['Projects', 'projects'] },
    { key: 'Recommendations',          variants: ['Recommendations', 'recommendations'] },
    { key: 'Organizations',            variants: ['Organizations', 'organizations'] },
    { key: 'Test Scores',              variants: ['Test scores', 'test_scores'] },
  ];

  const sections = {};
  for (const def of SECTIONS) {
    const el = findSection(def.variants);
    if (el) {
      const text = clean(el);
      if (text.length > 15) sections[def.key] = text;
    }
  }

  // ── Full page text — read from main content area only ─────────────────────
  // .scaffold-layout__main is LinkedIn's centre column (profile sections only).
  // It excludes the right sidebar ("People you may know", "Explore more profiles")
  // that would otherwise consume the char budget before Experience/Education.
  const mainEl =
    document.querySelector('.scaffold-layout__main') ||
    document.querySelector('main[role="main"]') ||
    document.querySelector('main') ||
    document.body;

  const mainClone = mainEl.cloneNode(true);
  const noiseSelectors = [
    'nav', 'footer', 'script', 'style', 'noscript',
    '.global-nav', '.artdeco-toast-item',
    '.msg-overlay-container', '[data-view-name*="messaging"]',
    '[aria-label*="messaging"]', '.artdeco-modal-overlay',
  ].join(', ');
  mainClone.querySelectorAll(noiseSelectors).forEach(el => el.remove());

  const fullText = (mainClone.innerText || mainClone.textContent || '')
    .replace(/\t/g, ' ')
    .replace(/ {3,}/g, '  ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, 28000);  // larger limit since we're reading only the profile column

  const domName  = (document.querySelector('h1') || {}).innerText?.trim() || '';
  const headline = (
    document.querySelector('.text-body-medium.break-words') ||
    document.querySelector('[data-generated-suggestion-target]')
  )?.innerText?.trim() || '';
  const location = [...document.querySelectorAll('.text-body-small.inline')]
    .find(el => el.className.includes('t-black') && !el.className.includes('t-bold'))
    ?.innerText?.trim() || '';

  return { url: window.location.href, domName, headline, location, sections, fullText };
}

// ── Send to server ────────────────────────────────────────────────────────────

async function sendToServer(data) {
  const res = await fetch(`${TALENTGPT}/api/receive-linkedin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  return res.json();
}

// ── UI states ─────────────────────────────────────────────────────────────────

function renderNotLinkedIn() {
  app.innerHTML = `
    <div class="empty">
      <div class="icon">🔗</div>
      <h2>Open a LinkedIn profile</h2>
      <p>Navigate to any LinkedIn profile page, then click this extension to send it to TalentGPT.</p>
      <div class="url-hint">linkedin.com/in/<em>username</em></div>
    </div>
    <hr class="divider">
    <div class="steps">
      <div class="step"><div class="step-n">1</div><div class="step-t">Open a LinkedIn profile tab</div></div>
      <div class="step"><div class="step-n">2</div><div class="step-t">Click the <strong>T</strong> extension icon in Chrome's toolbar</div></div>
      <div class="step"><div class="step-n">3</div><div class="step-t">Click <strong>Send Profile</strong> — the page will auto-scroll to load all sections, then send data to TalentGPT</div></div>
      <div class="step"><div class="step-n">4</div><div class="step-t">Switch back to TalentGPT and click <strong>Load from Extension</strong></div></div>
    </div>
  `;
}

function renderLinkedIn(tab) {
  const slug = tab.url.replace(/.*linkedin\.com\/in\//, '').split(/[/?#]/)[0];
  app.innerHTML = `
    <div class="profile-card">
      <div class="dot"></div>
      <div>
        <strong>LinkedIn profile detected</strong><br>
        <span style="color:#374151;word-break:break-all;">linkedin.com/in/${slug}</span>
      </div>
    </div>

    <button class="btn btn-primary" id="send-btn">
      ⚡&nbsp; Send Profile to TalentGPT
    </button>
    <div class="status" id="status"></div>

    <hr class="divider">
    <div class="steps">
      <div class="step"><div class="step-n">1</div><div class="step-t">Click above — the page will auto-scroll to load all sections (About, Experience, Education, Skills…)</div></div>
      <div class="step"><div class="step-n">2</div><div class="step-t">Switch to TalentGPT and click <strong>"Load from Extension"</strong> in the LinkedIn tab</div></div>
      <div class="step"><div class="step-n">3</div><div class="step-t">Profile is structured by AI and added to your candidate list</div></div>
    </div>
  `;

  document.getElementById('send-btn').addEventListener('click', () => handleSend(tab));
}

// ── Main handler ──────────────────────────────────────────────────────────────

async function handleSend(tab) {
  setBtn('loading', 'Loading profile…');
  setStatus('loading', 'Scrolling page, clicking "Show all" expanders, then extracting all sections — takes ~8s…');

  let data;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractProfile,
    });
    data = results?.[0]?.result;
  } catch (err) {
    setBtn('default', '⚡&nbsp; Send Profile to TalentGPT');
    setStatus('error', 'Could not read the page. Make sure you are on a LinkedIn profile and refresh the tab, then try again.<br><em>' + (err?.message || '') + '</em>');
    return;
  }

  if (!data?.fullText || data.fullText.length < 80) {
    setBtn('default', '⚡&nbsp; Send Profile to TalentGPT');
    setStatus('error', 'Profile text was empty. Scroll down on the LinkedIn page manually first, then try again.');
    return;
  }

  // URL slug is the most reliable name source — override whatever the DOM returned
  data.name = nameFromUrl(tab.url) || data.domName || '';

  setBtn('loading', 'Sending to TalentGPT…');
  setStatus('loading', `Extracted ${data.fullText.length.toLocaleString()} characters. Sending to TalentGPT…`);

  try {
    await sendToServer(data);
  } catch (err) {
    setBtn('default', '⚡&nbsp; Send Profile to TalentGPT');
    setStatus('error', 'Could not reach TalentGPT on localhost:3000. Make sure the app is running (<code>npm run dev</code>), then try again.');
    return;
  }

  const displayName = data.name || 'Profile';
  setBtn('success', `${displayName} sent!`);
  setStatus('success', `
    <strong>Done!</strong> Switch to TalentGPT → LinkedIn tab → click <strong>"Load Next Profile"</strong> or <strong>"Add All from Queue"</strong>.<br><br>
    Want to send another? Navigate to the next LinkedIn profile and click below.
    <br><br>
    <button id="send-another-btn" style="margin-top:4px;padding:6px 12px;background:#4f46e5;color:white;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;">
      ← Send Another Profile
    </button>
  `);

  // Wire up "Send Another" without closing the popup
  setTimeout(() => {
    document.getElementById('send-another-btn')?.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (isProfileUrl(tab?.url)) {
        setStatus('', '');
        renderLinkedIn(tab);  // re-render fresh state for this tab
      } else {
        setStatus('error', 'Navigate to a LinkedIn profile page first, then click this button again.');
      }
    });
  }, 50);
}

// ── Init ─────────────────────────────────────────────────────────────────────

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (isProfileUrl(tab?.url)) {
    renderLinkedIn(tab);
  } else {
    renderNotLinkedIn();
  }
})();
