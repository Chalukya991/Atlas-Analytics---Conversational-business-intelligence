import { useRef, useState } from 'react';
import { Database, Download, Eye, FileText, History, Plus, Trash2, UploadCloud, CheckCircle2 } from 'lucide-react';
import Tabs from '../ui/Tabs';
import Badge, { statusLabel, statusTone } from '../ui/Badge';
import Button from '../ui/Button';
import Progress from '../ui/Progress';
import EmptyState from '../ui/EmptyState';
import { formatCompact, formatTime, humanBytes } from '../../lib/format';

function DataTab({ datasets, files, uploads, activeDatasetId, onSelectDataset, onUpload, onPreview, onDeleteFile, onDismissUpload }) {
  const fileRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const processingFiles = files.filter((f) => f.status === 'processing' && !datasets.some((d) => d.file_id === f.id));

  return (
    <>
      <div
        className={`dropzone ${drag ? 'is-drag' : ''}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); onUpload(Array.from(e.dataTransfer.files)); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}
      >
        <UploadCloud size={20} className="dropzone__icon" />
        <span><b>Add data</b> · drop files or click</span>
        <span>CSV, TSV, Excel · up to 100 MB</span>
        <input ref={fileRef} type="file" hidden multiple accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm,.xlsb,.ods" onChange={(e) => { onUpload(Array.from(e.target.files)); e.target.value = ''; }} />
      </div>

      {Object.values(uploads).map((u) => (
        <div className={`p-item ${u.status === 'failed' ? '' : 'is-dim'}`} key={u.id}>
          <div className="p-item__row">
            <span className="p-item__label"><UploadCloud size={14} /> <span className="truncate">{u.name}</span></span>
            <span className="p-item__actions">
              {u.status === 'failed' ? <Badge tone="danger">Failed</Badge> : <Badge tone="warning" dot pulse>{u.status === 'uploading' ? `${u.progress}%` : 'Queued'}</Badge>}
              {u.status === 'failed' && <button className="icon-btn icon-btn--sm" onClick={() => onDismissUpload(u.id)} aria-label="Dismiss"><Trash2 size={13} /></button>}
            </span>
          </div>
          {u.status === 'uploading' && <Progress value={u.progress} />}
          {u.status === 'failed' && <p className="p-item__err">{u.error}</p>}
        </div>
      ))}

      {processingFiles.map((f) => (
        <div className="p-item is-dim" key={f.id}>
          <div className="p-item__row">
            <span className="p-item__label"><Database size={14} /> <span className="truncate">{f.original_name}</span></span>
            <Badge tone="warning" dot pulse>Inspecting</Badge>
          </div>
          <Progress indeterminate />
          <p className="p-item__meta">Profiling columns and detecting types…</p>
        </div>
      ))}

      {datasets.length === 0 && !processingFiles.length && !Object.keys(uploads).length && (
        <p className="panel__hint">No data yet. Upload a spreadsheet and Atlas will profile every column so you can start asking questions.</p>
      )}

      {datasets.map((d) => {
        const ready = d.status === 'ready';
        const active = d.id === activeDatasetId;
        return (
          <div className={`p-item ${active ? 'is-selected' : ''} ${!ready ? 'is-dim' : ''}`} key={d.id}>
            <div className="p-item__row">
              <button type="button" className="p-item__label" style={{ background: 'none', border: 'none', padding: 0, cursor: ready ? 'pointer' : 'default', flex: 1, minWidth: 0 }} onClick={() => ready && onSelectDataset(d.id)} title={ready ? 'Use this dataset for questions' : d.error}>
                {active ? <CheckCircle2 size={14} style={{ color: 'var(--brand)' }} /> : <Database size={14} />}
                <span className="truncate">{d.name}</span>
              </button>
              <span className="p-item__actions">
                <Badge tone={statusTone(d.status)} dot pulse={d.status === 'processing'}>{active && ready ? 'Active' : statusLabel(d.status)}</Badge>
                {ready && <button className="icon-btn icon-btn--sm" onClick={() => onPreview(d)} title="Preview columns and rows" aria-label="Preview dataset"><Eye size={14} /></button>}
                <button className="icon-btn icon-btn--sm icon-btn--danger" onClick={() => onDeleteFile(d)} title="Remove this file" aria-label="Remove dataset"><Trash2 size={14} /></button>
              </span>
            </div>
            {ready ? (
              <p className="p-item__meta">
                <span>{formatCompact(d.metadata?.row_count)} rows</span>
                <span>{d.columns?.length || 0} columns</span>
                {d.metadata?.sheet_name && d.metadata.sheet_name !== 'default' && <span>sheet “{d.metadata.sheet_name}”</span>}
                {d.size && <span>{humanBytes(d.size)}</span>}
                {d.analysis_count > 0 && <span>{d.analysis_count} analyses</span>}
              </p>
            ) : d.error ? <p className="p-item__err">{d.error}</p> : null}
          </div>
        );
      })}
    </>
  );
}

function HistoryTab({ analyses, onFocus, onDelete, selectedId }) {
  if (!analyses.length) return <EmptyState compact icon={History} title="No questions yet" message="Everything you ask appears here so you can jump back to it." />;
  return [...analyses].reverse().map((a) => (
    <button type="button" className={`p-item ${selectedId === a.id ? 'is-selected' : ''}`} key={a.id} onClick={() => onFocus(a.id)} disabled={a.local}>
      <div className="p-item__row">
        <span className="p-item__q">{a.question}</span>
        <span className="p-item__actions">
          <Badge tone={statusTone(a.status)} dot pulse={a.status === 'running' || a.status === 'queued'}>{statusLabel(a.status)}</Badge>
          {!a.local && <span className="icon-btn icon-btn--sm icon-btn--danger" role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); onDelete(a); }} onKeyDown={(e) => e.key === 'Enter' && onDelete(a)} aria-label="Delete analysis"><Trash2 size={13} /></span>}
        </span>
      </div>
      <span className="p-item__time">{formatTime(a.created_at)}{a.dataset_name ? ` · ${a.dataset_name}` : ''}</span>
    </button>
  ));
}

function ReportsTab({ reports, analyses, onGenerate, onDownload, onDelete }) {
  const canGenerate = analyses.some((a) => a.status === 'completed');
  return (
    <>
      <Button variant="soft" icon={Plus} block onClick={onGenerate} disabled={!canGenerate}>Generate report</Button>
      {!canGenerate && <p className="panel__hint">Complete at least one analysis to build a report.</p>}
      {reports.length === 0 && canGenerate && <p className="panel__hint">Bundle your analyses into a PDF, Excel or Word document.</p>}
      {reports.map((r) => (
        <div className="p-item" key={r.id}>
          <div className="p-item__row">
            <span className="p-item__label"><FileText size={14} /> <span className="truncate">{r.name}</span></span>
            <span className="p-item__actions">
              <Badge tone={r.status === 'ready' ? 'success' : r.status === 'failed' ? 'danger' : 'warning'} dot pulse={r.status === 'queued'}>{r.status === 'ready' ? r.format.toUpperCase() : statusLabel(r.status)}</Badge>
              {r.status === 'ready' && <button className="icon-btn icon-btn--sm" onClick={() => onDownload(r)} title="Download" aria-label="Download report"><Download size={14} /></button>}
              <button className="icon-btn icon-btn--sm icon-btn--danger" onClick={() => onDelete(r)} title="Delete" aria-label="Delete report"><Trash2 size={14} /></button>
            </span>
          </div>
          <p className="p-item__meta">
            <span>v{r.version}</span>
            <span>{formatTime(r.created_at)}</span>
            {r.size && <span>{humanBytes(r.size)}</span>}
            {Array.isArray(r.analysis_ids) && <span>{r.analysis_ids.length} analyses</span>}
          </p>
          {r.status === 'failed' && r.error && <p className="p-item__err">{r.error}</p>}
        </div>
      ))}
    </>
  );
}

export default function WorkspacePanel({ open, tab, onTab, datasets, files, uploads, analyses, reports, activeDatasetId, selectedAnalysisId, handlers }) {
  return (
    <aside className={`panel ${open ? '' : 'is-hidden'}`} aria-label="Workspace panel">
      <div className="panel__tabs">
        <Tabs
          value={tab}
          onChange={onTab}
          tabs={[
            { id: 'data', label: 'Data', icon: Database, count: datasets.filter((d) => d.status === 'ready').length },
            { id: 'history', label: 'History', icon: History, count: analyses.length },
            { id: 'reports', label: 'Reports', icon: FileText, count: reports.length },
          ]}
        />
      </div>
      <div className="panel__body">
        {tab === 'data' && (
          <DataTab datasets={datasets} files={files} uploads={uploads} activeDatasetId={activeDatasetId} onSelectDataset={handlers.selectDataset} onUpload={handlers.upload} onPreview={handlers.preview} onDeleteFile={handlers.deleteFile} onDismissUpload={handlers.dismissUpload} />
        )}
        {tab === 'history' && <HistoryTab analyses={analyses} onFocus={handlers.focusAnalysis} onDelete={handlers.deleteAnalysis} selectedId={selectedAnalysisId} />}
        {tab === 'reports' && <ReportsTab reports={reports} analyses={analyses} onGenerate={handlers.generateReport} onDownload={handlers.downloadReport} onDelete={handlers.deleteReport} />}
      </div>
    </aside>
  );
}
