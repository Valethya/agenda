import React, { useEffect, useState, useMemo } from 'react';
import styles from './SaasBusinessesView.module.scss';
import { apiFetch, impersonateBusiness } from '../services/api';

interface Owner {
  firstName: string;
  lastName: string;
  email: string | string[];
  phone?: string | string[];
}

interface Business {
  _id: string;
  name: string;
  slug: string;
  isActive: boolean;
  owner?: Owner;
  createdAt?: string;
}

type SortOption = 'nombre' | 'fecha' | 'estado';

const getAvatarGradient = (slug: string) => {
  const gradients = [
    'linear-gradient(135deg,#8A9BAE,#7A8E9E)', // niebla
    'linear-gradient(135deg,#B5A898,#A5988A)', // tierra
    'linear-gradient(135deg,#7A9E8C,#6A8E7C)', // verde
    'linear-gradient(135deg,#C4AA7A,#B49A6A)', // amarillo
    'linear-gradient(135deg,#B5827A,#A5726A)'  // rojo
  ];
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = slug.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % gradients.length;
  return gradients[index];
};

const getInitials = (name: string): string => {
  if (!name) return '';
  const stopWords = ['de', 'del', 'el', 'la', 'los', 'las', 'y', 'en', 'para', 'con', 'a'];
  const words = name.split(/\s+/)
    .filter(w => w.length > 0)
    .filter(w => !stopWords.includes(w.toLowerCase()));
  
  if (words.length === 0) return name.slice(0, 2).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  
  return (words[0][0] + words[1][0]).toUpperCase();
};

// Componente para cargar el favicon dinámicamente o usar fallback de iniciales
const FaviconImage: React.FC<{ name: string; slug: string }> = ({ name, slug }) => {
  // Dominio personalizado para Atmosfera, para los demás se infiere del slug
  const domain = slug === 'atmosfera' || slug === 'atmosfera-landing' ? 'atmosfera.studio' : `${slug}.cl`;
  
  // Si estamos en localhost, asumimos de inmediato el fallback de iniciales de colores
  // para todos los negocios semilla locales, ya que sus dominios son simulados y no tienen favicon real.
  // Además, evitamos que DuckDuckGo retorne su icono de mundo/flecha genérico gris.
  const isLocalhost = typeof window !== 'undefined' && 
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  const [loading, setLoading] = useState(!isLocalhost);
  const [error, setError] = useState(isLocalhost);
  
  const initials = getInitials(name);
  const faviconUrl = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
  const avatarGradient = getAvatarGradient(slug);

  return (
    <div 
      className={`${styles.faviconWrap} ${loading ? styles.loading : ''} ${error ? styles.colored : ''}`}
      style={error ? { background: avatarGradient, border: 'none' } : undefined}
    >
      {error ? (
        <span className={styles.faviconFallback}>{initials}</span>
      ) : (
        <img
          src={faviconUrl}
          alt={name}
          onLoad={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setError(true);
          }}
        />
      )}
    </div>
  );
};

export const SaasBusinessesView: React.FC = () => {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Filtros y ordenamiento
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('nombre');

  // Modal para nuevo negocio
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newBizName, setNewBizName] = useState('');
  const [newBizSlug, setNewBizSlug] = useState('');
  const [ownerFirst, setOwnerFirst] = useState('');
  const [ownerLast, setOwnerLast] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [ownerPass, setOwnerPass] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchBusinesses = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch<{ status: string; payload: Business[] }>('/superadmin/businesses');
      if (res && res.status === 'success') {
        setBusinesses(res.payload);
      } else {
        setError('Error al obtener la lista de negocios.');
      }
    } catch (err) {
      console.error('Error fetching businesses:', err);
      setError('Error de conexión al cargar la lista de negocios.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBusinesses();
  }, []);

  const handleToggleStatus = async (id: string, currentStatus: boolean) => {
    try {
      setActionLoadingId(id);
      const res = await apiFetch<{ status: string; payload: Business }>(`/superadmin/businesses/${id}/status`, {
        method: 'PATCH'
      });
      if (res && res.status === 'success') {
        setBusinesses(prev => prev.map(b => b._id === id ? { ...b, isActive: res.payload.isActive } : b));
      } else {
        alert('Error al cambiar el estado del negocio');
      }
    } catch (err) {
      console.error('Error toggling business status:', err);
      alert('Error de conexión');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleImpersonate = async (b: Business) => {
    try {
      setActionLoadingId(b._id);
      const res = await impersonateBusiness(b._id);
      if (res && res.status === 'success') {
        window.location.href = `/admin?slug=${b.slug}`;
      } else {
        alert(res?.message || 'Error al iniciar suplantación');
      }
    } catch (err) {
      console.error('Error impersonating:', err);
      alert('Error de red al intentar impersonar el negocio');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleOpenBusiness = (b: Business) => {
    if (!b.isActive) return;

    // Selecciona un tenant explícito sin modificar la sesión del superadministrador.
    window.location.href = `/admin?slug=${encodeURIComponent(b.slug)}`;
  };

  // Auto-generación de slug
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setNewBizName(val);
    setNewBizSlug(val.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
    );
  };

  const handleCreateBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBizName || !newBizSlug || !ownerEmail || !ownerPass) {
      alert('Por favor rellena todos los campos obligatorios');
      return;
    }
    try {
      setCreating(true);
      const res = await apiFetch<{ status: string; payload: any }>('/superadmin/businesses', {
        method: 'POST',
        body: {
          name: newBizName,
          slug: newBizSlug,
          ownerEmail: ownerEmail,
          ownerPassword: ownerPass,
          ownerFirstName: ownerFirst || 'Admin',
          ownerLastName: ownerLast || newBizName,
          ownerPhone: ownerPhone
        }
      });

      if (res && res.status === 'success') {
        alert('Negocio y administrador creados correctamente.');
        setShowCreateModal(false);
        setNewBizName('');
        setNewBizSlug('');
        setOwnerFirst('');
        setOwnerLast('');
        setOwnerEmail('');
        setOwnerPhone('');
        setOwnerPass('');
        fetchBusinesses();
      } else {
        alert('Error al crear el negocio.');
      }
    } catch (err) {
      console.error('Error creating business:', err);
      alert('Error de conexión o datos duplicados.');
    } finally {
      setCreating(false);
    }
  };

  // Clasificación de Negocios
  const computedMetrics = useMemo(() => {
    let total = businesses.length;
    let active = 0;
    let trial = 0;
    let inactive = 0;

    businesses.forEach(b => {
      if (!b.isActive) {
        inactive++;
      } else if (b.slug === 'calavera' || b.slug === 'calavera-studio' || b.slug === 'calaveras' || b.slug === 'ink-studio') {
        trial++;
      } else {
        active++;
      }
    });

    return { total, active, trial, inactive };
  }, [businesses]);

  // Filtrado y ordenamiento procesado localmente
  const processedBusinesses = useMemo(() => {
    return businesses
      .filter(b => {
        const nameMatch = b.name.toLowerCase().includes(searchTerm.toLowerCase());
        const slugMatch = b.slug.toLowerCase().includes(searchTerm.toLowerCase());
        const ownerName = b.owner ? `${b.owner.firstName} ${b.owner.lastName}`.toLowerCase() : '';
        const ownerMatch = ownerName.includes(searchTerm.toLowerCase());
        return nameMatch || slugMatch || ownerMatch;
      })
      .sort((a, b) => {
        if (sortBy === 'nombre') {
          return a.name.localeCompare(b.name);
        }
        if (sortBy === 'fecha') {
          const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return dateB - dateA; // Más recientes primero
        }
        if (sortBy === 'estado') {
          const statusA = !a.isActive ? 'inactivo' : (a.slug === 'calavera' || a.slug === 'ink-studio' ? 'trial' : 'activo');
          const statusB = !b.isActive ? 'inactivo' : (b.slug === 'calavera' || b.slug === 'ink-studio' ? 'trial' : 'activo');
          return statusA.localeCompare(statusB);
        }
        return 0;
      });
  }, [businesses, searchTerm, sortBy]);

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  };

  if (loading) {
    return <div className={styles.loading}>Cargando lista de negocios...</div>;
  }

  if (error) {
    return (
      <div className={styles.errorContainer}>
        <p className={styles.errorText}>{error}</p>
        <button onClick={fetchBusinesses} className={styles.btnRetry}>Reintentar</button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* PAGE HEADER */}
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderTop}>
          <div>
            <h1 className={styles.pageTitle}>Negocios registrados</h1>
            <p className={styles.pageDesc}>Selecciona un negocio para abrir su panel sin cambiar tu identidad, o inicia el modo soporte mediante impersonación.</p>
          </div>
        </div>
        <div className={styles.pageStats}>
          <div className={styles.pstat}>
            <div className={styles.pstatNum}>{computedMetrics.total}</div>
            <div className={styles.pstatLabel}>Total</div>
          </div>
          <div className={styles.pstatDivider}></div>
          <div className={styles.pstat}>
            <div className={styles.pstatNum}>{computedMetrics.active}</div>
            <div className={styles.pstatLabel}>Activos</div>
          </div>
          <div className={styles.pstatDivider}></div>
          <div className={styles.pstat}>
            <div className={styles.pstatNum}>{computedMetrics.trial}</div>
            <div className={styles.pstatLabel}>En trial</div>
          </div>
          <div className={styles.pstatDivider}></div>
          <div className={styles.pstat}>
            <div className={styles.pstatNum}>{computedMetrics.inactive}</div>
            <div className={styles.pstatLabel}>Inactivos</div>
          </div>
        </div>
      </div>

      {/* TOOLBAR */}
      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input 
            type="text" 
            placeholder="Buscar por nombre, slug o dueño..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className={styles.toolbarRight}>
          <span className={styles.sortLabel}>Ordenar por</span>
          <select 
            className={styles.sortSelect} 
            value={sortBy} 
            onChange={(e) => setSortBy(e.target.value as SortOption)}
          >
            <option value="nombre">Nombre (A-Z)</option>
            <option value="fecha">Fecha de registro</option>
            <option value="estado">Estado</option>
          </select>
          <button className={styles.btnNew} onClick={() => setShowCreateModal(true)}>
            <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            Nuevo negocio
          </button>
        </div>
      </div>

      {/* TABLA DE NEGOCIOS */}
      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>
              <th>Negocio</th>
              <th>Slug</th>
              <th>Dueño / Administrador</th>
              <th>Contacto</th>
              <th>Registro</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {processedBusinesses.map(b => {
              const ownerEmail = b.owner 
                ? (Array.isArray(b.owner.email) ? b.owner.email[0] : b.owner.email) 
                : 'Sin asignar';
              const ownerPhone = b.owner 
                ? (Array.isArray(b.owner.phone) ? b.owner.phone[0] : b.owner.phone) 
                : '';

              // Estado de badges y clases del mock
              let statusClass = styles.statusActivo;
              let statusText = 'Activo';
              if (!b.isActive) {
                statusClass = styles.statusInactivo;
                statusText = 'Inactivo';
              } else if (b.slug === 'calavera' || b.slug === 'calavera-studio' || b.slug === 'calaveras' || b.slug === 'ink-studio') {
                statusClass = styles.statusTrial;
                statusText = 'Trial';
              }

              return (
                <tr key={b._id}>
                  {/* Negocio (Favicon + Nombre) */}
                  <td>
                    <div className={styles.negocioCell}>
                      <FaviconImage name={b.name} slug={b.slug} />
                      <div className={styles.negocioInfo}>
                        <div className={styles.negocioName}>{b.name}</div>
                        <div className={styles.negocioId}>ID: {b._id}</div>
                      </div>
                    </div>
                  </td>

                  {/* Slug */}
                  <td>
                    <span className={styles.slugChip}>{b.slug}</span>
                  </td>

                  {/* Dueño / Administrador */}
                  <td>
                    <div className={styles.ownerName}>{b.owner ? `${b.owner.firstName} ${b.owner.lastName}` : 'Sin dueño'}</div>
                    <div className={styles.ownerEmail}>{ownerEmail}</div>
                  </td>

                  {/* Contacto */}
                  <td>
                    <div className={styles.contactTel}>{ownerPhone || '—'}</div>
                  </td>

                  {/* Registro */}
                  <td>
                    <div className={styles.regDate}>{formatDate(b.createdAt)}</div>
                  </td>

                  {/* Estado */}
                  <td>
                    <span 
                      className={`${styles.statusBadge} ${statusClass}`}
                      onClick={() => handleToggleStatus(b._id, b.isActive)}
                      title="Haz clic para activar/desactivar el negocio"
                    >
                      {statusText}
                    </span>
                  </td>

                  {/* Acciones (Botonera hover) */}
                  <td>
                    <div className={styles.rowActions}>
                      <button 
                        className={`${styles.actionBtn} ${styles.acceder}`} 
                        onClick={() => handleOpenBusiness(b)}
                        disabled={actionLoadingId !== null || !b.isActive}
                        title={`Abrir el panel de ${b.name} sin impersonar`}
                        aria-label={`Abrir el panel de ${b.name} sin impersonar`}
                      >
                        <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
                      </button>
                      <button
                        className={`${styles.actionBtn} ${styles.impersonar}`}
                        onClick={() => handleImpersonate(b)}
                        disabled={actionLoadingId !== null || !b.isActive}
                        title={`Impersonar al administrador de ${b.name}`}
                        aria-label={`Impersonar al administrador de ${b.name}`}
                      >
                        <svg viewBox="0 0 24 24"><path d="M20 21a8 8 0 0 0-16 0"></path><circle cx="12" cy="7" r="4"></circle><polyline points="16 11 18 13 22 9"></polyline></svg>
                      </button>
                      <button 
                        className={styles.actionBtn} 
                        onClick={() => handleToggleStatus(b._id, b.isActive)}
                        disabled={actionLoadingId !== null}
                        title={b.isActive ? "Suspender Negocio" : "Activar Negocio"}
                        aria-label={b.isActive ? `Suspender ${b.name}` : `Activar ${b.name}`}
                      >
                        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {processedBusinesses.length === 0 && (
              <tr>
                <td colSpan={7} className={styles.noData}>No se encontraron negocios con los filtros aplicados.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal para Crear Nuevo Negocio */}
      {showCreateModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <h3>Registrar Nuevo Negocio</h3>
              <button className={styles.closeBtn} onClick={() => setShowCreateModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreateBusiness} className={styles.modalForm}>
              <div className={styles.formSection}>
                <h4>Detalles del Negocio</h4>
                <div className={styles.formGroup}>
                  <label>Nombre del Negocio *</label>
                  <input 
                    type="text" 
                    required 
                    placeholder="Ej. Barbería VIP" 
                    value={newBizName} 
                    onChange={handleNameChange}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label>Slug de acceso *</label>
                  <input 
                    type="text" 
                    required 
                    placeholder="ej-barberia-vip" 
                    value={newBizSlug} 
                    onChange={(e) => setNewBizSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                  />
                </div>
              </div>

              <div className={styles.formSection}>
                <h4>Cuenta del Administrador</h4>
                <div className={styles.formGrid}>
                  <div className={styles.formGroup}>
                    <label>Nombre *</label>
                    <input 
                      type="text" 
                      required 
                      placeholder="Pedro" 
                      value={ownerFirst} 
                      onChange={(e) => setOwnerFirst(e.target.value)}
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label>Apellido *</label>
                    <input 
                      type="text" 
                      required 
                      placeholder="Barbero" 
                      value={ownerLast} 
                      onChange={(e) => setOwnerLast(e.target.value)}
                    />
                  </div>
                </div>
                <div className={styles.formGroup}>
                  <label>Email *</label>
                  <input 
                    type="email" 
                    required 
                    placeholder="pedro@barberia.com" 
                    value={ownerEmail} 
                    onChange={(e) => setOwnerEmail(e.target.value)}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label>Teléfono *</label>
                  <input 
                    type="text" 
                    required 
                    placeholder="+56912345678" 
                    value={ownerPhone} 
                    onChange={(e) => setOwnerPhone(e.target.value)}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label>Contraseña *</label>
                  <input 
                    type="password" 
                    required 
                    placeholder="Mínimo 6 caracteres" 
                    value={ownerPass} 
                    onChange={(e) => setOwnerPass(e.target.value)}
                  />
                </div>
              </div>

              <div className={styles.modalActions}>
                <button type="button" className={styles.btnCancel} onClick={() => setShowCreateModal(false)}>
                  Cancelar
                </button>
                <button type="submit" className={styles.btnSubmit} disabled={creating}>
                  {creating ? 'Registrando...' : 'Crear Negocio'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SaasBusinessesView;
