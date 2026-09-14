import { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, FileText, FileType2 } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import { Field, Input, Checkbox } from '../ui/Field';
import { WorkspaceAPI, getErrorMessage } from '../../lib/api';
import { formatTime } from '../../lib/format';

const FORMATS = [
  { id: 'pdf', label: 'PDF', desc: 'Polished document with charts and tables', Icon: FileText },
  { id: 'xlsx', label: 'Excel', desc: 'One sheet per analysis, numbers as numbers', Icon: FileSpreadsheet },
  { id: 'docx', label: 'Word', desc: 'Editable narrative with tables', Icon: FileType2 },
];

export default function ReportModal({ open, onClose, projectId, projectName, analyses, onCreated }) {
  const completed = useMemo(() => analyses.filter((a) => a.status === 'completed'), [analyses]);
  const [name, setName] = useState('');
  const [format, setFormat] = useState('pdf');
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setName(`${projectName || 'Analysis'} report`);
      setFormat('pdf');
      setSelected(new Set(completed.map((a) => a.id)));
      setError('');
    }
  }, [open, projectName, completed]);

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const submit = async () => {
    if (!selected.size) {
      setError('Select at least one analysis to include.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await WorkspaceAPI.createReport(projectId, { name: name.trim(), format, analysisIds: Array.from(selected) });
      onCreated(res);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Generate a report"
      description="Bundle completed analyses into a shareable document. Numbers come straight from the computed results."
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={submit} loading={loading} disabled={!completed.length}>Generate {FORMATS.find((f) => f.id === format)?.label}</Button>
        </>
      }
    >
      <div className="stack">
        {error && <Alert kind="error">{error}</Alert>}
        <Field label="Report name">
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />}
        </Field>
        <Field label="Format">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {FORMATS.map((f) => (
              <button
                type="button"
                key={f.id}
                onClick={() => setFormat(f.id)}
                className="p-item"
                style={{ alignItems: 'flex-start', borderColor: format === f.id ? 'var(--brand)' : undefined, boxShadow: format === f.id ? 'var(--shadow-focus)' : undefined, background: 'var(--bg-surface)' }}
                aria-pressed={format === f.id}
              >
                <f.Icon size={18} style={{ color: format === f.id ? 'var(--brand-text)' : 'var(--text-3)' }} />
                <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{f.label}</span>
                <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-3)', lineHeight: 1.4 }}>{f.desc}</span>
              </button>
            ))}
          </div>
        </Field>
        <Field label={`Include analyses (${selected.size} of ${completed.length})`}>
          {completed.length === 0 ? (
            <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>Run at least one analysis before generating a report.</p>
          ) : (
            <div className="stack" style={{ gap: 6, maxHeight: 240, overflowY: 'auto', padding: '4px 2px' }}>
              <div className="row" style={{ justifyContent: 'flex-end', gap: 12 }}>
                <button type="button" className="p-link" style={{ fontSize: 'var(--text-2xs)' }} onClick={() => setSelected(new Set(completed.map((a) => a.id)))}>Select all</button>
                <button type="button" className="p-link" style={{ fontSize: 'var(--text-2xs)' }} onClick={() => setSelected(new Set())}>Clear</button>
              </div>
              {completed.map((a) => (
                <Checkbox
                  key={a.id}
                  checked={selected.has(a.id)}
                  onChange={() => toggle(a.id)}
                  label={<span className="truncate" style={{ display: 'inline-block', maxWidth: 420 }} title={a.question}>{a.question} <span className="muted" style={{ fontSize: 'var(--text-2xs)' }}>· {formatTime(a.created_at)}</span></span>}
                />
              ))}
            </div>
          )}
        </Field>
      </div>
    </Modal>
  );
}
