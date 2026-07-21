import React from 'react';
import styles from './Sidebar.module.scss';
import { useCalendar } from '../context/CalendarContext';

interface NavItemDef {
  id: string;
  label: string;
  icon: React.ReactNode;
  section: 'Agenda' | 'Clientes' | 'Negocio' | 'Sistema' | 'SaaS Admin';
}

const ALL_NAV_ITEMS: NavItemDef[] = [
  { 
    id: 'calendario', 
    label: 'Calendario', 
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ), 
    section: 'Agenda' 
  },
  { 
    id: 'horarios', 
    label: 'Horarios', 
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15 15" />
      </svg>
    ), 
    section: 'Agenda' 
  },
  { 
    id: 'clientes', 
    label: 'Clientes', 
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
      </svg>
    ), 
    section: 'Clientes' 
  },
  { 
    id: 'seguimiento', 
    label: 'Seguimiento', 
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ), 
    section: 'Clientes' 
  },
  { 
    id: 'servicios', 
    label: 'Servicios', 
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ), 
    section: 'Negocio' 
  },
  { 
    id: 'reglas', 
    label: 'Reglas de negocio', 
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ), 
    section: 'Negocio' 
  },
  { 
    id: 'equipo', 
    label: 'Equipo', 
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ), 
    section: 'Negocio' 
  },
  { 
    id: 'reportes', 
    label: 'Reportes', 
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ), 
    section: 'Sistema' 
  }
];

const SECTIONS = ['Agenda', 'Clientes', 'Negocio', 'Sistema'] as const;

export const Sidebar: React.FC = () => {
  const { viewType, setViewType, businessConfig, currentUser, logoutUser, switchWorkspace } = useCalendar();
  const [showWorkspaceDropdown, setShowWorkspaceDropdown] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowWorkspaceDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNavClick = (id: string) => {
    if (id === 'calendario') {
      setViewType('semana'); // Default to week view when clicking calendar
    } else if (id === 'horarios') {
      setViewType('horarios');
    } else if (id === 'saas-negocios' || id === 'saas-metricas') {
      const params = new URLSearchParams(window.location.search);
      params.delete('slug');
      params.set('view', id);
      window.location.href = `/admin?${params.toString()}`;
    }
  };

  const fn = currentUser?.firstName || "";
  const ln = currentUser?.lastName || "";
  const initials = `${fn[0] || ""}${ln[0] || ""}`.toUpperCase() || "US";

  // Determine active item id
  const activeItemId = viewType === 'horarios' 
    ? 'horarios' 
    : viewType === 'saas-negocios' 
      ? 'saas-negocios' 
      : viewType === 'saas-metricas' 
        ? 'saas-metricas' 
        : 'calendario';

  const sections = [...SECTIONS];
  const navItems = [...ALL_NAV_ITEMS];

  if (currentUser?.role === 'superadmin') {
    navItems.push(
      { 
        id: 'saas-negocios', 
        label: 'Negocios SaaS', 
        icon: (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="7" width="20" height="14" rx="2" />
            <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
            <line x1="12" y1="12" x2="12" y2="16" />
            <line x1="10" y1="14" x2="14" y2="14" />
          </svg>
        ), 
        section: 'SaaS Admin' 
      },
      { 
        id: 'saas-metricas', 
        label: 'Métricas SaaS', 
        icon: (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
        ), 
        section: 'SaaS Admin' 
      }
    );
    // @ts-ignore
    sections.push('SaaS Admin');
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo} ref={dropdownRef}>
        <span className={styles.logoText}>{businessConfig.businessName}</span>
        <small className={styles.logoSub}>Panel de gestión</small>
        
        {currentUser?.memberships && currentUser.memberships.length > 1 && (
          <div className={styles.workspaceSelectorContainer}>
            <span 
              className={styles.changeBusinessLink} 
              onClick={() => setShowWorkspaceDropdown(!showWorkspaceDropdown)}
            >
              Cambiar negocio ▾
            </span>
            
            {showWorkspaceDropdown && (
              <div className={styles.workspaceDropdownMenu}>
                {currentUser.memberships.map((m: any) => {
                  const isActive = m.businessId === businessConfig.business?._id;
                  return (
                    <div 
                      key={m.businessId}
                      className={`${styles.workspaceDropdownItem} ${isActive ? styles.activeItem : ''}`}
                      onClick={() => {
                        if (!isActive) switchWorkspace(m.businessId);
                        setShowWorkspaceDropdown(false);
                      }}
                    >
                      <span className={styles.workspaceName}>{m.businessName}</span>
                      <small className={styles.workspaceRole}>
                        {m.role === 'admin' ? 'Admin' : 'Especialista'}
                      </small>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <nav className={styles.nav}>
        {sections.map(sectionName => {
          const sectionItems = navItems.filter(
            item => item.section === sectionName && 
              (item.section === 'SaaS Admin' || businessConfig.enabledNavItems.includes(item.id))
          );

          if (sectionItems.length === 0) return null;

          return (
            <React.Fragment key={sectionName}>
              <div className={styles.sectionLabel}>{sectionName}</div>
              {sectionItems.map(item => (
                <div 
                  key={item.id}
                  className={`${styles.navItem} ${activeItemId === item.id ? styles.active : ''}`}
                  onClick={() => handleNavClick(item.id)}
                >
                  <span className={styles.icon}>{item.icon}</span>
                  {item.label}
                </div>
              ))}
            </React.Fragment>
          );
        })}

        <div 
          className={styles.navItem} 
          onClick={logoutUser}
          style={{ marginTop: '1.5rem', opacity: 0.85 }}
        >
          <span className={styles.icon}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </span>
          Cerrar sesión
        </div>
      </nav>

      <div className={styles.user}>
        <div className={styles.userAvatar}>{initials}</div>
        <div className={styles.userInfo}>
          <div className={styles.userName}>{fn} {ln}</div>
          <div className={styles.userRole}>
            {currentUser?.role === 'admin' ? 'Administrador' : (currentUser?.role === 'superadmin' ? 'Superadmin' : 'Especialista')}
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
