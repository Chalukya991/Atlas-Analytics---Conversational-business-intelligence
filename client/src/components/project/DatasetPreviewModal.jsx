import { useEffect, useState } from 'react';
import { WorkspaceAPI, getErrorMessage } from '../../lib/api';
import Modal from '../ui/Modal';
import Badge from '../ui/Badge';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Tabs from '../ui/Tabs';
import DataTable from './DataTable';
import { Columns3, Table2 } from 'lucide-react';
import { formatNumber, humanBytes, humanize } from '../../lib/format';

export default function DatasetPreviewModal({ open, onClose, dataset, projectId }) {
  const [tab, setTab] = useState('schema');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !dataset) return;
    setTab('schema');
    setRows(dataset.metadata?.preview || []);
    setTotal(dataset.metadata?.row_count || 0);
    setError('');
  }, [open, dataset]);

  const loadMore = async () => {
    setLoading(true);
    setError('');
    try {
      const page = await WorkspaceAPI.preview(projectId, dataset.id, { offset: rows.length, limit: 100 });
      setRows((prev) => [...prev, ...page.rows]);
      setTotal(page.total_rows);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (!dataset) return null;
  const cols = dataset.columns || [];
  const meta = dataset.metadata || {};

  return (
    <Modal open={open} onClose={onClose} title={dataset.name} description={dataset.original_name && dataset.original_name !== dataset.name ? `From ${dataset.original_name}` : undefined} width={900}>
      <div className="preview-meta">
        <Badge tone="brand">{formatNumber(meta.row_count)} rows</Badge>
        <Badge tone="brand">{cols.length} columns</Badge>
        {meta.sheet_name && meta.sheet_name !== 'default' && <Badge tone="outline">Sheet: {meta.sheet_name}</Badge>}
        {dataset.size && <Badge tone="outline">{humanBytes(dataset.size)}</Badge>}
        {meta.truncated && <Badge tone="warning">Truncated to the row limit</Badge>}
        {(meta.issues || []).map((i) => <Badge key={i} tone="warning">{humanize(i)}</Badge>)}
      </div>
      <div style={{ marginBottom: 12, maxWidth: 260 }}>
        <Tabs tabs={[{ id: 'schema', label: 'Columns', icon: Columns3, count: cols.length }, { id: 'rows', label: 'Rows', icon: Table2 }]} value={tab} onChange={setTab} />
      </div>
      {tab === 'schema' ? (
        <div className="schema-list">
          <div className="schema-row" style={{ background: 'transparent', color: 'var(--text-3)', fontSize: 'var(--text-2xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
            <span>Column</span><span>Type</span><span>Sample values</span><span style={{ textAlign: 'right' }}>Filled</span>
          </div>
          {cols.map((c) => (
            <div className="schema-row" key={c.name}>
              <span className="schema-row__name" title={c.name}>{c.name}{c.currency ? <span className="muted"> · {c.currency}</span> : ''}</span>
              <span><span className={`type-pill type-pill--${c.data_type || 'unknown'}`}>{c.data_type}</span></span>
              <span className="schema-row__samples" title={(c.sample_values || []).join(', ')}>{(c.sample_values || []).slice(0, 4).map(String).join(', ')}</span>
              <span className="tabular" style={{ textAlign: 'right', color: 'var(--text-2)' }}>{Math.round((c.fill_rate || 0) * 100)}%</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {error && <Alert kind="error">{error}</Alert>}
          <DataTable rows={rows} columns={cols.map((c) => c.name)} pageSize={20} compact emptyText="No preview rows available" />
          {rows.length < total && (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <Button variant="secondary" size="sm" loading={loading} onClick={loadMore}>Load 100 more rows ({formatNumber(rows.length)} of {formatNumber(total)})</Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
