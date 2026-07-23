import React from 'react';
import styles from './Sidebar.module.scss';
import { useCalendarData } from '../context/CalendarDataContext';
import { useCalendarNavigation } from '../context/CalendarNavigationContext';
import { useSession } from '../context/SessionContext';
import { shouldShowWorkspaceSwitcher } from '../context/sessionPolicy';
import {
  ActivityIcon,
  BarChartIcon,
  BriefcaseIcon,
  CalendarIcon,
  ClockIcon,
  LogoutIcon,
  MonitorIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon
} from './icons/SidebarIcons';

type NavSection = 'Agenda' | 'Clientes' | 'Negocio' | 'Sistema' | 'SaaS Admin';

interface NavItemDef {
  id: string;
  label: string;
  icon: React.ReactNode;
  section: NavSection;
}

const ALL_NAV_ITEMS: NavItemDef[] = [
  { id: 'calendario', label: 'Calendario', icon: <CalendarIcon />, section: 'Agenda' },
  { id: 'horarios', label: 'Horarios', icon: <ClockIcon />, section: 'Agenda' },
  { id: 'clientes', label: 'Clientes', icon: <UserIcon />, section: 'Clientes' },
  { id: 'seguimiento', label: 'Seguimiento', icon: <ActivityIcon />, section: 'Clientes' },
  { id: 'servicios', label: 'Servicios', icon: <MonitorIcon />, section: 'Negocio' },
  { id: 'reglas', label: 'Reglas de negocio', icon: <ShieldIcon />, section: 'Negocio' },
  { id: 'equipo', label: 'Equipo', icon: <UsersIcon />, section: 'Negocio' },
  { id: 'reportes', label: 'Reportes', icon: <BarChartIcon />, section: 'Sistema' }
];

const SECTIONS: NavSection[] = ['Agenda', 'Clientes', 'Negocio', 'Sistema'];

export const Sidebar: React.FC = () => {
  const { viewType, setViewType } = useCalendarNavigation();
  const { businessConfig } = useCalendarData();
  const { currentUser, logoutUser, switchWorkspace } = useSession();
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
        icon: <BriefcaseIcon />,
        section: 'SaaS Admin' 
      },
      { 
        id: 'saas-metricas', 
        label: 'Métricas SaaS', 
        icon: <ActivityIcon />,
        section: 'SaaS Admin' 
      }
    );
    sections.push('SaaS Admin');
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo} ref={dropdownRef}>
        <span className={styles.logoText}>{businessConfig.businessName}</span>
        <small className={styles.logoSub}>Panel de gestión</small>
        
        {shouldShowWorkspaceSwitcher(currentUser) && currentUser && (
          <div className={styles.workspaceSelectorContainer}>
            <span 
              className={styles.changeBusinessLink} 
              onClick={() => setShowWorkspaceDropdown(!showWorkspaceDropdown)}
            >
              Cambiar negocio ▾
            </span>
            
            {showWorkspaceDropdown && (
              <div className={styles.workspaceDropdownMenu}>
                {currentUser.memberships.map((m) => {
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
          <span className={styles.icon}><LogoutIcon /></span>
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
