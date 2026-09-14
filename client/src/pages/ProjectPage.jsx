import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, PanelRightClose, PanelRightOpen, RefreshCcw } from 'lucide-react';
import { ProjectsAPI, WorkspaceAPI, apiUpload, getErrorMessage } from '../lib/api';
import { usePolling } from '../hooks/usePolling';
import { toast } from '../store/toast';
import { useProjects } from '../store/projects';
import AppShell from '../components/layout/AppShell';
import ChatPane from '../components/project/ChatPane';
import WorkspacePanel from '../components/project/WorkspacePanel';
import DatasetPreviewModal from '../components/project/DatasetPreviewModal';
import ReportModal from '../components/project/ReportModal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Alert from '../components/ui/Alert';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';

let seq = 0;
const localId = () => `local-${Date.now()}-${++seq}`;
const PANEL_KEY = 'atlas.panel.open';
const ACTIVE_DS_KEY = (p) => `atlas.activeDataset.${p}`;

export default function ProjectPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [datasets, setDatasets] = useState([]);
  const [files, setFiles] = useState([]);
  const [analyses, setAnalyses] = useState(null);
  const [reports, setReports] = useState([]);
  const [locals, setLocals] = useState([]); // optimistic questions not yet in the server list
  const [uploads, setUploads] = useState({});
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [panelOpen, setPanelOpen] = useState(() => {
    try {
      return localStorage.getItem(PANEL_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const [panelTab, setPanelTab] = useState('data');
  const [activeDatasetId, setActiveDatasetId] = useState(() => {
    try {
      return localStorage.getItem(ACTIVE_DS_KEY(projectId)) || null;
    } catch {
      return null;
    }
  });
  const [focusId, setFocusId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [reportModal, setReportModal] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const knownFailed = useRef(new Set());
  const knownCompleted = useRef(new Set());

  // ---- Loading -------------------------------------------------------------

  const refresh = useCallback(async () => {
    const [ds, fl, an, rp] = await Promise.all([
      WorkspaceAPI.datasets(projectId),
      WorkspaceAPI.files(projectId),
      WorkspaceAPI.analyses(projectId),
      WorkspaceAPI.reports(projectId),
    ]);
    setDatasets(ds);
    setFiles(fl);
    setAnalyses(an);
    setReports(rp);
    // Drop optimistic entries once the server knows about them.
    setLocals((prev) => prev.filter((l) => !l.serverId || !an.some((a) => a.id === l.serverId)));
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    setProject(null);
    setAnalyses(null);
    setLocals([]);
    setNotFound(false);
    (async () => {
      try {
        const p = await ProjectsAPI.get(projectId);
        if (!alive) return;
        setProject(p);
        useProjects.getState().upsert(p);
        await refresh();
      } catch (err) {
        if (!alive) return;
        if (err.response?.status === 404) setNotFound(true);
        else setError(getErrorMessage(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId, refresh]);

  // ---- Derived state -------------------------------------------------------

  const readyDatasets = useMemo(() => datasets.filter((d) => d.status === 'ready'), [datasets]);
  useEffect(() => {
    if (!readyDatasets.length) return;
    if (!activeDatasetId || !readyDatasets.some((d) => d.id === activeDatasetId)) {
      setActiveDatasetId(readyDatasets[0].id);
    }
  }, [readyDatasets, activeDatasetId]);

  const selectDataset = (id) => {
    setActiveDatasetId(id);
    try {
      localStorage.setItem(ACTIVE_DS_KEY(projectId), id);
    } catch {
      /* ignore */
    }
  };

  const thread = useMemo(() => {
    const server = (analyses || []).map((a) => ({ ...a }));
    const pendingLocals = locals.map((l) => ({ id: l.id, question: l.question, status: l.error ? 'failed' : 'queued', stage: 'queued', error: l.error, created_at: l.created_at, dataset_name: l.dataset_name, local: true }));
    return [...server, ...pendingLocals];
  }, [analyses, locals]);

  const inFlight = useMemo(
    () =>
      (analyses || []).some((a) => a.status === 'queued' || a.status === 'running') ||
      files.some((f) => f.status === 'processing') ||
      reports.some((r) => r.status === 'queued') ||
      locals.some((l) => l.serverId && !l.error) ||
      Object.values(uploads).some((u) => u.status === 'queued'),
    [analyses, files, reports, locals, uploads],
  );

  usePolling(refresh, {
    active: inFlight && Boolean(project),
    interval: 1500,
    maxInterval: 4000,
    onTimeout: () => toast.warning('Still working', 'This is taking longer than expected. Refresh to check again.'),
  });

  // Toast on transitions.
  useEffect(() => {
    for (const a of analyses || []) {
      if (a.status === 'failed' && !knownFailed.current.has(a.id)) {
        knownFailed.current.add(a.id);
      }
      if (a.status === 'completed') knownCompleted.current.add(a.id);
    }
  }, [analyses]);

  useEffect(() => {
    // Remove queued upload markers once their file shows up in the list.
    setUploads((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [id, u] of Object.entries(prev)) {
        if (u.status === 'queued' && files.some((f) => f.id === u.fileId)) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [files]);

  // ---- Actions -------------------------------------------------------------

  const ask = useCallback(async (question, datasetId = activeDatasetId) => {
    const id = localId();
    const ds = datasets.find((d) => d.id === datasetId);
    setLocals((prev) => [...prev, { id, question, created_at: new Date().toISOString(), dataset_name: ds?.name }]);
    try {
      const res = await WorkspaceAPI.ask(projectId, { question, datasetId: datasetId || undefined });
      setLocals((prev) => prev.map((l) => (l.id === id ? { ...l, serverId: res.analysisId } : l)));
      refresh().catch(() => {});
    } catch (err) {
      setLocals((prev) => prev.map((l) => (l.id === id ? { ...l, error: getErrorMessage(err) } : l)));
    }
  }, [projectId, activeDatasetId, datasets, refresh]);

  const upload = useCallback((fileList) => {
    const list = Array.from(fileList || []);
    if (!list.length) return;
    setPanelOpen(true);
    setPanelTab('data');
    for (const file of list) {
      const id = localId();
      setUploads((prev) => ({ ...prev, [id]: { id, name: file.name, progress: 0, status: 'uploading' } }));
      apiUpload(projectId, file, (p) => setUploads((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], progress: p } } : prev)))
        .then((res) => {
          setUploads((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], status: 'queued', progress: 100, fileId: res.data.file?.id } } : prev));
          toast.success('Upload complete', `${file.name} is being profiled.`);
          return refresh();
        })
        .catch((err) => {
          setUploads((prev) => ({ ...prev, [id]: { ...prev[id], status: 'failed', error: getErrorMessage(err) } }));
        });
    }
  }, [projectId, refresh]);

  const handlers = useMemo(() => ({
    selectDataset,
    upload,
    preview: (d) => setPreview(d),
    dismissUpload: (id) => setUploads((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    }),
    deleteFile: (d) => setConfirm({
      title: 'Remove this file?',
      message: `“${d.name}” and every analysis based on it will be removed.`,
      label: 'Remove file',
      action: async () => {
        await WorkspaceAPI.deleteFile(projectId, d.file_id);
        toast.success('File removed');
        await refresh();
      },
    }),
    focusAnalysis: (id) => {
      setFocusId(null);
      setTimeout(() => setFocusId(id), 0);
    },
    deleteAnalysis: (a) => setConfirm({
      title: 'Delete this analysis?',
      message: `“${a.question}” will be removed from the conversation and from future reports.`,
      label: 'Delete',
      action: async () => {
        await WorkspaceAPI.deleteAnalysis(projectId, a.id);
        await refresh();
      },
    }),
    generateReport: () => setReportModal(true),
    downloadReport: async (r) => {
      try {
        await WorkspaceAPI.downloadReport(projectId, r);
      } catch (err) {
        toast.error('Download failed', getErrorMessage(err));
      }
    },
    deleteReport: (r) => setConfirm({
      title: 'Delete this report?',
      message: `“${r.name}” v${r.version} will be permanently deleted.`,
      label: 'Delete report',
      action: async () => {
        await WorkspaceAPI.deleteReport(projectId, r.id);
        await refresh();
      },
    }),
  }), [projectId, refresh, upload]);

  const exportAnalysis = async (a) => {
    try {
      await WorkspaceAPI.exportCsv(projectId, a.id, a.question);
    } catch (err) {
      toast.error('Export failed', getErrorMessage(err));
    }
  };

  const retry = (a) => {
    if (a.local) setLocals((prev) => prev.filter((l) => l.id !== a.id));
    ask(a.question, a.dataset_id || activeDatasetId);
  };

  const togglePanel = () => {
    setPanelOpen((v) => {
      try {
        localStorage.setItem(PANEL_KEY, v ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !v;
    });
  };

  const busy = thread.some((t) => t.status === 'queued' || t.status === 'running');
  const processing = files.some((f) => f.status === 'processing');
  const activeDataset = readyDatasets.find((d) => d.id === activeDatasetId);

  // ---- Render --------------------------------------------------------------

  if (notFound) {
    return (
      <AppShell>
        <div className="app-content">
          <Alert kind="error" title="Project not found">This project does not exist or you no longer have access to it. <Link to="/dashboard" className="auth-card__link">Back to overview</Link></Alert>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="topbar">
        <Link to="/dashboard" className="icon-btn" aria-label="Back to projects" title="Back to projects"><ArrowLeft size={17} /></Link>
        <div className="topbar__title">
          <span className="topbar__crumb"><Link to="/dashboard">Projects</Link> / Workspace</span>
          {project ? <span className="topbar__name">{project.name}</span> : <Skeleton height={18} width={180} />}
        </div>
        {activeDataset && <Badge tone="brand" dot title="Dataset used for new questions">{activeDataset.name}</Badge>}
        {processing && <Badge tone="warning" dot pulse>Processing file</Badge>}
        <div className="topbar__actions">
          <Button variant="ghost" size="sm" icon={RefreshCcw} onClick={() => refresh().catch((e) => setError(getErrorMessage(e)))} title="Refresh">Refresh</Button>
          <button className="icon-btn" onClick={togglePanel} aria-label={panelOpen ? 'Hide panel' : 'Show panel'} title={panelOpen ? 'Hide panel' : 'Show panel'}>
            {panelOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
          </button>
        </div>
      </div>

      {error && (
        <div className="workspace-alert">
          <Alert kind="error" onDismiss={() => setError('')}>{error}</Alert>
        </div>
      )}

      <div className="workspace">
        {analyses === null && !error ? (
          <div className="chat"><div className="chat__thread" style={{ width: '100%' }}><Skeleton height={80} radius="var(--radius-xl)" /><Skeleton height={240} radius="var(--radius-xl)" /></div></div>
        ) : (
          <ChatPane
            project={project}
            datasets={datasets}
            activeDatasetId={activeDatasetId}
            onSelectDataset={selectDataset}
            thread={thread}
            busy={busy}
            processing={processing}
            onAsk={(q) => ask(q)}
            onUpload={upload}
            onDelete={handlers.deleteAnalysis}
            onExport={exportAnalysis}
            onRetry={retry}
            focusId={focusId}
          />
        )}
        <WorkspacePanel
          open={panelOpen}
          tab={panelTab}
          onTab={setPanelTab}
          datasets={datasets}
          files={files}
          uploads={uploads}
          analyses={thread}
          reports={reports}
          activeDatasetId={activeDatasetId}
          selectedAnalysisId={focusId}
          handlers={handlers}
        />
      </div>

      <DatasetPreviewModal open={Boolean(preview)} onClose={() => setPreview(null)} dataset={preview} projectId={projectId} />
      <ReportModal
        open={reportModal}
        onClose={() => setReportModal(false)}
        projectId={projectId}
        projectName={project?.name}
        analyses={analyses || []}
        onCreated={() => {
          setPanelTab('reports');
          setPanelOpen(true);
          toast.info('Report queued', 'It will appear in the Reports tab when ready.');
          refresh().catch(() => {});
        }}
      />
      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel={confirm?.label}
        onConfirm={() => confirm.action()}
      />
    </AppShell>
  );
}
