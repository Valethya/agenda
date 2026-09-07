import { useEffect, useMemo, useRef, useState } from 'react';
import { createGuestAppointmentAccessApi, GuestAppointmentAccessApiError } from './api.ts';
import {
  bootstrapGuestAppointmentAccess,
  createGuestAccessLifecycleCleanup,
  formatGuestCalendarDate,
  isGuestObjectId,
  RequestIdentityGate,
} from './model.ts';
import type {
  GuestAppointmentCancelCapability,
  GuestAppointmentIdentity,
  GuestAppointmentProof,
  GuestAppointmentReadProjection,
} from './types.ts';
import styles from './GuestAppointmentAccess.module.scss';

type ViewState =
  | 'identify'
  | 'requesting'
  | 'challenge-sent'
  | 'verifying'
  | 'loaded'
  | 'confirm-cancel-challenge'
  | 'requesting-cancel'
  | 'cancel-challenge-sent'
  | 'verifying-cancel'
  | 'cancel-ready'
  | 'cancelling'
  | 'cancelled'
  | 'invalid-proof'
  | 'capability-expired'
  | 'recoverable-error';

const EMPTY_IDENTITY: GuestAppointmentIdentity = { businessId: '', appointmentId: '' };
const CANCELABLE_STATUSES = new Set(['pending', 'pending_payment', 'confirmed']);

function professionalName(appointment: GuestAppointmentReadProjection): string {
  const professional = appointment.professional;
  if (!professional) return '—';
  return [professional.firstName, professional.lastName].filter(Boolean).join(' ') || '—';
}

export default function GuestAppointmentAccess() {
  const api = useMemo(() => createGuestAppointmentAccessApi(), []);
  const [identity, setIdentity] = useState<GuestAppointmentIdentity>(EMPTY_IDENTITY);
  const identityRef = useRef(identity);
  const [view, setView] = useState<ViewState>('identify');
  const [appointment, setAppointment] = useState<GuestAppointmentReadProjection | null>(null);
  const [message, setMessage] = useState('Ingresa los identificadores de tu reserva para solicitar un enlace de acceso.');
  const bootstrapped = useRef(false);
  const requestBusy = useRef(false);
  const verifyBusy = useRef(false);
  const consumeBusy = useRef(false);
  const cancelChallengeBusy = useRef(false);
  const cancelVerifyBusy = useRef(false);
  const cancelConsumeBusy = useRef(false);
  const cancelCapability = useRef<GuestAppointmentCancelCapability | null>(null);
  const gate = useRef(new RequestIdentityGate());
  const controller = useRef<AbortController | null>(null);

  const clearCancelCapability = () => {
    if (cancelCapability.current) cancelCapability.current.bearer = '';
    cancelCapability.current = null;
  };

  const replaceIdentity = (next: GuestAppointmentIdentity) => {
    identityRef.current = next;
    setIdentity(next);
    gate.current.reset(next);
    controller.current?.abort();
    clearCancelCapability();
  };

  const setIdentityField = (field: keyof GuestAppointmentIdentity, value: string) => {
    replaceIdentity({ ...identityRef.current, [field]: value.trim() });
    setAppointment(null);
    setView('identify');
    setMessage('Solicita un acceso nuevo para esta reserva.');
  };

  const requestAccess = async () => {
    const current = identityRef.current;
    if (!isGuestObjectId(current.businessId) || !isGuestObjectId(current.appointmentId)) {
      setView('recoverable-error');
      setMessage('Revisa los identificadores de negocio y reserva.');
      return;
    }
    if (requestBusy.current) return;
    requestBusy.current = true;
    const token = gate.current.begin(current);
    const abortController = new AbortController();
    controller.current?.abort();
    controller.current = abortController;
    setView('requesting');
    setMessage('Solicitando acceso…');
    try {
      const result = await api.requestReadChallenge(current, abortController.signal);
      if (!gate.current.isCurrent(token)) return;
      setView('challenge-sent');
      setMessage(result.message || 'Si la reserva puede verificarse, recibirás un correo para continuar.');
    } catch {
      if (abortController.signal.aborted || !gate.current.isCurrent(token)) return;
      setView('recoverable-error');
      setMessage('No pudimos solicitar el acceso ahora. Puedes intentarlo nuevamente.');
    } finally {
      requestBusy.current = false;
    }
  };

  const verifyReadAndConsume = async (proof: GuestAppointmentProof) => {
    if (verifyBusy.current) return;
    verifyBusy.current = true;
    const proofIdentity = { businessId: proof.businessId, appointmentId: proof.appointmentId };
    replaceIdentity(proofIdentity);
    const token = gate.current.begin(proofIdentity);
    const abortController = new AbortController();
    controller.current = abortController;
    setView('verifying');
    setMessage('Verificando el enlace…');

    try {
      const capability = await api.verifyReadChallenge(proof, abortController.signal);
      proof.challengeSecret = '';
      if (!gate.current.isCurrent(token)) return;
      if (Date.parse(capability.expiresAt) <= Date.now()) {
        capability.bearer = '';
        setView('capability-expired');
        setMessage('La autorización temporal venció. Solicita un acceso nuevo.');
        return;
      }
      if (consumeBusy.current) return;
      consumeBusy.current = true;
      try {
        const detail = await api.consumeReadCapability(capability, abortController.signal);
        capability.bearer = '';
        if (!gate.current.isCurrent(token)) return;
        setAppointment(detail);
        setView('loaded');
        setMessage('Acceso verificado.');
      } finally {
        consumeBusy.current = false;
      }
    } catch (error) {
      if (abortController.signal.aborted || !gate.current.isCurrent(token)) return;
      if (error instanceof GuestAppointmentAccessApiError && error.status === 403) {
        setView('invalid-proof');
        setMessage('El enlace es inválido, venció o ya fue utilizado. Solicita un acceso nuevo.');
      } else {
        setView('recoverable-error');
        setMessage('No pudimos completar la verificación. Puedes solicitar un acceso nuevo.');
      }
    } finally {
      verifyBusy.current = false;
    }
  };

  const verifyCancelProof = async (proof: GuestAppointmentProof) => {
    if (cancelVerifyBusy.current) return;
    cancelVerifyBusy.current = true;
    const proofIdentity = { businessId: proof.businessId, appointmentId: proof.appointmentId };
    replaceIdentity(proofIdentity);
    const token = gate.current.begin(proofIdentity);
    const abortController = new AbortController();
    controller.current = abortController;
    setView('verifying-cancel');
    setMessage('Verificando la autorización de cancelación…');

    try {
      const capability = await api.verifyCancelChallenge(proof, abortController.signal);
      proof.challengeSecret = '';
      if (!gate.current.isCurrent(token)) {
        capability.bearer = '';
        return;
      }
      if (Date.parse(capability.expiresAt) <= Date.now()) {
        capability.bearer = '';
        setView('capability-expired');
        setMessage('La autorización de cancelación venció. Solicita una nueva.');
        return;
      }
      cancelCapability.current = capability;
      setView('cancel-ready');
      setMessage('Autorización verificada. La reserva aún no se ha cancelado. Confirma para continuar.');
    } catch (error) {
      proof.challengeSecret = '';
      if (abortController.signal.aborted || !gate.current.isCurrent(token)) return;
      if (error instanceof GuestAppointmentAccessApiError && error.status === 403) {
        setView('invalid-proof');
        setMessage('El enlace de cancelación es inválido, venció o ya fue utilizado.');
      } else {
        setView('recoverable-error');
        setMessage('No pudimos verificar la autorización de cancelación.');
      }
    } finally {
      cancelVerifyBusy.current = false;
    }
  };

  const requestCancelChallenge = async () => {
    const current = identityRef.current;
    if (cancelChallengeBusy.current) return;
    cancelChallengeBusy.current = true;
    const token = gate.current.begin(current);
    const abortController = new AbortController();
    controller.current?.abort();
    controller.current = abortController;
    setView('requesting-cancel');
    setMessage('Solicitando autorización de cancelación…');
    try {
      const result = await api.requestCancelChallenge(current, abortController.signal);
      if (!gate.current.isCurrent(token)) return;
      setView('cancel-challenge-sent');
      setMessage(result.message || 'Si la reserva puede verificarse, recibirás un correo para autorizar la cancelación.');
    } catch {
      if (abortController.signal.aborted || !gate.current.isCurrent(token)) return;
      setView('recoverable-error');
      setMessage('No pudimos solicitar la autorización de cancelación. Puedes intentarlo nuevamente.');
    } finally {
      cancelChallengeBusy.current = false;
    }
  };

  const confirmCancellation = async () => {
    const capability = cancelCapability.current;
    if (!capability || cancelConsumeBusy.current) return;
    cancelConsumeBusy.current = true;
    const current = { businessId: capability.businessId, appointmentId: capability.appointmentId };
    const token = gate.current.begin(current);
    const abortController = new AbortController();
    controller.current?.abort();
    controller.current = abortController;
    setView('cancelling');
    setMessage('Cancelando reserva…');

    try {
      const cancelled = await api.consumeCancelCapability(capability, abortController.signal);
      capability.bearer = '';
      cancelCapability.current = null;
      if (!gate.current.isCurrent(token)) return;
      setAppointment((currentAppointment) => currentAppointment
        ? { ...currentAppointment, status: cancelled.status }
        : currentAppointment);
      setView('cancelled');
      setMessage('Reserva cancelada. El horario ya puede volver a ser ofrecido por la disponibilidad del negocio.');
    } catch (error) {
      if (abortController.signal.aborted || !gate.current.isCurrent(token)) return;
      clearCancelCapability();
      if (error instanceof GuestAppointmentAccessApiError && error.status === 409) {
        setView('recoverable-error');
        setMessage('La reserva cambió de estado antes de la cancelación. Consulta nuevamente su estado.');
      } else if (error instanceof GuestAppointmentAccessApiError && error.status === 403) {
        setView('capability-expired');
        setMessage('La autorización de cancelación venció o ya fue utilizada.');
      } else {
        setView('recoverable-error');
        setMessage('No pudimos confirmar la cancelación. Consulta nuevamente la reserva antes de reintentar.');
      }
    } finally {
      cancelConsumeBusy.current = false;
    }
  };

  useEffect(() => {
    const cleanupBase = createGuestAccessLifecycleCleanup(controller, gate.current);
    const cleanup = () => {
      clearCancelCapability();
      cleanupBase();
    };
    if (bootstrapped.current) return cleanup;
    bootstrapped.current = true;

    return bootstrapGuestAppointmentAccess({
      fragment: window.location.hash,
      search: window.location.search,
      clearSensitiveFragment: () => {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      },
      onProof: (proof) => {
        if (proof.purpose === 'appointment-cancel-bootstrap') void verifyCancelProof(proof);
        else void verifyReadAndConsume(proof);
      },
      onIdentity: replaceIdentity,
      onInvalidProof: () => {
        setView('invalid-proof');
        setMessage('El enlace es inválido, venció o ya fue utilizado. Solicita un acceso nuevo.');
      },
      cleanup,
    });
  }, []);

  const canRequest = isGuestObjectId(identity.businessId) && isGuestObjectId(identity.appointmentId);
  const canCancel = Boolean(appointment && CANCELABLE_STATUSES.has(appointment.status));
  const showForm = ![
    'verifying',
    'loaded',
    'confirm-cancel-challenge',
    'requesting-cancel',
    'cancel-challenge-sent',
    'verifying-cancel',
    'cancel-ready',
    'cancelling',
    'cancelled',
  ].includes(view);
  const showAppointment = Boolean(appointment) && [
    'loaded',
    'confirm-cancel-challenge',
    'requesting-cancel',
    'cancel-challenge-sent',
    'cancelled',
  ].includes(view);

  const resetAccess = () => {
    clearCancelCapability();
    setAppointment(null);
    setView('identify');
    setMessage('Solicita un acceso nuevo para esta reserva.');
  };

  return (
    <main className={styles.shell} aria-live="polite">
      <section className={styles.card}>
        <p className={styles.eyebrow}>Agenda</p>
        <h1>Gestionar / Ver reserva</h1>
        <p className={styles.status}>{message}</p>

        {showForm && (
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              void requestAccess();
            }}
          >
            <label>
              <span>Negocio</span>
              <input
                value={identity.businessId}
                onChange={(event) => setIdentityField('businessId', event.target.value)}
                autoComplete="off"
                inputMode="text"
                aria-label="Identificador del negocio"
              />
            </label>
            <label>
              <span>Reserva</span>
              <input
                value={identity.appointmentId}
                onChange={(event) => setIdentityField('appointmentId', event.target.value)}
                autoComplete="off"
                inputMode="text"
                aria-label="Identificador de la reserva"
              />
            </label>
            <button type="submit" disabled={!canRequest || view === 'requesting'}>
              {view === 'requesting' ? 'Solicitando…' : 'Solicitar acceso por correo'}
            </button>
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

        {view === 'loaded' && canCancel && (
          <button
            type="button"
            className={styles.danger}
            onClick={() => {
              setView('confirm-cancel-challenge');
              setMessage('¿Confirmas que quieres iniciar la cancelación? Te enviaremos un correo de autorización antes de realizar cualquier cambio.');
            }}
          >
            Cancelar reserva
          </button>
        )}

        {view === 'confirm-cancel-challenge' && (
          <div className={styles.actions}>
            <button type="button" className={styles.danger} onClick={() => { void requestCancelChallenge(); }}>
              Confirmar y enviar autorización
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                setView('loaded');
                setMessage('Acceso verificado.');
              }}
            >
              Volver
            </button>
          </div>
        )}

        {view === 'cancel-ready' && (
          <div className={styles.confirmation}>
            <p>Reserva: <strong>{identity.appointmentId}</strong></p>
            <p>Esta acción cambiará el estado de la reserva a cancelada.</p>
            <button type="button" className={styles.danger} onClick={() => { void confirmCancellation(); }}>
              Confirmar cancelación
            </button>
          </div>
        )}

        {view === 'cancelling' && (
          <button type="button" className={styles.danger} disabled>
            Cancelando…
          </button>
        )}

        {(view === 'loaded'
          || view === 'cancel-challenge-sent'
          || view === 'cancelled'
          || view === 'invalid-proof'
          || view === 'capability-expired'
          || view === 'recoverable-error') && (
          <button type="button" className={styles.secondary} onClick={resetAccess}>
            Solicitar acceso nuevamente
          </button>
        )}

        <p className={styles.boundary}>
          READ sólo permite consultar esta reserva. La cancelación exige una autorización CANCEL separada y una confirmación explícita; el reagendado continúa deshabilitado.
        </p>
      </section>
    </main>
  );
}
