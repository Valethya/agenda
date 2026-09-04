import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  createPublicBookingApi,
  isPublicBookingApiError,
} from './api';
import {
  BookingCommitCoordinator,
  bookingReducer,
  buildBookingCommitIdentity,
  buildPublicBookingPayload,
  initialBookingState,
  RequestIdentityGate,
  validateClientInfo,
} from './bookingModel';
import { resolvePublicBookingSlugFromSearch } from './runtimeSlug';
import type { PublicClientInfo, PublicProfessional, PublicService, PublicSlot } from './types';
import styles from './PublicBookingFlow.module.scss';

const isAbortError = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

const displayDate = (date: string) => {
  if (!date) return '';
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('es-CL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, day));
};

const localToday = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function PublicBookingFlow() {
  const [runtimeIdentity, setRuntimeIdentity] = useState<{ resolved: boolean; slug: string | null }>({
    resolved: false,
    slug: null,
  });
  const slug = runtimeIdentity.slug;
  const [state, dispatch] = useReducer(bookingReducer, undefined, initialBookingState);
  const gateRef = useRef(new RequestIdentityGate());
  const commitCoordinatorRef = useRef(new BookingCommitCoordinator());
  const previousSlugRef = useRef(slug);
  const servicesAbortRef = useRef<AbortController | null>(null);
  const professionalsAbortRef = useRef<AbortController | null>(null);
  const slotsAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setRuntimeIdentity({
      resolved: true,
      slug: resolvePublicBookingSlugFromSearch(window.location.search),
    });
  }, []);

  const api = useMemo(
    () => createPublicBookingApi({ slug: slug || '' }),
    [slug],
  );

  useEffect(() => {
    if (previousSlugRef.current === slug) return;
    previousSlugRef.current = slug;
    servicesAbortRef.current?.abort();
    professionalsAbortRef.current?.abort();
    slotsAbortRef.current?.abort();
    gateRef.current.invalidate('services');
    gateRef.current.invalidate('professionals');
    gateRef.current.invalidate('slots');
    commitCoordinatorRef.current.invalidate();
    dispatch({ type: 'contextReset' });
  }, [slug]);

  const loadServices = useCallback(async () => {
    if (!slug) return;
    servicesAbortRef.current?.abort();
    const controller = new AbortController();
    servicesAbortRef.current = controller;
    const token = gateRef.current.begin('services', slug);
    dispatch({ type: 'servicesLoading' });

    try {
      const services = await api.getServices(controller.signal);
      if (!gateRef.current.isCurrent(token, slug)) return;
      dispatch({ type: 'servicesLoaded', services });
    } catch (error) {
      if (isAbortError(error) || !gateRef.current.isCurrent(token, slug)) return;
      const message = isPublicBookingApiError(error) && error.status === 404
        ? 'No encontramos un negocio activo para este enlace de reserva.'
        : 'No pudimos cargar los servicios. Intenta nuevamente.';
      dispatch({ type: 'servicesError', message });
    }
  }, [api, slug]);

  useEffect(() => {
    if (!runtimeIdentity.resolved) return undefined;
    void loadServices();
    return () => {
      servicesAbortRef.current?.abort();
      professionalsAbortRef.current?.abort();
      slotsAbortRef.current?.abort();
    };
  }, [loadServices, runtimeIdentity.resolved]);

  const loadProfessionals = useCallback(async (service: PublicService) => {
    professionalsAbortRef.current?.abort();
    slotsAbortRef.current?.abort();
    gateRef.current.invalidate('slots');
    const controller = new AbortController();
    professionalsAbortRef.current = controller;
    const token = gateRef.current.begin('professionals', service.id);
    dispatch({ type: 'professionalsLoading' });

    try {
      const professionals = await api.getProfessionals(service.id, controller.signal);
      if (!gateRef.current.isCurrent(token, service.id)) return;
      dispatch({ type: 'professionalsLoaded', professionals });
    } catch (error) {
      if (isAbortError(error) || !gateRef.current.isCurrent(token, service.id)) return;
      if (isPublicBookingApiError(error) && error.status === 404) {
        dispatch({
          type: 'eligibilityLost',
          message: 'El servicio dejó de estar disponible. Elige nuevamente.',
        });
        void loadServices();
        return;
      }
      dispatch({ type: 'professionalsError', message: 'No pudimos cargar los profesionales. Intenta nuevamente.' });
    }
  }, [api, loadServices]);

  const selectService = (service: PublicService) => {
    professionalsAbortRef.current?.abort();
    slotsAbortRef.current?.abort();
    gateRef.current.invalidate('professionals');
    gateRef.current.invalidate('slots');
    commitCoordinatorRef.current.invalidate();
    dispatch({ type: 'selectService', service });
    void loadProfessionals(service);
  };

  const selectProfessional = (professional: PublicProfessional) => {
    slotsAbortRef.current?.abort();
    gateRef.current.invalidate('slots');
    commitCoordinatorRef.current.invalidate();
    dispatch({ type: 'selectProfessional', professional });
  };

  const loadSlots = useCallback(async (date: string, serviceId: string, workerId: string) => {
    slotsAbortRef.current?.abort();
    const controller = new AbortController();
    slotsAbortRef.current = controller;
    const key = `${serviceId}:${workerId}:${date}`;
    const token = gateRef.current.begin('slots', key);
    dispatch({ type: 'slotsLoading' });

    try {
      const slots = await api.getSlots({ workerId, serviceId, date }, controller.signal);
      if (!gateRef.current.isCurrent(token, key)) return;
      dispatch({ type: 'slotsLoaded', slots: slots.filter((slot) => slot.available) });
    } catch (error) {
      if (isAbortError(error) || !gateRef.current.isCurrent(token, key)) return;
      if (isPublicBookingApiError(error) && error.status === 404) {
        dispatch({
          type: 'eligibilityLost',
          message: 'La combinación elegida dejó de estar disponible. Elige nuevamente.',
        });
        void loadServices();
        return;
      }
      dispatch({ type: 'slotsError', message: 'No pudimos consultar la disponibilidad. Intenta nuevamente.' });
    }
  }, [api, loadServices]);

  const selectDate = (date: string) => {
    slotsAbortRef.current?.abort();
    gateRef.current.invalidate('slots');
    commitCoordinatorRef.current.invalidate();
    dispatch({ type: 'selectDate', date });
    if (date && state.service && state.professional) {
      void loadSlots(date, state.service.id, state.professional.id);
    }
  };

  const selectSlot = (slot: PublicSlot) => {
    commitCoordinatorRef.current.invalidate();
    dispatch({ type: 'selectSlot', slot });
  };

  const updateClientInfo = (field: keyof PublicClientInfo, value: string) => {
    dispatch({
      type: 'setClientInfo',
      clientInfo: { ...state.clientInfo, [field]: value },
    });
  };

  const goToReview = () => {
    const validation = validateClientInfo(state.clientInfo, state.notes);
    if (validation) {
      dispatch({ type: 'formError', message: validation });
      return;
    }
    dispatch({ type: 'setStep', step: 'review' });
  };

  const refreshCurrentSlots = async () => {
    if (!state.service || !state.professional || !state.date) return;
    await loadSlots(state.date, state.service.id, state.professional.id);
  };

  const submit = async () => {
    if (state.submitting || commitCoordinatorRef.current.isInFlight()) return;

    let payload;
    let identity;
    try {
      payload = buildPublicBookingPayload(state);
      identity = buildBookingCommitIdentity(slug || '', state);
    } catch {
      dispatch({ type: 'submitError', message: 'La selección ya no está completa. Revisa el horario elegido.' });
      return;
    }

    dispatch({ type: 'submitStart' });
    const result = await commitCoordinatorRef.current.execute(identity, payload, api.createAppointment);

    if (result.kind === 'ignored' || result.kind === 'stale') return;
    if (result.kind === 'success') {
      dispatch({ type: 'submitSuccess', appointment: result.appointment });
      return;
    }
    if (result.kind === 'slot-conflict') {
      dispatch({
        type: 'slotConflict',
        message: 'Ese horario dejó de estar disponible. Elige otro horario.',
      });
      await refreshCurrentSlots();
      return;
    }
    if (result.kind === 'eligibility-lost') {
      dispatch({
        type: 'eligibilityLost',
        message: 'La reserva ya no puede realizarse con esa selección. Elige nuevamente.',
      });
      await loadServices();
      return;
    }
    if (result.kind === 'validation-error') {
      dispatch({ type: 'submitError', message: 'Revisa los datos ingresados antes de reservar.' });
      return;
    }
    dispatch({ type: 'submitError', message: result.message });
  };

  if (!runtimeIdentity.resolved) {
    return (
      <main className={styles.shell}>
        <section className={styles.card}>
          <p className={styles.eyebrow}>Agenda</p>
          <h1>Reservar una hora</h1>
          <p className={styles.message}>Cargando enlace de reserva…</p>
        </section>
      </main>
    );
  }

  if (!slug) {
    return (
      <main className={styles.shell}>
        <section className={styles.card}>
          <p className={styles.eyebrow}>Agenda</p>
          <h1>Reservar una hora</h1>
          <p className={styles.message}>Este enlace de reserva no incluye un negocio válido.</p>
        </section>
      </main>
    );
  }

  if (state.step === 'success' && state.confirmation && state.service && state.professional) {
    return (
      <main className={styles.shell}>
        <section className={styles.card} aria-live="polite">
          <p className={styles.eyebrow}>Reserva confirmada</p>
          <h1>Tu hora fue creada</h1>
          <dl className={styles.summary}>
            <div><dt>Servicio</dt><dd>{state.service.name}</dd></div>
            <div><dt>Profesional</dt><dd>{state.professional.firstName} {state.professional.lastName}</dd></div>
            <div><dt>Fecha</dt><dd>{displayDate(state.confirmation.date.slice(0, 10))}</dd></div>
            <div><dt>Hora</dt><dd>{state.confirmation.startTime}</dd></div>
          </dl>
          <p className={styles.message}>La reserva fue registrada correctamente.</p>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <section className={styles.card}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Agenda</p>
          <h1>Reservar una hora</h1>
          <p>Selecciona servicio, profesional y horario. La disponibilidad se confirma al reservar.</p>
        </header>

        {state.error && <div className={styles.alert} role="alert">{state.error}</div>}
        {state.formError && <div className={styles.alert} role="alert">{state.formError}</div>}

        {state.step === 'service' && (
          <section aria-labelledby="service-title">
            <h2 id="service-title">1. Servicio</h2>
            {state.loadingServices && <p className={styles.message}>Cargando servicios…</p>}
            {!state.loadingServices && state.services.length === 0 && !state.error && (
              <p className={styles.message}>No hay servicios disponibles para reservar.</p>
            )}
            <div className={styles.options}>
              {state.services.map((service) => (
                <button key={service.id} type="button" className={styles.option} onClick={() => selectService(service)}>
                  <strong>{service.name}</strong>
                  {service.description && <span>{service.description}</span>}
                  <small>{service.duration} min</small>
                </button>
              ))}
            </div>
            {state.error && <button type="button" className={styles.secondary} onClick={() => void loadServices()}>Reintentar</button>}
          </section>
        )}

        {state.step === 'professional' && state.service && (
          <section aria-labelledby="professional-title">
            <button type="button" className={styles.back} onClick={() => dispatch({ type: 'setStep', step: 'service' })}>← Cambiar servicio</button>
            <p className={styles.selection}>Servicio: <strong>{state.service.name}</strong></p>
            <h2 id="professional-title">2. Profesional</h2>
            {state.loadingProfessionals && <p className={styles.message}>Cargando profesionales…</p>}
            {!state.loadingProfessionals && state.professionals.length === 0 && !state.error && (
              <p className={styles.message}>No hay profesionales disponibles para este servicio.</p>
            )}
            <div className={styles.options}>
              {state.professionals.map((professional) => (
                <button key={professional.id} type="button" className={styles.option} onClick={() => selectProfessional(professional)}>
                  <strong>{professional.firstName} {professional.lastName}</strong>
                </button>
              ))}
            </div>
            {state.error && <button type="button" className={styles.secondary} onClick={() => void loadProfessionals(state.service!)}>Reintentar</button>}
          </section>
        )}

        {state.step === 'schedule' && state.service && state.professional && (
          <section aria-labelledby="schedule-title">
            <button type="button" className={styles.back} onClick={() => dispatch({ type: 'setStep', step: 'professional' })}>← Cambiar profesional</button>
            <p className={styles.selection}><strong>{state.service.name}</strong> · {state.professional.firstName} {state.professional.lastName}</p>
            <h2 id="schedule-title">3. Fecha y hora</h2>
            <label className={styles.field}>
              <span>Fecha</span>
              <input type="date" min={localToday()} value={state.date} onChange={(event) => selectDate(event.target.value)} />
            </label>
            {state.date && state.loadingSlots && <p className={styles.message}>Consultando horarios…</p>}
            {state.date && !state.loadingSlots && state.slots.length === 0 && !state.error && (
              <p className={styles.message}>No hay horarios disponibles para esta fecha.</p>
            )}
            <div className={styles.slots}>
              {state.slots.map((slot) => (
                <button
                  key={slot.startTime}
                  type="button"
                  className={state.slot?.startTime === slot.startTime ? styles.slotSelected : styles.slot}
                  onClick={() => selectSlot(slot)}
                >
                  {slot.startTime}
                </button>
              ))}
            </div>
            {state.date && state.error && (
              <button type="button" className={styles.secondary} onClick={() => void refreshCurrentSlots()}>Reintentar disponibilidad</button>
            )}
            <div className={styles.actions}>
              <button type="button" className={styles.primary} disabled={!state.slot} onClick={() => dispatch({ type: 'setStep', step: 'contact' })}>Continuar</button>
            </div>
          </section>
        )}

        {state.step === 'contact' && state.service && state.professional && state.slot && (
          <section aria-labelledby="contact-title">
            <button type="button" className={styles.back} onClick={() => dispatch({ type: 'setStep', step: 'schedule' })}>← Cambiar horario</button>
            <h2 id="contact-title">4. Tus datos</h2>
            <div className={styles.formGrid}>
              <label className={styles.field}><span>Nombre</span><input maxLength={120} autoComplete="given-name" value={state.clientInfo.firstName} onChange={(event) => updateClientInfo('firstName', event.target.value)} /></label>
              <label className={styles.field}><span>Apellido</span><input maxLength={120} autoComplete="family-name" value={state.clientInfo.lastName} onChange={(event) => updateClientInfo('lastName', event.target.value)} /></label>
              <label className={styles.field}><span>Email</span><input type="email" maxLength={320} autoComplete="email" value={state.clientInfo.email} onChange={(event) => updateClientInfo('email', event.target.value)} /></label>
              <label className={styles.field}><span>Teléfono</span><input type="tel" autoComplete="tel" placeholder="+56912345678" value={state.clientInfo.phone} onChange={(event) => updateClientInfo('phone', event.target.value)} /></label>
            </div>
            <label className={styles.field}><span>Notas (opcional)</span><textarea maxLength={500} rows={4} value={state.notes} onChange={(event) => dispatch({ type: 'setNotes', notes: event.target.value })} /></label>
            <div className={styles.actions}><button type="button" className={styles.primary} onClick={goToReview}>Revisar reserva</button></div>
          </section>
        )}

        {state.step === 'review' && state.service && state.professional && state.slot && (
          <section aria-labelledby="review-title">
            <button type="button" className={styles.back} disabled={state.submitting} onClick={() => dispatch({ type: 'setStep', step: 'contact' })}>← Editar datos</button>
            <h2 id="review-title">5. Revisa tu reserva</h2>
            <dl className={styles.summary}>
              <div><dt>Servicio</dt><dd>{state.service.name}</dd></div>
              <div><dt>Profesional</dt><dd>{state.professional.firstName} {state.professional.lastName}</dd></div>
              <div><dt>Fecha</dt><dd>{displayDate(state.date)}</dd></div>
              <div><dt>Hora</dt><dd>{state.slot.startTime}</dd></div>
              <div><dt>Nombre</dt><dd>{state.clientInfo.firstName} {state.clientInfo.lastName}</dd></div>
              <div><dt>Email</dt><dd>{state.clientInfo.email}</dd></div>
              <div><dt>Teléfono</dt><dd>{state.clientInfo.phone}</dd></div>
            </dl>
            <p className={styles.hint}>El horario se valida nuevamente al confirmar. No se realiza ningún cobro en este flujo.</p>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} disabled={state.submitting} onClick={() => void submit()}>
                {state.submitting ? 'Reservando…' : 'Reservar'}
              </button>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
