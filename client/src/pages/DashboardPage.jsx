import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, BarChart3, FileSpreadsheet, FileText, FolderKanban, MessageSquareText, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { ProjectsAPI, getErrorMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import { useProjects } from '../store/projects';
import { toast } from '../store/toast';
import AppShell from '../components/layout/AppShell';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Alert from '../components/ui/Alert';
import EmptyState from '../components/ui/EmptyState';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Menu, { MenuItem, MenuSeparator } from '../components/ui/Menu';
import { Input, Textarea, Field, IconInput } from '../components/ui/Field';
import { Skeleton } from '../components/ui/Skeleton';
import { timeAgo, formatNumber } from '../lib/format';

function ProjectModal({ open, onClose, onSaved, project }) {
  const editing = Boolean(project);
  const [name, setName] = useState(project?.name || '');
  const [description, setDescription] = useState(project?.description || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setName(project?.name || '');
      setDescription(project?.description || '');
      setError('');
    }
  }, [open, project]);

  const submit = async (e) => {
    e?.preventDefault?.();
    setError('');
    if (!name.trim()) {
      setError('Give your project a name.');
      return;
    }
    setLoading(true);
    try {
      const data = editing
        ? await ProjectsAPI.update(project.id, { name: name.trim(), description: description.trim() })
        : await ProjectsAPI.create({ name: name.trim(), description: description.trim() });
      onSaved(data, editing);
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
      title={editing ? 'Rename project' : 'Create a project'}
      description={editing ? undefined : 'A project holds your files, the questions you ask and the reports you generate.'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={submit} loading={loading}>{editing ? 'Save changes' : 'Create project'}</Button>
        </>
      }
    >
      <form onSubmit={submit} className="stack">
        {error && <Alert kind="error">{error}</Alert>}
        <Field label="Project name" required>
          {(id) => <Input id={id} placeholder="e.g. Q3 sales review" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={120} />}
        </Field>
        <Field label="Description" hint="Optional. What business question should this project answer?">
          {(id) => <Textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Regional sales performance for the leadership review" maxLength={2000} />}
        </Field>
      </form>
    </Modal>
  );
}

function StatTile({ icon: Icon, tone, value, label }) {
  return (
    <div className="stat-tile">
      <span className={`stat-tile__icon ${tone ? `stat-tile__icon--${tone}` : ''}`}><Icon size={19} /></span>
      <div>
        <p className="stat-tile__value">{value}</p>
        <p className="stat-tile__label">{label}</p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { projects, load, upsert, remove } = useProjects();
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState({ open: false, project: null });
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    load(true).catch((err) => setError(getErrorMessage(err)));
  }, [load]);

  const stats = useMemo(() => {
    if (!projects) return null;
    return projects.reduce(
      (acc, p) => ({
        projects: acc.projects + 1,
        datasets: acc.datasets + (p.dataset_count || 0),
        analyses: acc.analyses + (p.analysis_count || 0),
        reports: acc.reports + (p.report_count || 0),
      }),
      { projects: 0, datasets: 0, analyses: 0, reports: 0 },
    );
  }, [projects]);

  const filtered = useMemo(() => {
    if (!projects) return [];
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
  }, [projects, query]);

  const firstName = (user?.name || 'there').split(' ')[0];

  const deleteProject = async (p) => {
    await ProjectsAPI.remove(p.id);
    remove(p.id);
    toast.success('Project deleted', `“${p.name}” and its files were removed.`);
  };

  return (
    <AppShell>
      <div className="topbar">
        <div className="topbar__title">
          <span className="topbar__crumb">Overview</span>
          <span className="topbar__name">Projects</span>
        </div>
        <div className="topbar__actions">
          <Button icon={Plus} onClick={() => setModal({ open: true, project: null })}>New project</Button>
        </div>
      </div>

      <div className="app-content">
        <div className="app-content--narrow">
          <div className="page-header">
            <div>
              <p className="page-header__eyebrow">Welcome back</p>
              <h1 className="page-header__title">Hi {firstName}, what do you want to know today?</h1>
              <p className="page-header__subtitle">Open a project, drop in a spreadsheet and ask questions in plain English. Every number is computed, never guessed.</p>
            </div>
          </div>

          {error && <Alert kind="error" title="Could not load projects" onDismiss={() => setError('')}>{error}</Alert>}

          {!projects ? (
            <div className="stack" style={{ gap: 16 }}>
              <div className="stat-row">{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={88} radius="var(--radius-lg)" />)}</div>
              <div className="project-grid">{[0, 1, 2].map((i) => <Skeleton key={i} height={210} radius="var(--radius-xl)" />)}</div>
            </div>
          ) : (
            <>
              <div className="stat-row">
                <StatTile icon={FolderKanban} value={formatNumber(stats.projects)} label="Projects" />
                <StatTile icon={FileSpreadsheet} tone="accent" value={formatNumber(stats.datasets)} label="Datasets ready" />
                <StatTile icon={MessageSquareText} tone="success" value={formatNumber(stats.analyses)} label="Questions answered" />
                <StatTile icon={FileText} tone="warning" value={formatNumber(stats.reports)} label="Reports generated" />
              </div>

              <div className="section-head">
                <h2 className="section-head__title">Your projects</h2>
                <div className="section-head__side">
                  <div className="section-head__search">
                    <IconInput icon={Search} size="sm" placeholder="Search projects…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search projects" />
                  </div>
                  <span>{filtered.length} of {projects.length}</span>
                </div>
              </div>

              {projects.length === 0 ? (
                <EmptyState
                  icon={BarChart3}
                  title="Bring your first dataset to life"
                  message="Create a project, upload an Excel or CSV file, and start asking questions in plain English."
                  action={<Button icon={Plus} onClick={() => setModal({ open: true, project: null })}>Create your first project</Button>}
                />
              ) : (
                <div className="project-grid">
                  {filtered.map((p, i) => (
                    <Link to={`/projects/${p.id}`} className="project-card" key={p.id} style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
                      <div className="project-card__top">
                        <span className="project-card__icon"><FolderKanban size={18} /></span>
                        <div className="project-card__menu">
                          <Menu
                            trigger={({ toggle }) => (
                              <button className="icon-btn" onClick={toggle} aria-label="Project actions"><MoreHorizontal size={16} /></button>
                            )}
                          >
                            <MenuItem icon={Pencil} onClick={(e) => { e.preventDefault(); setModal({ open: true, project: p }); }}>Rename</MenuItem>
                            <MenuSeparator />
                            <MenuItem icon={Trash2} danger onClick={(e) => { e.preventDefault(); setConfirm(p); }}>Delete project</MenuItem>
                          </Menu>
                        </div>
                      </div>
                      <h3 className="project-card__name">{p.name}</h3>
                      <p className="project-card__desc">{p.description || 'No description yet.'}</p>
                      <div className="project-card__stats">
                        <span className="project-card__stat" title="Datasets"><FileSpreadsheet size={13} /><b>{p.dataset_count || 0}</b></span>
                        <span className="project-card__stat" title="Analyses"><MessageSquareText size={13} /><b>{p.analysis_count || 0}</b></span>
                        <span className="project-card__stat" title="Reports"><FileText size={13} /><b>{p.report_count || 0}</b></span>
                      </div>
                      <div className="project-card__foot">
                        <span className="project-card__time">Updated {timeAgo(p.last_activity_at || p.updated_at)}</span>
                        <span className="project-card__open">Open <ArrowUpRight size={14} /></span>
                      </div>
                    </Link>
                  ))}
                  <button type="button" className="project-card project-card--new" onClick={() => setModal({ open: true, project: null })}>
                    <span className="project-card__icon"><Plus size={18} /></span>
                    <h3 className="project-card__name">New project</h3>
                    <p className="project-card__desc" style={{ minHeight: 0 }}>Upload a file, ask a question, get an answer.</p>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <ProjectModal
        open={modal.open}
        project={modal.project}
        onClose={() => setModal({ open: false, project: null })}
        onSaved={(p, editing) => {
          upsert({ ...p, dataset_count: modal.project?.dataset_count || 0, analysis_count: modal.project?.analysis_count || 0, report_count: modal.project?.report_count || 0 });
          if (!editing) navigate(`/projects/${p.id}`);
          else toast.success('Project renamed');
        }}
      />
      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title="Delete this project?"
        message={`“${confirm?.name}” will be permanently deleted along with its uploaded files, analyses and reports. This cannot be undone.`}
        confirmLabel="Delete project"
        onConfirm={() => deleteProject(confirm)}
      />
    </AppShell>
  );
}
