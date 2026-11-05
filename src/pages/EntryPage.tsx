// /competitions/:slug/entry/:registrationId — the student's entry, built from the
// competition's settings: files (with progress and retry), extra files, title,
// language, text with a live word count, a link; save, declaration, submit; edit
// until the deadline; withdraw; the receipt. The server decides every deadline.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { errorMessage } from '../store/api';
import { accountToken, authApi } from '../store/account';
import { countWords, istDateTime } from '../shared/competition';
import { preparePhoto, putWithRetry, sizeText } from '../lib/upload';
import { Countdown } from '../components/Countdown';
import { GoogleSignIn } from '../components/GoogleSignIn';
import { regCode } from './CompetitionRegister';

interface FileRow { id: string; kind: 'main' | 'extra'; extraKey: string | null; originalName: string; mimeType: string; sizeBytes: number; verified: boolean; thumbUrl: string | null; viewUrl: string | null }
interface Entry {
  registration: { id: string; status: string; relation: 'parent' | 'self'; studentFirstName: string; classGrade: number; groupName: string; groupFormat: string };
  competition: {
    slug: string; title: string; prompt: string; deadline: string | null; deadlineLabel: string | null; resultsAt: string | null; maxEntries: number;
    rules: { types: ('file' | 'text' | 'link')[]; mimeTypes: string[]; maxFileSizeMb: number; maxMainFiles: number; extraFiles: { key: string; label: string; helpText: string; required: boolean }[];
      minWords: number | null; maxWords: number | null; allowEditUntilDeadline: boolean; allowWithdraw: boolean; declarationText: string; languages: string[] };
  };
  window: { open: boolean; canEdit: boolean; canWithdraw: boolean; reason: string | null };
  submission: null | { id: string; entryCode: string; status: string; title: string; language: string; textContent: string; linkUrl: string; submittedAt: string | null; updatedAt: string; files: FileRow[] };
  others: { id: string; entryCode: string; status: string }[];
}
interface Upload { key: string; name: string; progress: number; error: string | null; retry?: () => void }

const typeLabel = (m: string) => ({ 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WebP', 'application/pdf': 'PDF', 'video/mp4': 'MP4' } as Record<string, string>)[m] ?? m;

export function EntryPage() {
  const { id = '' } = useParams();
  const [e, setE] = useState<Entry | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: '', language: '', textContent: '', linkUrl: '' });
  const [saved, setSaved] = useState('');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [declared, setDeclared] = useState(false);
  const [preview, setPreview] = useState(false);
  const started = useRef(false);

  const apply = useCallback((d: Entry) => {
    setE(d);
    if (d.submission) {
      const next = { title: d.submission.title, language: d.submission.language, textContent: d.submission.textContent, linkUrl: d.submission.linkUrl };
      setDraft(next); setSaved(JSON.stringify(next));
    }
  }, []);
  const load = useCallback(async () => {
    if (!(await accountToken())) { setSignedIn(false); return; }
    setSignedIn(true);
    try {
      const d = await authApi<Entry>(`/my/entries/${id}`);
      apply(d);
      // Opening the page starts the entry (gets its code), if uploads are open.
      if (!d.submission && d.window.canEdit && !started.current) {
        started.current = true;
        apply(await authApi<Entry>(`/my/entries/${id}/draft`, { body: {} }));
      }
    } catch (x) { setErr(errorMessage(x)); }
  }, [id, apply]);
  useEffect(() => { document.title = 'My entry — Elden Academic Press'; load(); }, [load]);

  if (!signedIn) return <section className="wrap page-narrow cp-step"><h1 className="t-h2">Sign in to see the entry</h1><GoogleSignIn onDone={load} /></section>;
  if (err && !e) return <section className="wrap page-narrow cp-step"><h1 className="t-h2">We couldn’t open this entry</h1><p className="t-lead">{err}</p><div><Link to="/account/competitions" className="btn btn--ink btn--md">My entries</Link></div></section>;
  if (!e) return <div className="wrap page-narrow" aria-busy="true"><div className="skeleton skeleton--hero" /></div>;

  const r = e.competition.rules;
  const s = e.submission;
  const editable = e.window.canEdit && Boolean(s);
  const dirty = JSON.stringify(draft) !== saved;
  const words = countWords(draft.textContent);
  const who = e.registration.relation === 'self' ? 'Your' : `${e.registration.studentFirstName}’s`;
  const submitted = s?.status === 'submitted';
  const mains = s?.files.filter((f) => f.kind === 'main') ?? [];

  const run = async (key: string, fn: () => Promise<Entry>, ok?: string) => {
    setBusy(key); setMsg(null);
    try { apply(await fn()); if (ok) setMsg({ ok: true, text: ok }); return true; }
    catch (x) { setMsg({ ok: false, text: errorMessage(x) }); return false; } finally { setBusy(null); }
  };
  const save = () => run('save', () => authApi<Entry>(`/my/submissions/${s!.id}`, { method: 'PUT', body: draft }), 'Saved.');

  /** Prepare, ask for an upload link, send the bytes (with retries), then let the server check it. */
  const addFile = async (file: File, kind: 'main' | 'extra', extraKey?: string) => {
    const key = `${Date.now()}-${file.name}`;
    const update = (patch: Partial<Upload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    setUploads((u) => [...u, { key, name: file.name, progress: 0, error: null }]);
    const go = async () => {
      update({ error: null, progress: 0 });
      try {
        const p = await preparePhoto(file);
        const allowed = kind === 'extra' ? ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] : r.mimeTypes;
        if (!allowed.includes(p.type)) throw new Error(`Please upload ${allowed.map(typeLabel).join(', ')}.`);
        if (p.main.size > r.maxFileSizeMb * 1024 * 1024) throw new Error(`This file is ${sizeText(p.main.size)}; the limit is ${r.maxFileSizeMb} MB.`);
        const slot = await authApi<{ fileId: string; upload: { url: string }; thumb: { url: string } | null }>(`/my/submissions/${s!.id}/files`, {
          body: { kind, extraKey, fileName: p.name, contentType: p.type, size: p.main.size, ...(p.thumb ? { thumb: { size: p.thumb.size } } : {}) },
        });
        await putWithRetry(slot.upload.url, p.main, p.type, (f) => update({ progress: Math.min(0.95, f * 0.95) }));
        if (slot.thumb && p.thumb) await putWithRetry(slot.thumb.url, p.thumb, 'image/jpeg', () => {}).catch(() => {});
        apply(await authApi<Entry>(`/my/submissions/${s!.id}/files/${slot.fileId}/verify`, { method: 'POST' }));
        setUploads((u) => u.filter((x) => x.key !== key));
      } catch (x) {
        update({ error: x instanceof Error ? (x.message.startsWith('Upload failed') || x.message === 'The connection dropped' ? 'The upload stopped (weak connection?).' : errorMessage(x)) : 'The upload stopped.', retry: go });
      }
    };
    await go();
  };
  const accept = r.mimeTypes.join(',');

  return (
    <div className="wrap page-narrow cp-page cp-entry-page">
      <div className="crumbs"><Link to={`/competitions/${e.competition.slug}`}>{e.competition.title}</Link><span>/</span><span className="crumbs__here">Entry</span></div>
      <h1 className="t-h2">{who} entry</h1>
      <div className="cp-card cp-kv">
        <div><span>Student</span><b>{e.registration.studentFirstName} · Class {e.registration.classGrade} · {e.registration.groupName}</b></div>
        {e.registration.groupFormat && <div><span>Format</span><b>{e.registration.groupFormat}</b></div>}
        {s && <div><span>Entry code</span><b>{s.entryCode}</b></div>}
        <div><span>Registration</span><b>{regCode(e.registration.id)}</b></div>
        {e.competition.deadlineLabel && <div><span>Last date</span><b>{e.competition.deadlineLabel}</b></div>}
      </div>
      {e.window.open && e.competition.deadline && <Countdown to={e.competition.deadline} label="Time left" />}

      {submitted && (
        <div className="cp-receipt" role="status">
          <b>✓ Entry received</b>
          <span>{s!.entryCode} · {istDateTime(s!.submittedAt)}</span>
          {mains.length > 0 && <span className="cp-muted">{s!.files.map((f) => f.originalName).join(' · ')}</span>}
          {editable && <span className="cp-muted">You can change it until {e.competition.deadlineLabel}. The latest version counts.</span>}
        </div>
      )}
      {s?.status === 'withdrawn' && <div className="form-notice">This entry was withdrawn.</div>}
      {e.window.reason && !editable && <div className="form-notice">{e.window.reason}</div>}
      {e.competition.prompt && <p className="cp-muted">Theme: <b>{e.competition.prompt}</b></p>}

      {s && !editable && s.files.length > 0 && <FileList files={s.files} />}

      {editable && s && (
        <>
          {r.types.includes('file') && (
            <section className="cp-card">
              <h2 className="cp-h3">Your work</h2>
              <p className="cp-muted">{r.maxMainFiles > 1 ? `Up to ${r.maxMainFiles} files. ` : ''}{r.mimeTypes.map(typeLabel).join(', ')}, up to {r.maxFileSizeMb} MB each. Photos are made smaller on your phone first.</p>
              <FileList files={mains} onRemove={(f) => run(`rm-${f.id}`, () => authApi<Entry>(`/my/submissions/${s.id}/files/${f.id}`, { method: 'DELETE' }))} busy={busy} />
              {mains.length < r.maxMainFiles && (
                <label className="btn btn--accent btn--lg cp-upload">
                  {mains.length ? 'Add another file' : 'Upload your work'}
                  <input type="file" hidden accept={accept} multiple={r.maxMainFiles - mains.length > 1}
                    onChange={(ev) => { const list = [...(ev.target.files ?? [])].slice(0, r.maxMainFiles - mains.length); ev.target.value = ''; list.forEach((f) => addFile(f, 'main')); }} />
                </label>
              )}
            </section>
          )}
          {r.types.includes('file') && r.extraFiles.map((x) => {
            const have = s.files.find((f) => f.kind === 'extra' && f.extraKey === x.key);
            return (
              <section key={x.key} className="cp-card">
                <h2 className="cp-h3">{x.label}{x.required ? '' : ' (optional)'}</h2>
                {x.helpText && <p className="cp-muted">{x.helpText}</p>}
                {have ? <FileList files={[have]} onRemove={(f) => run(`rm-${f.id}`, () => authApi<Entry>(`/my/submissions/${s.id}/files/${f.id}`, { method: 'DELETE' }))} busy={busy} />
                  : <label className="btn btn--outline btn--md cp-upload">Upload<input type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) addFile(f, 'extra', x.key); }} /></label>}
              </section>
            );
          })}
          {uploads.length > 0 && (
            <ul className="cp-uploads">
              {uploads.map((u) => (
                <li key={u.key}>
                  <span>{u.name}</span>
                  {u.error ? <><span className="field__error">{u.error}</span>{u.retry && <button type="button" className="text-link" onClick={u.retry}>Try again</button>}<button type="button" className="text-link" onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))}>Dismiss</button></>
                    : <progress max={1} value={u.progress} aria-label={`Uploading ${u.name}`} />}
                </li>
              ))}
            </ul>
          )}

          <section className="cp-card cp-form">
            <label className="field">Title of the entry (optional)<input className="input" value={draft.title} maxLength={150} onChange={(ev) => setDraft({ ...draft, title: ev.target.value })} /></label>
            {r.languages.length > 1 && (
              <label className="field">Language<select className="input" value={draft.language} onChange={(ev) => setDraft({ ...draft, language: ev.target.value })}>{r.languages.map((l) => <option key={l}>{l}</option>)}</select></label>
            )}
            {r.types.includes('text') && (
              <label className="field">Your {r.types.length === 1 ? 'entry' : 'text'}
                <textarea className="input input--area cp-text" rows={12} value={draft.textContent} onChange={(ev) => setDraft({ ...draft, textContent: ev.target.value })} lang={draft.language === 'Hindi' ? 'hi' : undefined} />
                <span className={'cp-words' + ((r.maxWords && words > r.maxWords) || (r.minWords && words > 0 && words < r.minWords) ? ' is-bad' : '')}>
                  {words} word{words === 1 ? '' : 's'}{r.minWords || r.maxWords ? ` · ${r.minWords ? `at least ${r.minWords}` : ''}${r.minWords && r.maxWords ? ', ' : ''}${r.maxWords ? `at most ${r.maxWords}` : ''}` : ''}
                </span>
              </label>
            )}
            {r.types.includes('link') && <label className="field">Link (e.g. YouTube, unlisted)<input className="input" type="url" inputMode="url" placeholder="https://" value={draft.linkUrl} onChange={(ev) => setDraft({ ...draft, linkUrl: ev.target.value })} /></label>}
            <div className="cp-actions">
              <button type="button" className="btn btn--outline btn--md" disabled={!dirty || busy === 'save'} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>
              <button type="button" className="text-link" onClick={() => setPreview((x) => !x)}>{preview ? 'Hide preview' : 'Preview'}</button>
            </div>
          </section>

          {preview && (
            <section className="cp-card cp-preview">
              <h2 className="cp-h3">{draft.title || 'Untitled entry'}</h2>
              <FileList files={s.files} />
              {draft.textContent && <div className="cp-preview__text">{draft.textContent}</div>}
              {draft.linkUrl && <a href={draft.linkUrl} target="_blank" rel="noopener noreferrer">{draft.linkUrl}</a>}
            </section>
          )}

          <section className="cp-card cp-form">
            <label className="tick">
              <input type="checkbox" checked={declared} onChange={(ev) => setDeclared(ev.target.checked)} />
              <span className="tick__box" aria-hidden="true" />
              <span>{r.declarationText}</span>
            </label>
            <div className="cp-actions">
              <button type="button" className="btn btn--accent btn--lg" disabled={!declared || busy === 'submit' || uploads.some((u) => !u.error)}
                onClick={async () => { if (dirty && !(await save())) return; await run('submit', () => authApi<Entry>(`/my/submissions/${s.id}/submit`, { body: { declaration: true } }), submitted ? 'Changes saved. We’ve emailed a note.' : 'Entry received! We’ve emailed the receipt.'); }}>
                {busy === 'submit' ? 'Sending…' : submitted ? 'Save changes' : 'Submit entry'}
              </button>
              {e.window.canWithdraw && <button type="button" className="text-link cp-danger-link" disabled={busy === 'withdraw'} onClick={() => confirm('Withdraw this entry? It won’t be judged.') && run('withdraw', () => authApi<Entry>(`/my/submissions/${s.id}/withdraw`, { method: 'POST' }), 'Entry withdrawn.')}>Withdraw entry</button>}
            </div>
          </section>
        </>
      )}
      {msg && <div className={msg.ok ? 'cp-ok' : 'form-error'} role="status">{msg.text}</div>}
      {!editable && s?.status === 'withdrawn' && e.window.open && e.registration.status === 'registered' && e.competition.maxEntries > e.others.filter((o) => o.status !== 'withdrawn').length && (
        <div><button type="button" className="btn btn--accent btn--md" onClick={() => run('again', () => authApi<Entry>(`/my/entries/${id}/draft`, { body: { another: true } }))}>Start a new entry</button></div>
      )}
      <p className="cp-muted"><Link to="/account/competitions">All my entries</Link></p>
    </div>
  );
}

function FileList({ files, onRemove, busy }: { files: FileRow[]; onRemove?: (f: FileRow) => void; busy?: string | null }) {
  if (!files.length) return null;
  return (
    <ul className="cp-files">
      {files.map((f) => (
        <li key={f.id}>
          {f.thumbUrl ? <img src={f.thumbUrl} alt="" loading="lazy" /> : <span className="cp-files__icon" aria-hidden="true">{f.mimeType === 'application/pdf' ? 'PDF' : '📄'}</span>}
          <div><b>{f.originalName}</b><span className="cp-muted">{sizeText(f.sizeBytes)}{f.verified ? '' : ' · checking…'}</span></div>
          <span className="cp-actions">
            {f.viewUrl && <a className="text-link" href={f.viewUrl} target="_blank" rel="noopener noreferrer">View</a>}
            {onRemove && <button type="button" className="text-link" disabled={busy === `rm-${f.id}`} onClick={() => onRemove(f)}>Remove</button>}
          </span>
        </li>
      ))}
    </ul>
  );
}
