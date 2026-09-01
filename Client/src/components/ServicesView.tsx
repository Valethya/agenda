import React from 'react';
import styles from './ServicesView.module.scss';
import {
  createAdminService,
  deactivateAdminService,
  getAdminServices,
  getTeam,
  isApiError,
  updateAdminService
} from '../services/api';
import type { Service, TeamMembership } from '../types';
import {
  EMPTY_SERVICE_FORM,
  buildServiceWriteInput,
  getAssignableTeamMembers,
  getUnavailableAssignedWorkers,
  removeWorkerAssignment,
  replaceCanonicalService,
  serviceToForm,
  validateServiceWriteInput,
  type ServiceFormState
} from '../features/services/serviceRules';

type LoadState = 'loading' | 'loaded' | 'error';
type EditorMode = 'closed' | 'create' | 'edit';
type Feedback = { tone: 'success' | 'error'; message: string };

const currency = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0
});

const errorMessage = (error: unknown, fallback: string) => {
  if (isApiError(error) && error.message) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};

export const ServicesView: React.FC = () => {
  const [services, setServices] = React.useState<Service[]>([]);
  const [team, setTeam] = React.useState<TeamMembership[]>([]);
  const [loadState, setLoadState] = React.useState<LoadState>('loading');
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [editorMode, setEditorMode] = React.useState<EditorMode>('closed');
  const [editingServiceId, setEditingServiceId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<ServiceFormState>({ ...EMPTY_SERVICE_FORM });
  const [submitting, setSubmitting] = React.useState(false);
  const [pendingServiceIds, setPendingServiceIds] = React.useState<Set<string>>(new Set());
  const [feedback, setFeedback] = React.useState<Feedback | null>(null);
  const submitGuard = React.useRef(false);
  const pendingRef = React.useRef<Set<string>>(new Set());

  const load = React.useCallback(async () => {
    setLoadState('loading');
    setLoadError(null);
    try {
      const [canonicalServices, canonicalTeam] = await Promise.all([
        getAdminServices(),
        getTeam()
      ]);
      setServices(canonicalServices);
      setTeam(canonicalTeam);
      setLoadState('loaded');
    } catch (error) {
      setServices([]);
      setTeam([]);
      setLoadState('error');
      setLoadError(errorMessage(error, 'No pudimos cargar los servicios del negocio.'));
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const assignableTeam = React.useMemo(() => getAssignableTeamMembers(team), [team]);
  const teamByUserId = React.useMemo(
    () => new Map(team.map((member) => [member.userId, member])),
    [team]
  );
  const editingService = React.useMemo(
    () => services.find((service) => service._id === editingServiceId) || null,
    [editingServiceId, services]
  );
  const unavailableAssignments = React.useMemo(
    () => editorMode === 'edit' && editingService
      ? getUnavailableAssignedWorkers(editingService, team)
        .filter((worker) => form.workers.includes(worker.userId))
      : [],
    [editingService, editorMode, form.workers, team]
  );

  const openCreate = () => {
    setFeedback(null);
    setEditingServiceId(null);
    setForm({ ...EMPTY_SERVICE_FORM, workers: [] });
    setEditorMode('create');
  };

  const openEdit = (service: Service) => {
    setFeedback(null);
    setEditingServiceId(service._id);
    setForm(serviceToForm(service));
    setEditorMode('edit');
  };

  const closeEditor = () => {
    if (submitting) return;
    setEditorMode('closed');
    setEditingServiceId(null);
    setForm({ ...EMPTY_SERVICE_FORM, workers: [] });
  };

  const toggleWorker = (userId: string) => {
    if (submitting) return;
    setForm((current) => ({
      ...current,
      workers: current.workers.includes(userId)
        ? current.workers.filter((id) => id !== userId)
        : [...current.workers, userId]
    }));
  };

  const removeUnavailableWorker = (userId: string) => {
    if (submitting) return;
    setForm((current) => removeWorkerAssignment(current, userId));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitGuard.current || editorMode === 'closed') return;

    const input = buildServiceWriteInput(form);
    const validationError = validateServiceWriteInput(input);
    if (validationError) {
      setFeedback({ tone: 'error', message: validationError });
      return;
    }

    submitGuard.current = true;
    setSubmitting(true);
    setFeedback(null);

    try {
      const canonicalService = editorMode === 'create'
        ? await createAdminService(input)
        : await updateAdminService(editingServiceId || '', input);

      setServices((current) => replaceCanonicalService(current, canonicalService));
      setFeedback({
        tone: 'success',
        message: editorMode === 'create' ? 'Servicio creado correctamente.' : 'Servicio actualizado correctamente.'
      });
      setEditorMode('closed');
      setEditingServiceId(null);
      setForm({ ...EMPTY_SERVICE_FORM, workers: [] });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: errorMessage(error, 'No pudimos guardar el servicio. El estado anterior se mantiene.')
      });
    } finally {
      submitGuard.current = false;
      setSubmitting(false);
    }
  };

  const setServicePending = (serviceId: string, pending: boolean) => {
    if (pending) pendingRef.current.add(serviceId);
    else pendingRef.current.delete(serviceId);
    setPendingServiceIds(new Set(pendingRef.current));
  };

  const handleDeactivate = async (service: Service) => {
    if (!service.isActive || pendingRef.current.has(service._id)) return;

    setServicePending(service._id, true);
    setFeedback(null);
    try {
      const canonicalService = await deactivateAdminService(service._id);
      setServices((current) => replaceCanonicalService(current, canonicalService));
      setFeedback({ tone: 'success', message: `“${service.name}” fue desactivado.` });
      if (editingServiceId === service._id) closeEditor();
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: errorMessage(error, 'No pudimos desactivar el servicio. El estado anterior se mantiene.')
      });
    } finally {
      setServicePending(service._id, false);
    }
  };

  const workerNames = (service: Service) => {
    const names = (service.workers || []).map((worker) => {
      const userId = typeof worker === 'string' ? worker : worker._id;
      const fromTeam = teamByUserId.get(userId)?.name;
      if (fromTeam) return fromTeam;
      if (typeof worker !== 'string') {
        const populatedName = `${worker.firstName || ''} ${worker.lastName || ''}`.trim();
        if (populatedName) return populatedName;
      }
      return 'Profesional asignado';
    });
    return names.length > 0 ? names.join(', ') : 'Sin profesionales asignados';
  };

  if (loadState === 'loading') {
    return (
      <section className={styles.statePanel} aria-live="polite" aria-busy="true">
        <div className={styles.spinner} aria-hidden="true" />
        <p>Cargando servicios...</p>
      </section>
    );
  }

  if (loadState === 'error') {
    return (
      <section className={styles.statePanel} role="alert">
        <h2>No pudimos cargar Servicios</h2>
        <p>{loadError}</p>
        <button type="button" className={styles.primaryButton} onClick={() => void load()}>
          Reintentar
        </button>
      </section>
    );
  }

  return (
    <section className={styles.servicesView} aria-labelledby="services-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Administración</p>
          <h1 id="services-title">Servicios</h1>
          <p className={styles.description}>
            Administra lo que ofrece este negocio y qué personas bookable pueden prestar cada servicio.
          </p>
        </div>
        <button type="button" className={styles.primaryButton} onClick={openCreate} disabled={submitting}>
          Crear servicio
        </button>
      </header>

      <div className={styles.feedback} aria-live="polite" aria-atomic="true">
        {feedback && (
          <p className={feedback.tone === 'success' ? styles.success : styles.error}>
            {feedback.message}
          </p>
        )}
      </div>

      {editorMode !== 'closed' && (
        <form className={styles.editor} onSubmit={handleSubmit} aria-busy={submitting}>
          <div className={styles.editorHeader}>
            <div>
              <p className={styles.eyebrow}>{editorMode === 'create' ? 'Nuevo servicio' : 'Editar servicio'}</p>
              <h2>{editorMode === 'create' ? 'Crear servicio' : 'Actualizar servicio'}</h2>
            </div>
            <button type="button" className={styles.secondaryButton} onClick={closeEditor} disabled={submitting}>
              Cerrar
            </button>
          </div>

          <div className={styles.formGrid}>
            <label className={styles.field} htmlFor="service-name">
              <span>Nombre</span>
              <input
                id="service-name"
                required
                minLength={3}
                value={form.name}
                disabled={submitting}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              />
            </label>

            <label className={`${styles.field} ${styles.fieldWide}`} htmlFor="service-description">
              <span>Descripción</span>
              <textarea
                id="service-description"
                maxLength={500}
                rows={3}
                value={form.description}
                disabled={submitting}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              />
            </label>

            <label className={styles.field} htmlFor="service-duration">
              <span>Duración (minutos)</span>
              <input
                id="service-duration"
                type="number"
                min="1"
                step="1"
                required
                inputMode="numeric"
                value={form.duration}
                disabled={submitting}
                onChange={(event) => setForm((current) => ({ ...current, duration: event.target.value }))}
              />
            </label>

            <label className={styles.field} htmlFor="service-price">
              <span>Precio</span>
              <input
                id="service-price"
                type="number"
                min="0"
                step="1"
                required
                inputMode="numeric"
                value={form.price}
                disabled={submitting}
                onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))}
              />
            </label>

            <label className={styles.field} htmlFor="service-deposit">
              <span>Monto de abono</span>
              <input
                id="service-deposit"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={form.depositAmount}
                disabled={submitting}
                onChange={(event) => setForm((current) => ({ ...current, depositAmount: event.target.value }))}
              />
            </label>
          </div>

          <fieldset className={styles.professionals} disabled={submitting}>
            <legend>Profesionales</legend>
            <p>Se muestran como disponibles sólo participantes activos con “Presta servicios” habilitado en Equipo.</p>
            {assignableTeam.length === 0 ? (
              <p className={styles.empty}>No hay profesionales bookable disponibles.</p>
            ) : (
              <div className={styles.checkboxGrid}>
                {assignableTeam.map((member) => (
                  <label key={member.userId} className={styles.checkOption}>
                    <input
                      type="checkbox"
                      checked={form.workers.includes(member.userId)}
                      onChange={() => toggleWorker(member.userId)}
                    />
                    <span>{member.name || 'Integrante del equipo'}</span>
                  </label>
                ))}
              </div>
            )}

            {unavailableAssignments.length > 0 && (
              <div className={styles.unavailableAssignments} aria-label="Asignaciones existentes no disponibles">
                <p className={styles.unavailableHeading}>
                  <strong>Asignaciones existentes no disponibles</strong>
                  <span> Ya no cumplen las condiciones actuales de Equipo. Puedes quitarlas, pero no volver a seleccionarlas desde aquí.</span>
                </p>
                <div className={styles.unavailableList}>
                  {unavailableAssignments.map((worker) => (
                    <div key={worker.userId} className={styles.unavailableOption}>
                      <div className={styles.unavailableIdentity}>
                        <strong>{worker.name || 'Profesional asignado'}</strong>
                        <small>No disponible para nuevas reservas</small>
                      </div>
                      <button
                        type="button"
                        className={styles.dangerButton}
                        onClick={() => removeUnavailableWorker(worker.userId)}
                      >
                        Quitar del servicio
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </fieldset>

          <div className={styles.formActions}>
            <button type="submit" className={styles.primaryButton} disabled={submitting}>
              {submitting ? 'Guardando…' : (editorMode === 'create' ? 'Crear servicio' : 'Guardar cambios')}
            </button>
          </div>
        </form>
      )}

      <div className={styles.summary} aria-label={`${services.length} servicios`}>
        <span>{services.filter((service) => service.isActive).length} activos</span>
        <span>{services.filter((service) => !service.isActive).length} inactivos</span>
      </div>

      <div className={styles.serviceGrid}>
        {services.map((service) => {
          const pending = pendingServiceIds.has(service._id);
          return (
            <article key={service._id} className={styles.serviceCard}>
              <div className={styles.cardHeader}>
                <div>
                  <h2>{service.name}</h2>
                  <span className={service.isActive ? styles.activeBadge : styles.inactiveBadge}>
                    {service.isActive ? 'Activo' : 'Inactivo'}
                  </span>
                </div>
                <strong>{currency.format(service.price)}</strong>
              </div>

              {service.description && <p className={styles.cardDescription}>{service.description}</p>}

              <dl className={styles.meta}>
                <div><dt>Duración</dt><dd>{service.duration} min</dd></div>
                <div><dt>Abono</dt><dd>{currency.format(service.depositAmount ?? 0)}</dd></div>
                <div><dt>Profesionales</dt><dd>{workerNames(service)}</dd></div>
              </dl>

              <div className={styles.cardActions}>
                <button type="button" className={styles.secondaryButton} onClick={() => openEdit(service)} disabled={pending || submitting}>
                  Editar
                </button>
                {service.isActive && (
                  <button
                    type="button"
                    className={styles.dangerButton}
                    onClick={() => void handleDeactivate(service)}
                    disabled={pending || submitting}
                  >
                    {pending ? 'Desactivando…' : 'Desactivar servicio'}
                  </button>
                )}
              </div>
            </article>
          );
        })}

        {services.length === 0 && (
          <div className={styles.emptyState}>
            <h2>Aún no hay servicios</h2>
            <p>Crea el primer servicio del negocio cuando estés listo.</p>
          </div>
        )}
      </div>
    </section>
  );
};

export default ServicesView;
