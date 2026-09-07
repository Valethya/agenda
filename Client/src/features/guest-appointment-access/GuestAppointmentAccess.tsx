import { useEffect, useMemo, useRef, useState } from 'react';
import { createGuestAppointmentAccessApi, GuestAppointmentAccessApiError } from './api.ts';
import {
  bootstrapGuestAppointmentAccess,
  createGuestAccessLifecycleCleanup,
  formatGuestCalendarDate,
  isGuestObjectId,
  RequestIdentityGate,
  RequestKeyGate,
  selectedSlotStillAvailable,
} from './model.ts';
import type {
  GuestAppointmentCancelCapability,
  GuestAppointmentIdentity,
  GuestAppointmentProof,
  GuestAppointmentReadProjection,
  GuestAppointmentRescheduleCapability,
  GuestAppointmentRescheduleProjection,
  GuestCanonicalSlot,
  GuestRescheduleContext,
} from './types.ts';
import styles from './GuestAppointmentAccess.module.scss';

type ViewState =
  | 'identify' | 'requesting' | 'challenge-sent' | 'verifying' | 'loaded'
  | 'confirm-cancel-challenge' | 'requesting-cancel' | 'cancel-challenge-sent' | 'verifying-cancel' | 'cancel-ready' | 'cancelling' | 'cancelled'
  | 'reschedule-select' | 'reschedule-review' | 'requesting-reschedule' | 'reschedule-challenge-sent' | 'verifying-reschedule' | 'rescheduling' | 'rescheduled'
  | 'invalid-proof' | 'capability-expired' | 'recoverable-error';

const EMPTY_IDENTITY: GuestAppointmentIdentity = { businessId: '', appointmentId: '' };
const MUTABLE_STATUSES = new Set(['pending', 'pending_payment', 'confirmed']);
const dateOnly = (value: string) => value.slice(0, 10);

function professionalName(appointment: GuestAppointmentReadProjection): string {
  const professional = appointment.professional;
  return professional ? [professional.firstName, professional.lastName].filter(Boolean).join(' ') || '—' : '—';
}
function contextFromRead(appointment: GuestAppointmentReadProjection): GuestRescheduleContext | null {
  if (!appointment.business || !appointment.service || !appointment.professional) return null;
  return {
    businessId: appointment.business.id,
    appointmentId: appointment.appointmentId,
    business: appointment.business,
    service: { id: appointment.service.id, name: appointment.service.name },
    professional: appointment.professional,
    date: appointment.date,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    status: appointment.status,
  };
}

export default function GuestAppointmentAccess() {
  const api = useMemo(() => createGuestAppointmentAccessApi(), []);
  const [identity, setIdentity] = useState<GuestAppointmentIdentity>(EMPTY_IDENTITY);
  const identityRef = useRef(identity);
  const [view, setView] = useState<ViewState>('identify');
  const [appointment, setAppointment] = useState<GuestAppointmentReadProjection | null>(null);
  const [message, setMessage] = useState('Ingresa los identificadores de tu reserva para solicitar un enlace de acceso.');
  const [rescheduleContext, setRescheduleContext] = useState<GuestRescheduleContext | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [slots, setSlots] = useState<GuestCanonicalSlot[]>([]);
  const [selectedStartTime, setSelectedStartTime] = useState<string | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [rescheduleResult, setRescheduleResult] = useState<GuestAppointmentRescheduleProjection | null>(null);

  const bootstrapped = useRef(false);
  const requestBusy = useRef(false);
  const verifyBusy = useRef(false);
  const consumeBusy = useRef(false);
  const cancelChallengeBusy = useRef(false);
  const cancelVerifyBusy = useRef(false);
  const cancelConsumeBusy = useRef(false);
  const rescheduleChallengeBusy = useRef(false);
  const rescheduleVerifyBusy = useRef(false);
  const rescheduleConsumeBusy = useRef(false);
  const cancelCapability = useRef<GuestAppointmentCancelCapability | null>(null);
  const rescheduleCapability = useRef<GuestAppointmentRescheduleCapability | null>(null);
  const gate = useRef(new RequestIdentityGate());
  const availabilityGate = useRef(new RequestKeyGate());
  const controller = useRef<AbortController | null>(null);
  const availabilityController = useRef<AbortController | null>(null);

  const clearCancelCapability = () => {
    if (cancelCapability.current) cancelCapability.current.bearer = '';
    cancelCapability.current = null;
  };
  const clearRescheduleCapability = () => {
    if (rescheduleCapability.current) rescheduleCapability.current.bearer = '';
    rescheduleCapability.current = null;
  };
  const clearRescheduleSelection = () => {
    availabilityController.current?.abort();
    availabilityGate.current.invalidate();
    setSlots([]);
    setSelectedStartTime(null);
    setSlotsLoading(false);
  };
  const replaceIdentity = (next: GuestAppointmentIdentity) => {
    identityRef.current = next;
    setIdentity(next);
    gate.current.reset(next);
    controller.current?.abort();
    clearCancelCapability();
    clearRescheduleCapability();
    clearRescheduleSelection();
  };

  const setIdentityField = (field: keyof GuestAppointmentIdentity, value: string) => {
    replaceIdentity({ ...identityRef.current, [field]: value.trim() });
    setAppointment(null);
    setRescheduleContext(null);
    setRescheduleResult(null);
    setView('identify');
    setMessage('Solicita un acceso nuevo para esta reserva.');
  };

  const beginIdentityRequest = (current: GuestAppointmentIdentity) => {
    const token = gate.current.begin(current);
    const abortController = new AbortController();
    controller.current?.abort();
    controller.current = abortController;
    return { token, abortController };
  };

  const requestAccess = async () => {
    const current = identityRef.current;
    if (!isGuestObjectId(current.businessId) || !isGuestObjectId(current.appointmentId)) {
      setView('recoverable-error'); setMessage('Revisa los identificadores de negocio y reserva.'); return;
    }
    if (requestBusy.current) return;
    requestBusy.current = true;
    const { token, abortController } = beginIdentityRequest(current);
    setView('requesting'); setMessage('Solicitando acceso…');
    try {
      const result = await api.requestReadChallenge(current, abortController.signal);
      if (!gate.current.isCurrent(token)) return;
      setView('challenge-sent'); setMessage(result.message);
    } catch {
      if (abortController.signal.aborted || !gate.current.isCurrent(token)) return;
      setView('recoverable-error'); setMessage('No pudimos solicitar el acceso ahora. Puedes intentarlo nuevamente.');
    } finally { requestBusy.current = false; }
  };

  const verifyReadAndConsume = async (proof: GuestAppointmentProof) => {
    if (verifyBusy.current) return;
    verifyBusy.current = true;
    const proofIdentity = { businessId: proof.businessId, appointmentId: proof.appointmentId };
    replaceIdentity(proofIdentity);
    const { token, abortController } = beginIdentityRequest(proofIdentity);
    setView('verifying'); setMessage('Verificando el enlace…');
    try {
      const capability = await api.verifyReadChallenge(proof, abortController.signal);
      proof.challengeSecret = '';
      if (!gate.current.isCurrent(token)) { capability.bearer = ''; return; }
      if (Date.parse(capability.expiresAt) <= Date.now()) {
        capability.bearer = ''; setView('capability-expired'); setMessage('La autorización temporal venció. Solicita un acceso nuevo.'); return;
      }
      if (consumeBusy.current) { capability.bearer = ''; return; }
      consumeBusy.current = true;
      try {
        const detail = await api.consumeReadCapability(capability, abortController.signal);
        capability.bearer = '';
        if (!gate.current.isCurrent(token)) return;
        setAppointment(detail); setView('loaded'); setMessage('Acceso verificado.');
      } finally { consumeBusy.current = false; }
    } catch (error) {
      proof.challengeSecret = '';
      if (abortController.signal.aborted || !gate.current.isCurrent(token)) return;
      if (error instanceof GuestAppointmentAccessApiError && error.status === 403) {
        setView('invalid-proof'); setMessage('El enlace es inválido, venció o ya fue utilizado. Solicita un acceso nuevo.');
      } else { setView('recoverable-error'); setMessage('No pudimos completar la verificación. Puedes solicitar un acceso nuevo.'); }
    } finally { verifyBusy.current = false; }
  };

  const verifyCancelProof = async (proof: GuestAppointmentProof) => {
    if (cancelVerifyBusy.current) return;
    cancelVerifyBusy.current = true;
    const proofIdentity = { businessId: proof.businessId, appointmentId: proof.appointmentId };
    replaceIdentity(proofIdentity);
    const { token, abortController } = beginIdentityRequest(proofIdentity);
    setView('verifying-cancel'); setMessage('Verificando la autorización de cancelación…');
    try {
      const capability = await api.verifyCancelChallenge(proof, abortController.signal);
      proof.challengeSecret = '';
      if (!gate.current.isCurrent(token)) { capability.bearer = ''; return; }
      if (Date.parse(capability.expiresAt) <= Date.now()) {
        capability.bearer = ''; setView('capability-expired'); setMessage('La autorización de cancelación venció. Solicita una nueva.'); return;
      }
      cancelCapability.current = capability;
      setView('cancel-ready'); setMessage('Autorización verificada. La reserva aún no se ha cancelado. Confirma para continuar.');
    } catch (error) {
      proof.challengeSecret = '';
      if (abortController.signal.aborted || !gate.current.isCurrent(token)) return;
      setView(error instanceof GuestAppointmentAccessApiError && error.status === 403 ? 'invalid-proof' : 'recoverable-error');
      setMessage('No pudimos verificar la autorización de cancelación.');
    } finally { cancelVerifyBusy.current = false; }
  };

  const verifyRescheduleProof = async (proof: GuestAppointmentProof) => {
    if (rescheduleVerifyBusy.current) return;
    rescheduleVerifyBusy.current = true;
    const proofIdentity = { businessId: proof.businessId, appointmentId: proof.appointmentId };
    replaceIdentity(proofIdentity);
    const { token, abortController } = beginIdentityRequest(proofIdentity);
    setView('verifying-reschedule'); setMessage('Verificando la autorización de reagendado…');
    try {
      const verified = await api.verifyRescheduleChallenge(proof, abortController.signal);
      proof.challengeSecret = '';
      if (!gate.current.isCurrent(token)) { verified.capability.bearer = ''; return; }
      if (Date.parse(verified.capability.expiresAt) <= Date.now()) {
        verified.capability.bearer = ''; setView('capability-expired'); setMessage('La autorización de reagendado venció. Solicita una nueva.'); return;
      }
      rescheduleCapability.current = verified.capability;
      setRescheduleContext(verified.context);
      setRescheduleDate(dateOnly(verified.context.date));
      clearRescheduleSelection();
      setView('reschedule-select');
      setMessage('Autorización verificada. Selecciona el nuevo horario; la reserva todavía no ha cambiado.');
      void loadSlots(verified.context, dateOnly(verified.context.date));
    } catch (error) {
      proof.challengeSecret = '';
      if (abortController.signal.aborted || !gate.current.isCurrent(token)) return;
      setView(error instanceof GuestAppointmentAccessApiError && error.status === 403 ? 'invalid-proof' : 'recoverable-error');
      setMessage('No pudimos verificar la autorización de reagendado.');
    } finally { rescheduleVerifyBusy.current = false; }
  };

  const requestCancelChallenge = async () => {
    if (cancelChallengeBusy.current) return;
    cancelChallengeBusy.current = true;
    const current = identityRef.current;
    const { token, abortController } = beginIdentityRequest(current);
    setView('requesting-cancel'); setMessage('Solicitando autorización de cancelación…');
    try {
      const result = await api.requestCancelChallenge(current, abortController.signal);
      if (!gate.current.isCurrent(token)) return;
      setView('cancel-challenge-sent'); setMessage(result.message);
    } catch {
      if (!abortController.signal.aborted && gate.current.isCurrent(token)) { setView('recoverable-error'); setMessage('No pudimos solicitar la autorización de cancelación.'); }
    } finally { cancelChallengeBusy.current = false; }
  };

  const confirmCancellation = async () => {
    const capability = cancelCapability.current;
    if (!capability || cancelConsumeBusy.current) return;
    cancelConsumeBusy.current = true;
    const current = { businessId: capability.businessId, appointmentId: capability.appointmentId };
    const { token, abortController } = beginIdentityRequest(current);
    setView('cancelling'); setMessage('Cancelando reserva…');
    try {
      const cancelled = await api.consumeCancelCapability(capability, abortController.signal);
      capability.bearer = ''; cancelCapability.current = null;
      if (!gate.current.isCurrent(token)) return;
      setAppointment((value) => value ? { ...value, status: cancelled.status } : value);
      setView('cancelled'); setMessage('Reserva cancelada. El horario ya puede volver a ser ofrecido.');
    } catch (error) {
      if (abortController.signal.aborted || !gate.current.isCurrent(token)) return;
      clearCancelCapability();
      setView(error instanceof GuestAppointmentAccessApiError && error.status === 403 ? 'capability-expired' : 'recoverable-error');
      setMessage(error instanceof GuestAppointmentAccessApiError && error.status === 409
        ? 'La reserva cambió de estado antes de la cancelación. Consulta nuevamente su estado.'
        : 'No pudimos confirmar la cancelación.');
    } finally { cancelConsumeBusy.current = false; }
  };

  async function loadSlots(context: GuestRescheduleContext, date: string) {
    const key = `${context.businessId}:${context.appointmentId}:${date}`;
    const token = availabilityGate.current.begin(key);
    const abortController = new AbortController();
    availabilityController.current?.abort();
    availabilityController.current = abortController;
    setSlotsLoading(true);
    try {
      const nextSlots = await api.getCanonicalSlots(context, date, abortController.signal);
      if (!availabilityGate.current.isCurrent(token) || identityRef.current.appointmentId !== context.appointmentId) return;
      setSlots(nextSlots);
      setSelectedStartTime((current) => selectedSlotStillAvailable(nextSlots, current) ? current : null);
    } catch {
      if (!abortController.signal.aborted && availabilityGate.current.isCurrent(token)) {
        setSlots([]); setSelectedStartTime(null); setMessage('No pudimos cargar los horarios disponibles para esa fecha.');
      }
    } finally {
      if (availabilityGate.current.isCurrent(token)) setSlotsLoading(false);
    }
  }

  const beginReschedule = () => {
    if (!appointment || !MUTABLE_STATUSES.has(appointment.status)) return;
    const context = contextFromRead(appointment);
    if (!context) { setView('recoverable-error'); setMessage('La reserva ya no tiene un contexto reagendable.'); return; }
    clearRescheduleCapability();
    setRescheduleContext(context);
    const initialDate = dateOnly(appointment.date);
    setRescheduleDate(initialDate);
    clearRescheduleSelection();
    setView('reschedule-select');
    setMessage('Elige una nueva fecha y un horario disponible. La selección no reserva el slot.');
    void loadSlots(context, initialDate);
  };

  const changeRescheduleDate = (nextDate: string) => {
    setRescheduleDate(nextDate);
    setSelectedStartTime(null);
    setSlots([]);
    if (rescheduleContext && nextDate) void loadSlots(rescheduleContext, nextDate);
  };

  const requestRescheduleChallenge = async () => {
    if (rescheduleChallengeBusy.current || !rescheduleContext || !selectedStartTime) return;
    rescheduleChallengeBusy.current = true;
    const current = identityRef.current;
    const { token, abortController } = beginIdentityRequest(current);
    setView('requesting-reschedule'); setMessage('Solicitando autorización de reagendado…');
    try {
      const result = await api.requestRescheduleChallenge(current, abortController.signal);
      if (!gate.current.isCurrent(token)) return;
      setView('reschedule-challenge-sent');
      setMessage(`${result.message} La reserva todavía conserva su horario actual.`);
    } catch {
      if (!abortController.signal.aborted && gate.current.isCurrent(token)) { setView('recoverable-error'); setMessage('No pudimos solicitar la autorización de reagendado.'); }
    } finally { rescheduleChallengeBusy.current = false; }
  };

  const confirmReschedule = async () => {
    const capability = rescheduleCapability.current;
    const context = rescheduleContext;
    const selected = selectedStartTime;
    if (!capability || !context || !selected || rescheduleConsumeBusy.current) return;
    rescheduleConsumeBusy.current = true; // synchronous guard: at most one mutative POST
    const current = { businessId: capability.businessId, appointmentId: capability.appointmentId };
    const { token, abortController } = beginIdentityRequest(current);
    setView('rescheduling'); setMessage('Confirmando nuevo horario…');
    try {
      const result = await api.consumeRescheduleCapability(capability, { date: rescheduleDate, startTime: selected }, abortController.signal);
      capability.bearer = ''; rescheduleCapability.current = null;
      if (!gate.current.isCurrent(token)) return;
      setRescheduleResult(result);
      setAppointment((value) => value ? { ...value, date: result.date, startTime: result.startTime, endTime: result.endTime, status: result.status } : value);
      setRescheduleContext((value) => value ? { ...value, date: result.date, startTime: result.startTime, endTime: result.endTime, status: result.status } : value);
      setView('rescheduled'); setMessage('Reserva reagendada correctamente.');
    } catch (error) {
      if (abortController.signal.aborted || !gate.current.isCurrent(token)) return;
      if (error instanceof GuestAppointmentAccessApiError && error.status === 409) {
        // Backend transaction rolled capability consumption back. Preserve it for a safe retry.
        setSelectedStartTime(null);
        setView('reschedule-select');
        setMessage('Ese horario dejó de estar disponible o la reserva cambió. Actualizamos los horarios; el horario anterior no se canceló.');
        void loadSlots(context, rescheduleDate);
      } else {
        clearRescheduleCapability();
        setView(error instanceof GuestAppointmentAccessApiError && error.status === 403 ? 'capability-expired' : 'recoverable-error');
        setMessage('No pudimos confirmar el reagendado. Consulta la reserva antes de reintentar.');
      }
    } finally { rescheduleConsumeBusy.current = false; }
  };

  useEffect(() => {
    const cleanupBase = createGuestAccessLifecycleCleanup(controller, gate.current, availabilityController, availabilityGate.current);
    const cleanup = () => { clearCancelCapability(); clearRescheduleCapability(); cleanupBase(); };
    if (bootstrapped.current) return cleanup;
    bootstrapped.current = true;
    return bootstrapGuestAppointmentAccess({
      fragment: window.location.hash,
      search: window.location.search,
      clearSensitiveFragment: () => window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`),
      onProof: (proof) => {
        if (proof.purpose === 'appointment-cancel-bootstrap') void verifyCancelProof(proof);
        else if (proof.purpose === 'appointment-reschedule-bootstrap') void verifyRescheduleProof(proof);
        else void verifyReadAndConsume(proof);
      },
      onIdentity: replaceIdentity,
      onInvalidProof: () => { setView('invalid-proof'); setMessage('El enlace es inválido, venció o ya fue utilizado. Solicita un acceso nuevo.'); },
      cleanup,
    });
  }, []);

  const canRequest = isGuestObjectId(identity.businessId) && isGuestObjectId(identity.appointmentId);
  const canMutate = Boolean(appointment && MUTABLE_STATUSES.has(appointment.status));
  const selectedSlot = slots.find((slot) => slot.startTime === selectedStartTime && slot.available !== false) || null;
  const showForm = ['identify', 'requesting', 'challenge-sent', 'invalid-proof', 'capability-expired', 'recoverable-error'].includes(view);
  const showAppointment = Boolean(appointment) && ['loaded', 'confirm-cancel-challenge', 'requesting-cancel', 'cancel-challenge-sent', 'cancelled', 'reschedule-select', 'reschedule-review', 'requesting-reschedule', 'reschedule-challenge-sent', 'rescheduled'].includes(view);

  const resetAccess = () => {
    clearCancelCapability(); clearRescheduleCapability(); clearRescheduleSelection();
    setAppointment(null); setRescheduleContext(null); setRescheduleResult(null);
    setView('identify'); setMessage('Solicita un acceso nuevo para esta reserva.');
  };

  return (
    <main className={styles.shell} aria-live="polite">
      <section className={styles.card}>
        <p className={styles.eyebrow}>Agenda</p>
        <h1>Gestionar / Ver reserva</h1>
        <p className={styles.status}>{message}</p>

        {showForm && (
          <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void requestAccess(); }}>
            <label><span>Negocio</span><input value={identity.businessId} onChange={(event) => setIdentityField('businessId', event.target.value)} autoComplete="off" aria-label="Identificador del negocio" /></label>
            <label><span>Reserva</span><input value={identity.appointmentId} onChange={(event) => setIdentityField('appointmentId', event.target.value)} autoComplete="off" aria-label="Identificador de la reserva" /></label>
            <button type="submit" disabled={!canRequest || view === 'requesting'}>{view === 'requesting' ? 'Solicitando…' : 'Solicitar acceso por correo'}</button>
          </form>
        )}

        {showAppointment && appointment && (
          <dl className={styles.appointment}>
            <div><dt>Reserva</dt><dd>{appointment.appointmentId}</dd></div>
            <div><dt>Negocio</dt><dd>{appointment.business?.name || '—'}</dd></div>
            <div><dt>Servicio</dt><dd>{appointment.service?.name || '—'}</dd></div>
            <div><dt>Profesional</dt><dd>{professionalName(appointment)}</dd></div>
            <div><dt>Fecha</dt><dd>{formatGuestCalendarDate(appointment.date)}</dd></div>
            <div><dt>Hora</dt><dd>{appointment.startTime}–{appointment.endTime}</dd></div>
            <div><dt>Estado</dt><dd>{appointment.status}</dd></div>
            <div><dt>Pago</dt><dd>{appointment.paymentStatus}</dd></div>
          </dl>
        )}

        {view === 'loaded' && canMutate && (
          <div className={styles.actions}>
            <button type="button" onClick={beginReschedule}>Reagendar</button>
            <button type="button" className={styles.danger} onClick={() => { setView('confirm-cancel-challenge'); setMessage('¿Confirmas que quieres iniciar la cancelación? Se requiere una autorización CANCEL separada.'); }}>Cancelar reserva</button>
          </div>
        )}

        {view === 'confirm-cancel-challenge' && (
          <div className={styles.actions}>
            <button type="button" className={styles.danger} onClick={() => { void requestCancelChallenge(); }}>Confirmar y enviar autorización</button>
            <button type="button" className={styles.secondary} onClick={() => { setView('loaded'); setMessage('Acceso verificado.'); }}>Volver</button>
          </div>
        )}
        {view === 'cancel-ready' && (
          <div className={styles.confirmation}><p>Reserva: <strong>{identity.appointmentId}</strong></p><p>La reserva todavía no está cancelada.</p><button type="button" className={styles.danger} onClick={() => { void confirmCancellation(); }}>Confirmar cancelación</button></div>
        )}
        {view === 'cancelling' && <button type="button" className={styles.danger} disabled>Cancelando…</button>}

        {(view === 'reschedule-select' || view === 'reschedule-review') && rescheduleContext && (
          <div className={styles.confirmation}>
            <h2>Reagendar</h2>
            <p><strong>Horario actual</strong><br />{formatGuestCalendarDate(rescheduleContext.date)} · {rescheduleContext.startTime}–{rescheduleContext.endTime}</p>
            {view === 'reschedule-select' && (
              <>
                <label className={styles.dateField}><span>Nueva fecha</span><input type="date" value={rescheduleDate} onChange={(event) => changeRescheduleDate(event.target.value)} /></label>
                <div className={styles.slotGrid} aria-label="Horarios disponibles">
                  {slotsLoading && <p>Cargando horarios…</p>}
                  {!slotsLoading && slots.filter((slot) => slot.available !== false).map((slot) => (
                    <button key={slot.startTime} type="button" className={selectedStartTime === slot.startTime ? styles.selected : styles.secondary} onClick={() => setSelectedStartTime(slot.startTime)}>
                      {slot.startTime}–{slot.endTime}
                    </button>
                  ))}
                </div>
                <button type="button" disabled={!selectedSlot} onClick={() => { setView('reschedule-review'); setMessage('Revisa el cambio. Todavía no se ha modificado la reserva.'); }}>Revisar cambio</button>
              </>
            )}
            {view === 'reschedule-review' && selectedSlot && (
              <div className={styles.review}>
                <p><strong>Nuevo horario</strong><br />{formatGuestCalendarDate(rescheduleDate)} · {selectedSlot.startTime}–{selectedSlot.endTime}</p>
                {rescheduleCapability.current ? (
                  <button type="button" onClick={() => { void confirmReschedule(); }}>Confirmar reagendado</button>
                ) : (
                  <button type="button" onClick={() => { void requestRescheduleChallenge(); }}>Confirmar cambio y enviar autorización</button>
                )}
                <button type="button" className={styles.secondary} onClick={() => setView('reschedule-select')}>Cambiar horario</button>
              </div>
            )}
          </div>
        )}
        {view === 'rescheduling' && <button type="button" disabled>Confirmando reagendado…</button>}
        {view === 'rescheduled' && rescheduleResult && (
          <div className={styles.confirmation}>
            <p><strong>Nuevo horario confirmado</strong></p>
            <p>{formatGuestCalendarDate(rescheduleResult.date)} · {rescheduleResult.startTime}–{rescheduleResult.endTime}</p>
            <p>Servicio y profesional se mantienen sin cambios.</p>
          </div>
        )}

        {(view === 'loaded' || view === 'cancel-challenge-sent' || view === 'cancelled' || view === 'reschedule-challenge-sent' || view === 'rescheduled' || view === 'invalid-proof' || view === 'capability-expired' || view === 'recoverable-error') && (
          <button type="button" className={styles.secondary} onClick={resetAccess}>Solicitar acceso nuevamente</button>
        )}

        <p className={styles.boundary}>READ, CANCEL y RESCHEDULE son autorizaciones separadas y exact-scope. Reagendar conserva negocio, servicio y profesional; sólo cambia fecha y hora tras confirmación explícita.</p>
      </section>
    </main>
  );
}
