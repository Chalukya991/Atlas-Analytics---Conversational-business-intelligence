import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, FolderKanban, LayoutDashboard, LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { useTheme } from '../../store/theme';
import { useProjects } from '../../store/projects';
import { BrandMark } from './Brand';
import { initials } from '../../lib/format';

const COLLAPSE_KEY = 'atlas.sidebar.collapsed';

export default function Sidebar() {
  const { user, logout } = useAuth();
  const { preference, setPreference } = useTheme();
  const { projects, load } = useProjects();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, v ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !v;
    });
  };

  const handleSignOut = async () => {
    await logout();
    useProjects.getState().reset();
    navigate('/login', { replace: true });
  };

  const recent = (projects || []).slice(0, 6);

  return (
    <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''}`}>
      <button className="sidebar__collapse" onClick={toggleCollapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand' : 'Collapse'}>
        {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
      <div className="sidebar__brand">
        <BrandMark compact={collapsed} />
      </div>

      <nav className="sidebar__nav" aria-label="Primary">
        <NavLink to="/dashboard" end className={({ isActive }) => `sidebar__link ${isActive ? 'is-active' : ''}`} title="Overview">
          <LayoutDashboard size={17} strokeWidth={1.9} />
          <span>Overview</span>
        </NavLink>
      </nav>

      {recent.length > 0 && (
        <div className="sidebar__nav" aria-label="Recent projects">
          <span className="sidebar__section-label">Recent projects</span>
          {recent.map((p) => (
            <NavLink key={p.id} to={`/projects/${p.id}`} className={({ isActive }) => `sidebar__link sidebar__link--sub ${isActive ? 'is-active' : ''}`} title={p.name}>
              {collapsed ? <FolderKanban size={15} strokeWidth={1.9} /> : <i className="sidebar__dot" />}
              <span className="truncate">{p.name}</span>
            </NavLink>
          ))}
        </div>
      )}

      <div className="sidebar__spacer" />

      <div className="sidebar__footer">
        <div className="sidebar__theme" role="radiogroup" aria-label="Theme">
          {[
            { id: 'light', Icon: Sun, label: 'Light' },
            { id: 'system', Icon: Monitor, label: 'Auto' },
            { id: 'dark', Icon: Moon, label: 'Dark' },
          ].map(({ id, Icon, label }) => (
            <button key={id} type="button" role="radio" aria-checked={preference === id} className={preference === id ? 'is-active' : ''} onClick={() => setPreference(id)} title={label}>
              <Icon size={13} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="sidebar__user">
          <div className="sidebar__avatar" aria-hidden="true">{initials(user?.name)}</div>
          <div className="sidebar__user-info">
            <p className="sidebar__user-name">{user?.name || 'Guest'}</p>
            <p className="sidebar__user-email">{user?.email || ''}</p>
          </div>
          <button className="icon-btn icon-btn--on-dark" onClick={handleSignOut} title="Sign out" aria-label="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
