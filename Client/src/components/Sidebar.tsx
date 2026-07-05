import React from 'react';
import styles from './Sidebar.module.scss';
import { useCalendar } from '../context/CalendarContext';

interface NavItemDef {
  id: string;
  label: string;
  icon: string;
  section: 'Agenda' | 'Clientes' | 'Negocio' | 'Sistema';
}

const ALL_NAV_ITEMS: NavItemDef[] = [
  { id: 'calendario', label: 'Calendario', icon: '◫', section: 'Agenda' },
  { id: 'horarios', label: 'Horarios', icon: '◷', section: 'Agenda' },
  { id: 'clientes', label: 'Clientes', icon: '◎', section: 'Clientes' },
  { id: 'seguimiento', label: 'Seguimiento', icon: '◈', section: 'Clientes' },
  { id: 'servicios', label: 'Servicios', icon: '◧', section: 'Negocio' },
  { id: 'reglas', label: 'Reglas de negocio', icon: '◉', section: 'Negocio' },
  { id: 'equipo', label: 'Equipo', icon: '◌', section: 'Negocio' },
  { id: 'reportes', label: 'Reportes', icon: '◯', section: 'Sistema' }
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
    }
  };

  const fn = currentUser?.firstName || "";
  const ln = currentUser?.lastName || "";
  const initials = `${fn[0] || ""}${ln[0] || ""}`.toUpperCase() || "US";

  // Determine active item id
  const activeItemId = viewType === 'horarios' ? 'horarios' : 'calendario';

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
        {SECTIONS.map(sectionName => {
          const sectionItems = ALL_NAV_ITEMS.filter(
            item => item.section === sectionName && businessConfig.enabledNavItems.includes(item.id)
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
          <span className={styles.icon}>⏻</span>
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
