import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Database, FileUp, Paperclip, RefreshCcw, Sparkles, TriangleAlert, Trash2 } from 'lucide-react';
import AnalysisResultCard from './ResultCard';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import { Select } from '../ui/Field';
import { buildSuggestions, GENERIC_SUGGESTIONS } from '../../lib/suggestions';
import { formatTime, formatNumber } from '../../lib/format';

const STAGES = [
  { id: 'planning', label: 'Understanding' },
  { id: 'computing', label: 'Computing' },
  { id: 'explaining', label: 'Explaining' },
];

export function Thinking({ stage }) {
  const idx = Math.max(0, STAGES.findIndex((s) => s.id === stage));
  const hints = { planning: 'Mapping your question to the columns in this dataset…', computing: 'Running the calculation on every row…', explaining: 'Writing the summary and checking every number…' };
  return (
    <div className="msg msg--assistant">
      <div className="thinking" role="status" aria-live="polite">
        <div className="stages">
          {STAGES.map((s, i) => (
            <div key={s.id} style={{ display: 'contents' }}>
              <span className={`stage ${i < idx ? 'is-done' : i === idx ? 'is-active' : ''}`}><i className="stage__dot" />{s.label}</span>
              {i < STAGES.length - 1 && <i className="stage__sep" />}
            </div>
          ))}
        </div>
        <p className="thinking__hint">{hints[stage] || 'Queued — starting shortly…'}</p>
      </div>
    </div>
  );
}

export function Failed({ error, onRetry, onDelete }) {
  return (
    <div className="msg msg--assistant">
      <div className="failed" role="alert">
        <p className="failed__title"><TriangleAlert size={15} /> I couldn’t answer that</p>
        <p className="failed__msg">{error || 'The analysis could not be completed. Try rephrasing the question or naming the column you mean.'}</p>
        <div className="failed__actions">
          {onRetry && <Button size="sm" variant="secondary" icon={RefreshCcw} onClick={onRetry}>Try again</Button>}
          {onDelete && <Button size="sm" variant="ghost" icon={Trash2} onClick={onDelete}>Remove</Button>}
        </div>
      </div>
    </div>
  );
}

function UserBubble({ question, time, datasetName }) {
  return (
    <div className="msg msg--user">
      <div>
        <div className="msg__bubble"><p>{question}</p></div>
        <div className="msg__meta">
          {datasetName && <span className="truncate" style={{ maxWidth: 200 }}>{datasetName}</span>}
          {time && <span>{formatTime(time)}</span>}
        </div>
      </div>
    </div>
  );
}

function ThreadItem({ item, onAsk, onDelete, onExport, onRetry }) {
  const a = item;
  const pending = a.status === 'queued' || a.status === 'running' || a.status === 'pending';
  return (
    <div className="stack" style={{ gap: 10 }} id={`thread-${a.id}`}>
      <UserBubble question={a.question} time={a.created_at} datasetName={a.dataset_name} />
      {a.status === 'completed' && (
        <div className="msg msg--assistant msg--result">
          <div className="msg__bubble"><AnalysisResultCard analysis={a} onAsk={onAsk} onDelete={onDelete} onExport={onExport} /></div>
        </div>
      )}
      {a.status === 'failed' && <Failed error={a.error || a.explanation?.error} onRetry={() => onRetry(a)} onDelete={a.local ? undefined : () => onDelete(a)} />}
      {pending && <Thinking stage={a.stage} />}
    </div>
  );
}

function Composer({ datasets, activeDatasetId, onSelectDataset, disabled, busy, onAsk, onUpload, processing }) {
  const [text, setText] = useState('');
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const active = datasets.find((d) => d.id === activeDatasetId);
  const suggestions = useMemo(() => (active ? buildSuggestions(active, 4) : GENERIC_SUGGESTIONS.slice(0, 3)), [active]);

  const submit = () => {
    const q = text.trim();
    if (!q || disabled) return;
    onAsk(q);
    setText('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
  };

  const handleFiles = (files) => {
    if (!files || !files.length) return;
    onUpload(Array.from(files));
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="composer-wrap">
      <div
        className={`composer ${drag ? 'is-drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
      >
        <div className="composer__main">
          <button type="button" className="icon-btn" onClick={() => fileRef.current?.click()} title="Upload a CSV or Excel file" aria-label="Upload a file"><Paperclip size={17} /></button>
          <input ref={fileRef} type="file" hidden multiple accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm,.xlsb,.ods" onChange={(e) => handleFiles(e.target.files)} />
          <textarea
            ref={inputRef}
            className="composer__input"
            rows={1}
            placeholder={disabled ? (processing ? 'Your file is being processed…' : 'Upload a spreadsheet to start asking questions') : 'Ask a question about your data…'}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            disabled={disabled}
            maxLength={1000}
            aria-label="Question"
          />
          <Button icon={ArrowUp} size="md" disabled={!text.trim() || disabled} onClick={submit} aria-label="Send" className="composer__send" loading={false} />
        </div>
        <div className="composer__bar">
          <div className="composer__ds">
            {datasets.length > 1 ? (
              <>
                <span className="composer__ds-label"><Database size={12} /> Ask about</span>
                <Select size="sm" value={activeDatasetId || ''} onChange={(e) => onSelectDataset(e.target.value)} aria-label="Dataset">
                  {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              </>
            ) : active ? (
              <span className="composer__ds-label"><Database size={12} /> <span className="truncate" style={{ maxWidth: 260 }}>{active.name}</span> · {formatNumber(active.metadata?.row_count)} rows</span>
            ) : (
              <span className="composer__ds-label"><FileUp size={12} /> Drop a file here or click the clip</span>
            )}
          </div>
          <span className="composer__hint">{busy ? <Badge tone="warning" dot pulse>Working…</Badge> : <><kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line</>}</span>
        </div>
      </div>
      {!disabled && (
        <div className="suggest-row">
          <Sparkles size={13} className="suggest-row__spark" />
          {suggestions.map((s) => <button type="button" key={s} className="chip" onClick={() => onAsk(s)}>{s}</button>)}
        </div>
      )}
    </div>
  );
}

export default function ChatPane({ project, datasets, activeDatasetId, onSelectDataset, thread, busy, processing, onAsk, onUpload, onDelete, onExport, onRetry, focusId }) {
  const scrollRef = useRef(null);
  const endRef = useRef(null);
  const [atBottom, setAtBottom] = useState(true);
  const lastCount = useRef(thread.length);
  const readyDatasets = datasets.filter((d) => d.status === 'ready');
  const active = readyDatasets.find((d) => d.id === activeDatasetId);
  const starters = useMemo(() => (active ? buildSuggestions(active, 5) : []), [active]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onScroll = () => setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Auto-scroll only when a new item arrives and the user is already near the bottom.
  useEffect(() => {
    if (thread.length > lastCount.current && atBottom) {
      endRef.current?.scrollIntoView({ block: 'end' });
    }
    lastCount.current = thread.length;
  }, [thread.length, atBottom]);

  useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(`thread-${focusId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.animate?.([{ backgroundColor: 'var(--brand-soft)' }, { backgroundColor: 'transparent' }], { duration: 1400 });
    }
  }, [focusId]);

  return (
    <div className="chat">
      <div className="chat__scroll" ref={scrollRef}>
        <div className="chat__thread">
          {thread.length === 0 && (
            <div className="chat__welcome">
              <div className="chat__welcome-mark"><Sparkles size={26} /></div>
              <h2 className="chat__welcome-title">{project?.name || 'Your workspace'}</h2>
              <p className="chat__welcome-text">
                {readyDatasets.length
                  ? 'Your data is ready. Ask a question in plain English and Atlas will compute the answer, chart it and explain what it means.'
                  : 'Upload a spreadsheet to begin. Atlas profiles every column, computes answers deterministically and explains them clearly.'}
              </p>
              {!readyDatasets.length && (
                <div className="chat__steps">
                  <div className="chat__step"><span className="chat__step-n">1</span><b>Upload a file</b><p>CSV, TSV or Excel. Multi-sheet workbooks become one dataset per sheet.</p></div>
                  <div className="chat__step"><span className="chat__step-n">2</span><b>Ask a question</b><p>“Total revenue by region”, “top 5 customers”, “monthly trend”, “North vs South”.</p></div>
                  <div className="chat__step"><span className="chat__step-n">3</span><b>Share the answer</b><p>Export results as CSV or bundle analyses into a PDF, Excel or Word report.</p></div>
                </div>
              )}
              {starters.length > 0 && (
                <div className="chat__starters">
                  <span className="chat__starters-title">Try asking</span>
                  <div className="chip-row">{starters.map((s) => <button type="button" key={s} className="chip" onClick={() => onAsk(s)}>{s}</button>)}</div>
                </div>
              )}
            </div>
          )}
          {thread.map((item) => (
            <ThreadItem key={item.id} item={item} onAsk={onAsk} onDelete={onDelete} onExport={onExport} onRetry={onRetry} />
          ))}
          <div ref={endRef} />
        </div>
      </div>
      {!atBottom && thread.length > 0 && (
        <div className="chat__jump">
          <Button size="sm" variant="secondary" icon={ArrowDown} onClick={() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })}>Latest</Button>
        </div>
      )}
      <Composer
        datasets={readyDatasets}
        activeDatasetId={activeDatasetId}
        onSelectDataset={onSelectDataset}
        disabled={!readyDatasets.length}
        busy={busy}
        processing={processing}
        onAsk={onAsk}
        onUpload={onUpload}
      />
    </div>
  );
}
