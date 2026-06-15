import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Upload, Plus, FileText, Briefcase, Linkedin, File, FileType,
  BookOpen, AlertCircle, X, ArrowLeft, Tag, Loader2, CheckCircle2,
} from 'lucide-react';
import { CV, CvInputType } from '../types';

interface SaveData {
  title: string;
  description: string;
  managerNotes: string;
  candidates: CV[];
}

interface InputSectionProps {
  initialData?: SaveData;
  candidatesOnly?: boolean;
  isEdit?: boolean;
  onSave: (data: SaveData) => void;
  onCancel: () => void;
}

async function extractPdfText(fileData: string): Promise<string> {
  try {
    const resp = await fetch('/api/extract-pdf-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileData }),
    });
    if (!resp.ok) return '';
    const { text } = await resp.json();
    return text || '';
  } catch {
    return '';
  }
}

async function fetchLinkedInProfile(url: string): Promise<{ text: string | null; success: boolean }> {
  try {
    const resp = await fetch('/api/fetch-linkedin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!resp.ok) return { text: null, success: false };
    return await resp.json();
  } catch {
    return { text: null, success: false };
  }
}

function nameFromLinkedInUrl(url?: string): string {
  const m = url?.match(/linkedin\.com\/in\/([^/?#]+)/);
  if (!m) return '';
  return m[1]
    .replace(/-[0-9a-f]{5,}$/i, '')
    .replace(/-\d{4,}$/, '')
    .replace(/-/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

async function fetchPendingLinkedin(all = false): Promise<any> {
  try {
    const resp = await fetch(`/api/pending-linkedin${all ? '?all=true' : ''}`);
    if (!resp.ok) return { ok: false };
    return await resp.json();
  } catch {
    return { ok: false };
  }
}

async function cleanLinkedinText(rawText: string): Promise<{ name: string; headline: string; cleanedText: string }> {
  try {
    const resp = await fetch('/api/clean-linkedin-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawText }),
    });
    if (!resp.ok) return { name: '', headline: '', cleanedText: rawText };
    const d = await resp.json();
    return { name: d.name || '', headline: d.headline || '', cleanedText: d.cleanedText || rawText };
  } catch {
    return { name: '', headline: '', cleanedText: rawText };
  }
}

export function InputSection({
  initialData,
  candidatesOnly = false,
  isEdit = false,
  onSave,
  onCancel,
}: InputSectionProps) {
  const [title, setTitle]           = useState(initialData?.title ?? '');
  const [description, setDesc]      = useState(initialData?.description ?? '');
  const [managerNotes, setNotes]    = useState(initialData?.managerNotes ?? '');
  const [cvs, setCvs]               = useState<CV[]>(initialData?.candidates ?? []);

  const [newCvName, setNewCvName]   = useState('');
  const [inputType, setInputType]   = useState<CvInputType>('text');
  const [textContent, setTextContent] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [linkedinPastedText, setLinkedinPastedText] = useState('');
  const [pdfFile, setPdfFile]       = useState<File | null>(null);
  const [pdfBase64, setPdfBase64]   = useState('');
  const [pdfExtractedText, setPdfExtractedText] = useState('');
  const [pdfExtracting, setPdfExtracting]       = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragCount, setDragCount]   = useState(0);
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchCount, setBatchCount]           = useState(0);
  const [batchDone, setBatchDone]             = useState(0);
  const [linkedinFetching, setLinkedinFetching]       = useState(false);
  const [linkedinFetchOk, setLinkedinFetchOk]         = useState<boolean | null>(null);
  const [extLoading, setExtLoading]                   = useState(false);
  const [extLoadingMsg, setExtLoadingMsg]             = useState('');
  const [extStatus, setExtStatus]                     = useState<'idle'|'ok'|'empty'>('idle');
  const [extLoadedName, setExtLoadedName]             = useState('');
  const [extRemaining, setExtRemaining]               = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialData) {
      setTitle(initialData.title);
      setDesc(initialData.description);
      setNotes(initialData.managerNotes);
      setCvs(initialData.candidates);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset per-type state when switching tabs
  useEffect(() => {
    setPdfExtractedText('');
    setPdfExtracting(false);
    setLinkedinFetchOk(null);
  }, [inputType]);

  // Single PDF → populate form + extract text in background
  const processSinglePdf = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) return;
    setPdfFile(file);
    setPdfExtractedText('');
    if (!newCvName) setNewCvName(file.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ').trim());
    const reader = new FileReader();
    reader.onload = async (e) => {
      const b64 = e.target?.result?.toString() || '';
      setPdfBase64(b64);
      setPdfExtracting(true);
      const text = await extractPdfText(b64);
      setPdfExtractedText(text);
      setPdfExtracting(false);
    };
    reader.readAsDataURL(file);
  };

  // Multiple PDFs → auto-process all + extract text per file
  const processBatchPdfs = async (files: File[]) => {
    const pdfs = files.filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (!pdfs.length) return;
    setBatchProcessing(true);
    setBatchCount(pdfs.length);
    setBatchDone(0);

    let done = 0;
    const results = await Promise.all(pdfs.map(file =>
      new Promise<CV>(resolve => {
        const reader = new FileReader();
        reader.onload = async (e) => {
          const b64 = (e.target?.result as string) || '';
          // Extract text for dashboard scoring in parallel with file read
          const [extractedText] = await Promise.all([
            extractPdfText(b64),
            Promise.resolve(), // placeholder to keep shape
          ]);
          done++;
          setBatchDone(done);
          resolve({
            id:       crypto.randomUUID(),
            name:     file.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ').trim() || `Candidate ${cvs.length + done}`,
            type:     'pdf',
            fileData: b64,
            content:  extractedText,
            mimeType: 'application/pdf',
          });
        };
        reader.readAsDataURL(file);
      })
    ));

    setCvs(prev => [...prev, ...results]);
    setBatchProcessing(false);
    setBatchCount(0);
    setBatchDone(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 1) {
      processBatchPdfs(files);
    } else if (files.length === 1) {
      processSinglePdf(files[0]);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    setDragCount(0);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 1) {
      processBatchPdfs(files);
    } else if (files.length === 1) {
      processSinglePdf(files[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the next queued profile → clean it → populate the paste area for review
  const loadFromExtension = async () => {
    setExtLoading(true);
    setExtLoadingMsg('Checking queue…');
    setExtStatus('idle');

    const data = await fetchPendingLinkedin();
    if (!data.ok || !data.rawText) {
      setExtStatus('empty');
      setExtLoading(false);
      return;
    }
    setExtRemaining(data.remaining ?? 0);

    setExtLoadingMsg('Cleaning profile with AI…');
    const { name: aiName, cleanedText } = await cleanLinkedinText(data.rawText);
    // URL slug is the most reliable name — Claude often skips the h1
    const name = nameFromLinkedInUrl(data.url) || aiName || data.name || '';

    setLinkedinPastedText(cleanedText);
    if (!newCvName && name) setNewCvName(name);
    setExtLoadedName(name || 'Profile');
    setExtStatus('ok');
    setExtLoading(false);
  };

  // Load ALL queued profiles → clean in parallel → auto-add as candidates (no form needed)
  const loadAllFromExtension = async () => {
    setExtLoading(true);
    setExtLoadingMsg('Loading all queued profiles…');
    setExtStatus('idle');

    const data = await fetchPendingLinkedin(true);
    if (!data.ok || !data.profiles?.length) {
      setExtStatus('empty');
      setExtLoading(false);
      return;
    }

    setExtLoadingMsg(`Cleaning ${data.profiles.length} profiles with AI…`);

    const cleaned = await Promise.all(
      (data.profiles as Array<{ name: string; url: string; rawText: string }>).map(async (p, i) => {
        const { name: aiName, cleanedText } = await cleanLinkedinText(p.rawText);
        const name = nameFromLinkedInUrl(p.url) || aiName || p.name || `Candidate ${cvs.length + i + 1}`;
        return { name, text: cleanedText };
      })
    );

    const newCvs: CV[] = cleaned.map(c => ({
      id:      crypto.randomUUID(),
      name:    c.name,
      type:    'linkedin' as const,
      content: c.text,
    }));

    setCvs(prev => [...prev, ...newCvs]);
    setExtRemaining(0);
    setExtLoadedName(`${cleaned.length} candidate${cleaned.length > 1 ? 's' : ''} added`);
    setExtStatus('ok');
    setExtLoading(false);
  };

  const isAddDisabled = () => {
    if (linkedinFetching) return true;
    if (pdfExtracting) return false; // allow adding while extracting (text may still come in)
    if (inputType === 'text')     return !textContent.trim();
    if (inputType === 'linkedin') return !linkedinUrl.trim() && !linkedinPastedText.trim();
    if (inputType === 'pdf')      return !pdfBase64;
    return true;
  };

  const handleAddCv = async () => {
    if (isAddDisabled()) return;

    if (inputType === 'linkedin') {
      const url = linkedinUrl.trim();
      let profileText = linkedinPastedText.trim();

      // Only call the fetch API if a URL was provided and we have no pasted text yet
      if (url && !profileText) {
        setLinkedinFetching(true);
        setLinkedinFetchOk(null);
        const { text, success } = await fetchLinkedInProfile(url);
        setLinkedinFetching(false);
        setLinkedinFetchOk(success);
        profileText = text || '';
      }

      const cv: CV = {
        id:      crypto.randomUUID(),
        name:    newCvName.trim() || `Candidate ${cvs.length + 1}`,
        type:    'linkedin',
        content: profileText || (url ? `LinkedIn Profile: ${url}` : ''),
      };
      setCvs(prev => [...prev, cv]);
      setNewCvName('');
      setLinkedinUrl('');
      setLinkedinFetchOk(null);
      setLinkedinPastedText('');
      setExtStatus('idle');
      setExtRemaining(0);
      return;
    }

    const cv: CV = {
      id:       crypto.randomUUID(),
      name:     newCvName.trim() || `Candidate ${cvs.length + 1}`,
      type:     inputType,
      content:  inputType === 'text' ? textContent.trim()
              : inputType === 'pdf'  ? pdfExtractedText   // text for dashboard scoring
              : undefined,
      fileData: inputType === 'pdf' ? pdfBase64 : undefined,
      mimeType: inputType === 'pdf' ? pdfFile?.type || 'application/pdf' : undefined,
    };
    setCvs(prev => [...prev, cv]);
    setNewCvName(''); setTextContent(''); setLinkedinUrl('');
    setPdfFile(null); setPdfBase64(''); setPdfExtractedText('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeCv = (id: string) => setCvs(prev => prev.filter(c => c.id !== id));

  const canSave = candidatesOnly ? cvs.length > 0 : title.trim().length > 0;

  const handleSave = () => {
    if (!canSave) return;
    onSave({ title: title.trim() || 'Untitled Job', description, managerNotes, candidates: cvs });
  };

  const saveLabel = candidatesOnly
    ? `Add ${cvs.length} Candidate${cvs.length !== 1 ? 's' : ''} to Project`
    : isEdit ? 'Update Job Project' : 'Save Job Project';

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto py-8 px-6">
        {/* Page header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {candidatesOnly ? 'Add Candidates' : isEdit ? 'Edit Job Project' : 'New Job Project'}
            </h1>
            <p className="text-sm text-gray-400 mt-0.5">
              {candidatesOnly
                ? 'Upload or paste candidate profiles to add to this job.'
                : 'Fill in the job details and add candidate profiles.'}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
            Cancel
          </button>
        </div>

        <div className={`grid gap-8 ${candidatesOnly ? 'grid-cols-1 max-w-2xl' : 'grid-cols-1 md:grid-cols-2'}`}>

          {/* ── Left column: JD fields (hidden in candidatesOnly) ── */}
          {!candidatesOnly && (
            <div className="space-y-6 flex flex-col">
              <div>
                <label className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-2">
                  <Tag className="w-4 h-4" />
                  Job Title
                  <span className="text-xs font-normal text-red-400">Required</span>
                </label>
                <input
                  type="text"
                  className="w-full px-4 py-2.5 text-sm bg-white border border-gray-200 rounded-xl focus:border-gray-900 focus:ring-1 focus:ring-gray-900 outline-none transition-colors shadow-sm"
                  placeholder="e.g. Senior Software Engineer"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                />
              </div>

              <div className="flex-1 min-h-[260px] flex flex-col">
                <label className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-2">
                  <Briefcase className="w-4 h-4" />
                  Job Description
                  <span className="text-xs font-normal text-gray-400">Optional</span>
                </label>
                <textarea
                  className="w-full flex-1 p-4 text-sm bg-white border border-gray-200 rounded-xl focus:border-gray-900 focus:ring-1 focus:ring-gray-900 outline-none resize-none shadow-sm transition-colors"
                  placeholder="Paste the full job description here…"
                  value={description}
                  onChange={e => setDesc(e.target.value)}
                />
              </div>

              <div className="h-[160px] flex flex-col shrink-0">
                <label className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-2">
                  <BookOpen className="w-4 h-4" />
                  Manager Notes
                  <span className="text-xs font-normal text-gray-400">Optional</span>
                </label>
                <textarea
                  className="w-full flex-1 p-4 text-sm bg-white border border-gray-200 rounded-xl focus:border-gray-900 focus:ring-1 focus:ring-gray-900 outline-none resize-none shadow-sm transition-colors"
                  placeholder="Extra context, team dynamics, or priorities for the AI…"
                  value={managerNotes}
                  onChange={e => setNotes(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* ── Right column: Candidates ── */}
          <div className="space-y-5 flex flex-col">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Candidate Profiles
              </h2>
              <p className="text-xs text-gray-400 mt-1">Upload a PDF, paste plain text, or add a LinkedIn URL.</p>
            </div>

            {/* Add candidate form */}
            <div className="bg-gray-50 p-4 border border-gray-200 rounded-xl space-y-3"
                 onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handleAddCv(); }}>
              <input
                type="text"
                className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:border-gray-900 focus:ring-1 focus:ring-gray-900 outline-none transition-colors"
                placeholder="Candidate name (e.g. Jane Doe)"
                value={newCvName}
                onChange={e => setNewCvName(e.target.value)}
              />

              {/* Type toggle */}
              <div className="flex bg-gray-200/60 p-1 rounded-lg">
                {(['text', 'pdf', 'linkedin'] as CvInputType[]).map(type => (
                  <button
                    key={type}
                    onClick={() => setInputType(type)}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1.5 ${
                      inputType === type ? 'bg-black text-white shadow-sm' : 'text-gray-500 hover:text-black hover:bg-white/70'
                    }`}
                  >
                    {type === 'text'     && <FileType className="w-3.5 h-3.5" />}
                    {type === 'pdf'      && <File     className="w-3.5 h-3.5" />}
                    {type === 'linkedin' && <Linkedin className="w-3.5 h-3.5" />}
                    {type === 'text' ? 'Text' : type === 'pdf' ? 'PDF' : 'LinkedIn'}
                  </button>
                ))}
              </div>

              {/* Text input */}
              {inputType === 'text' && (
                <textarea
                  className="w-full h-36 p-3 text-sm bg-white border border-gray-200 rounded-lg focus:border-gray-900 focus:ring-1 focus:ring-gray-900 outline-none resize-none transition-colors"
                  placeholder="Paste CV text here… (⌘↵ to add)"
                  value={textContent}
                  onChange={e => setTextContent(e.target.value)}
                />
              )}

              {/* LinkedIn input */}
              {inputType === 'linkedin' && (
                <div className="space-y-2">
                  {/* Chrome Extension — Option A (recommended) */}
                  <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-indigo-600 text-sm leading-none">⚡</span>
                        <p className="text-[11px] font-semibold text-indigo-800">Chrome Extension</p>
                        <span className="text-[10px] text-indigo-400 font-normal">recommended · full DOM · no login wall</span>
                      </div>
                      {extRemaining > 0 && !extLoading && (
                        <span className="text-[10px] font-semibold bg-indigo-600 text-white px-2 py-0.5 rounded-full">
                          {extRemaining} more waiting
                        </span>
                      )}
                    </div>

                    {/* Loading state */}
                    {extLoading && (
                      <div className="flex items-center gap-2 text-[11px] text-indigo-700">
                        <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                        <span>{extLoadingMsg}</span>
                      </div>
                    )}

                    {/* Result states */}
                    {!extLoading && extStatus === 'ok' && (
                      <div className="flex items-center gap-1.5 text-[11px] text-emerald-700">
                        <CheckCircle2 className="w-3 h-3 shrink-0" />
                        <span>{extLoadedName} — review text below, then click Add Candidate{extRemaining > 0 ? ` (${extRemaining} more in queue)` : ''}</span>
                      </div>
                    )}
                    {!extLoading && extStatus === 'empty' && (
                      <p className="text-[10px] text-amber-600">No profiles in queue — use the extension on a LinkedIn profile page first.</p>
                    )}

                    {/* Action buttons */}
                    {!extLoading && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={loadFromExtension}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
                        >
                          ↓ Load Next Profile
                        </button>
                        <button
                          type="button"
                          onClick={loadAllFromExtension}
                          title="Load every queued profile, clean with AI, and add all as candidates instantly"
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-100 rounded-lg transition-colors"
                        >
                          ⚡ Add All from Queue
                        </button>
                      </div>
                    )}

                    <p className="text-[10px] text-indigo-400 leading-snug">
                      Install: <strong>chrome://extensions</strong> → Developer mode → Load unpacked → select <code className="bg-indigo-100 px-0.5 rounded">chrome-extension/</code> folder.
                      Open a LinkedIn profile → click <strong>T</strong> → Send Profile. Repeat for each candidate, then click Add All.
                    </p>
                  </div>

                  {/* Divider */}
                  <div className="flex items-center gap-2 py-1">
                    <div className="flex-1 h-px bg-gray-200" />
                    <span className="text-[10px] text-gray-400 font-medium">or use URL / paste</span>
                    <div className="flex-1 h-px bg-gray-200" />
                  </div>

                  <input
                    type="url"
                    className="w-full px-3 py-2.5 text-sm bg-white border border-gray-200 rounded-lg focus:border-gray-900 focus:ring-1 focus:ring-gray-900 outline-none transition-colors"
                    placeholder="https://linkedin.com/in/username"
                    value={linkedinUrl}
                    onChange={e => { setLinkedinUrl(e.target.value); setLinkedinFetchOk(null); }}
                  />

                  {linkedinFetching ? (
                    <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg p-2.5">
                      <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin shrink-0" />
                      <div>
                        <p className="text-[11px] text-blue-700 font-medium">Fetching profile via AI reader…</p>
                        <p className="text-[10px] text-blue-500 mt-0.5">Rendering page + extracting text with Claude (up to 25s)</p>
                      </div>
                    </div>
                  ) : linkedinFetchOk === true ? (
                    <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg p-2.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <p className="text-[11px] text-emerald-700">Profile extracted successfully. You can also paste additional text below.</p>
                    </div>
                  ) : linkedinFetchOk === false ? (
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-amber-700 leading-snug">
                        Could not fetch profile (LinkedIn login required). Please paste the profile text below.
                      </p>
                    </div>
                  ) : null}

                  {/* Profile text area — populated by extension loader or manual paste */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-medium text-gray-500">
                        Profile text
                        <span className="text-gray-400 font-normal ml-1">
                          {linkedinPastedText.trim()
                            ? '— AI-cleaned · edit if needed'
                            : '— loaded from extension or paste manually'}
                        </span>
                      </p>
                      {linkedinPastedText.trim() && (
                        <button
                          type="button"
                          onClick={() => { setLinkedinPastedText(''); setExtStatus('idle'); }}
                          className="text-[10px] text-gray-400 hover:text-red-500 transition-colors"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <textarea
                      rows={linkedinPastedText.trim() ? 10 : 5}
                      className="w-full px-3 py-2.5 text-xs bg-white border border-gray-200 rounded-lg focus:border-gray-900 focus:ring-1 focus:ring-gray-900 outline-none transition-colors resize-none font-mono leading-relaxed"
                      placeholder={"Name: John Smith\nHeadline: Senior Software Engineer at Google\nLocation: San Francisco, CA\n\nAbout\nPassionate engineer with 10+ years...\n\nExperience\nGoogle — Senior Engineer (2020–Present)\n...\n\nEducation\nMIT — BS Computer Science (2012–2016)\n\nSkills\nPython, TypeScript, React, ..."}
                      value={linkedinPastedText}
                      onChange={e => setLinkedinPastedText(e.target.value)}
                    />
                    {linkedinPastedText.trim() && (
                      <p className="text-[10px] text-emerald-600 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        {linkedinPastedText.length.toLocaleString()} chars · ready for analysis
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* PDF input */}
              {inputType === 'pdf' && (
                batchProcessing ? (
                  <div className="border-2 border-dashed border-black/30 rounded-lg p-6 bg-black/[0.02] flex flex-col items-center justify-center text-center">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-500 mb-2" />
                    <p className="text-sm font-semibold text-gray-700">
                      Processing {batchDone}/{batchCount} files…
                    </p>
                    <div className="w-32 h-1.5 bg-gray-200 rounded-full mt-2 overflow-hidden">
                      <div
                        className="h-full bg-black rounded-full transition-all duration-300"
                        style={{ width: `${batchCount > 0 ? (batchDone / batchCount) * 100 : 0}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1">Extracting text for scoring…</p>
                  </div>
                ) : (
                  <div
                    className={`relative border-2 border-dashed rounded-lg p-6 bg-white flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                      isDragging
                        ? 'border-black bg-gray-50 scale-[1.01]'
                        : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
                    }`}
                    onClick={() => fileInputRef.current?.click()}
                    onDrop={handleDrop}
                    onDragOver={e => { e.preventDefault(); setIsDragging(true); setDragCount(e.dataTransfer.items.length); }}
                    onDragLeave={() => { setIsDragging(false); setDragCount(0); }}
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      accept=".pdf"
                      multiple
                      className="hidden"
                    />

                    {isDragging && dragCount > 1 && (
                      <span className="absolute top-2 right-2 bg-black text-white text-[10px] px-2 py-0.5 rounded-full font-bold">
                        {dragCount} files
                      </span>
                    )}

                    <Upload className={`w-7 h-7 mb-2 transition-colors ${isDragging ? 'text-black' : 'text-gray-400'}`} />

                    {pdfFile ? (
                      <>
                        <p className="text-sm font-medium text-gray-800">{pdfFile.name}</p>
                        {pdfExtracting ? (
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <Loader2 className="w-3 h-3 animate-spin text-gray-400" />
                            <span className="text-[10px] text-gray-400">Extracting text for scoring…</span>
                          </div>
                        ) : pdfExtractedText ? (
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                            <span className="text-[10px] text-emerald-600">
                              {pdfExtractedText.split(/\s+/).length.toLocaleString()} words extracted — ready to score
                            </span>
                          </div>
                        ) : (
                          <span className="text-[10px] text-gray-400 mt-1">PDF loaded</span>
                        )}
                      </>
                    ) : isDragging && dragCount > 1 ? (
                      <>
                        <p className="text-sm font-semibold text-gray-800">Drop {dragCount} PDFs — all will be added</p>
                        <p className="text-xs text-gray-400 mt-1">Names auto-filled from filenames</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-gray-600">Drop PDF(s) here or click to browse</p>
                        <p className="text-xs text-gray-400 mt-1">Multiple files supported · Text extracted automatically for scoring</p>
                      </>
                    )}
                  </div>
                )
              )}

              <button
                onClick={handleAddCv}
                disabled={isAddDisabled()}
                className="w-full py-2.5 bg-black text-white rounded-lg text-xs font-bold tracking-wide hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {linkedinFetching ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Fetching profile…</>
                ) : (
                  <><Plus className="w-4 h-4" /> Add Candidate</>
                )}
              </button>
            </div>

            {/* Candidate list */}
            {cvs.length > 0 && (
              <div className="space-y-2 flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-gray-600 flex items-center gap-2">
                    Added
                    <span className="bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded-full text-[10px] font-bold">{cvs.length}</span>
                  </h3>
                  {cvs.length > 1 && (
                    <button onClick={() => setCvs([])} className="text-[11px] text-gray-400 hover:text-red-500 transition-colors">
                      Clear all
                    </button>
                  )}
                </div>
                <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                  {cvs.map((cv, idx) => (
                    <div key={cv.id} className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-3 py-2.5 hover:border-gray-400 transition-colors group">
                      <div className="flex items-center gap-2.5 overflow-hidden">
                        <span className="text-[10px] text-gray-400 font-mono w-4 shrink-0">{idx + 1}</span>
                        <div className="p-1.5 bg-gray-50 rounded shrink-0">
                          {cv.type === 'text'     && <FileType className="w-3.5 h-3.5 text-gray-600" />}
                          {cv.type === 'pdf'      && <File     className="w-3.5 h-3.5 text-gray-600" />}
                          {cv.type === 'linkedin' && <Linkedin className="w-3.5 h-3.5 text-gray-600" />}
                        </div>
                        <div className="overflow-hidden">
                          <p className="text-sm font-medium text-gray-800 truncate">{cv.name}</p>
                          <p className="text-[10px] text-gray-400">
                            {cv.type === 'pdf'
                              ? cv.content
                                ? `PDF · ${cv.content.split(/\s+/).length.toLocaleString()} words`
                                : 'PDF · no text (scoring unavailable)'
                              : cv.type === 'linkedin'
                                ? cv.content?.startsWith('LinkedIn Profile:')
                                  ? 'LinkedIn · URL only'
                                  : 'LinkedIn · profile fetched'
                                : 'Text'}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => removeCv(cv.id)}
                        className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Save button */}
            <div className="pt-2 mt-auto shrink-0 space-y-2">
              <button
                onClick={handleSave}
                disabled={!canSave}
                className="w-full py-3.5 bg-black text-white rounded-xl text-sm font-bold tracking-wide hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg active:scale-[0.99]"
              >
                {saveLabel}
              </button>
              {!candidatesOnly && !title.trim() && (
                <p className="text-center text-[11px] text-amber-500">Enter a job title to save</p>
              )}
              {cvs.length > 0 && (
                <p className="text-center text-[11px] text-gray-400">
                  {cvs.length} candidate{cvs.length !== 1 ? 's' : ''} ready
                  {!candidatesOnly && ' · add to project then run analysis from dashboard'}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
