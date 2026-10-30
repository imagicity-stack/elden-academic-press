import { useState } from 'react';
import { LV, LVS, type LevelKey } from '../../data';
import { adminApi, uploadFile, useAdmin } from '../api';
import { Badge, Btn, Card, Check, Empty, ErrorBox, Loading, Modal, Page, SelectField, TextField, useAction } from '../ui';

interface Resource { id: string; title: string; kind: string; level: LevelKey; subject: string; filePath: string | null; fileSize: number | null; published: boolean; sort: number; url: string | null }
const KINDS = ['Sample papers', 'Revision notes', 'Answer keys', 'Worksheets', 'Syllabus', 'Errata'];

export default function StudyHubAdmin() {
  const { data, error, reload } = useAdmin<{ items: Resource[] }>('/resources');
  const [editing, setEditing] = useState<Resource | 'new' | null>(null);
  return (
    <Page title="Study Hub" subtitle="Free PDFs anyone can download from the Study Hub page." actions={<Btn kind="primary" onClick={() => setEditing('new')}>Add file</Btn>}>
      <Card flush>
        {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : data.items.length === 0 ? <Empty title="No files yet." /> : (
          <div className="ad-table-wrap">
            <table className="ad-table ad-table--click">
              <thead><tr><th>Title</th><th>Type</th><th>Level</th><th>File</th><th>Status</th></tr></thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id} onClick={() => setEditing(r)}>
                    <td className="ad-strong">{r.title}<div className="ad-muted">{r.subject}</div></td>
                    <td>{r.kind}</td>
                    <td className="ad-muted">{LVS[r.level]}</td>
                    <td>{r.url ? <a href={r.url} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>PDF {r.fileSize ? `${(r.fileSize / 1048576).toFixed(1)} MB` : ''}</a> : <Badge tone="red">Missing</Badge>}</td>
                    <td>{r.published ? <Badge tone="green">Published</Badge> : <Badge tone="amber">Hidden</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <ResourceDialog r={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </Page>
  );
}

function ResourceDialog({ r, onClose, onSaved }: { r: Resource | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ title: r?.title ?? '', kind: r?.kind ?? KINDS[0], level: r?.level ?? ('S' as LevelKey), subject: r?.subject ?? '', filePath: r?.filePath ?? null, fileSize: r?.fileSize ?? null, fileName: r?.filePath?.split('/').pop() ?? '', published: r?.published ?? true, sort: String(r?.sort ?? 0) });
  const { busy, run } = useAction();
  const save = () => run('save', () => adminApi(r ? `/resources/${r.id}` : '/resources', {
    method: r ? 'PUT' : 'POST',
    body: { title: f.title, kind: f.kind, level: f.level, subject: f.subject, filePath: f.filePath, fileSize: f.fileSize, published: f.published, sort: Number(f.sort) || 0 },
  }), 'Saved').then((x) => x && onSaved());
  return (
    <Modal title={r ? 'Edit file' : 'Add a Study Hub file'} onClose={onClose} footer={<>
      {r && <Btn kind="danger" busy={busy === 'del'} onClick={() => confirm('Delete this file from the Study Hub?') && run('del', () => adminApi(`/resources/${r.id}`, { method: 'DELETE' }), 'Deleted').then((x) => x && onSaved())}>Delete</Btn>}
      <span className="ad-grow" /><Btn onClick={onClose}>Cancel</Btn>
      <Btn kind="primary" busy={busy === 'save'} disabled={!f.title.trim() || (f.published && !f.filePath)} onClick={save}>Save</Btn>
    </>}>
      <div className="ad-form">
        <TextField label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Class 10 Science — Sample Paper Set 2" />
        <div className="ad-form-grid">
          <SelectField label="Type" value={KINDS.includes(f.kind) ? f.kind : '__other'} onChange={(e) => setF({ ...f, kind: e.target.value === '__other' ? '' : e.target.value })}>
            {KINDS.map((k) => <option key={k}>{k}</option>)}<option value="__other">Other…</option>
          </SelectField>
          {!KINDS.includes(f.kind) && <TextField label="Type name" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} />}
          <SelectField label="Level" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value as LevelKey })}>{(Object.keys(LV) as LevelKey[]).map((l) => <option key={l} value={l}>{LV[l]}</option>)}</SelectField>
          <TextField label="Subject" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
          <TextField label="Sort order" type="number" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })} />
        </div>
        <div className="ad-upload">
          <div><b>{f.fileName || 'No file yet'}</b><span className="ad-muted">PDF, up to 50 MB. Public — anyone with the link can download.</span></div>
          <label className="ad-btn ad-btn--secondary ad-btn--sm">
            {busy === 'up' ? 'Uploading…' : f.filePath ? 'Replace' : 'Upload PDF'}
            <input type="file" hidden accept="application/pdf,.pdf" onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const u = await run('up', () => uploadFile('resources', file));
              if (u) setF((x) => ({ ...x, filePath: u.path, fileSize: u.size, fileName: u.name, title: x.title || file.name.replace(/\.pdf$/i, '') }));
            }} />
          </label>
        </div>
        <Check label="Published on the Study Hub" checked={f.published} onChange={(v) => setF({ ...f, published: v })} />
      </div>
    </Modal>
  );
}
