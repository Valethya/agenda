import { useEffect, useMemo, useRef, useState } from 'react';
import { createGuestAppointmentAccessApi, GuestAppointmentAccessApiError } from './api.ts';
import {
  isGuestObjectId,
  parseGuestAppointmentIdentity,
  parseGuestAppointmentProof,
  RequestIdentityGate,
} from './model.ts';
import type {
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
  | 'invalid-proof'
  | 'capability-expired'
  | 'recoverable-error';

const EMPTY_IDENTITY: GuestAppointmentIdentity = { businessId: '', appointmentId: '' };

function formatDate(value: string): string {
  try {
    return new Intl.DateTimeFormat('es-CL', { dateStyle: 'long' }).format(new Date(value));
  } catch {
    return value;
  }
}

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
  const gate = useRef(new RequestIdentityGate());
  const controller = useRef<AbortController | null>(null);

  const replaceIdentity = (next: GuestAppointmentIdentity) => {
    identityRef.current = next;
    setIdentity(next);
    gate.current.reset(next);
    controller.current?.abort();
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
    } catch (error) {
      if (abortController.signal.aborted || !gate.current.isCurrent(token)) return;
      setView('recoverable-error');
      setMessage('No pudimos solicitar el acceso ahora. Puedes intentarlo nuevamente.');
    } finally {
      requestBusy.current = false;
    }
  };

  const verifyAndConsume = async (proof: GuestAppointmentProof) => {
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

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    const fragment = window.location.hash;
    const proof = parseGuestAppointmentProof(fragment);
    const queryIdentity = parseGuestAppointmentIdentity(window.location.search);

    // El fragment contiene el bearer del challenge. Se elimina de la barra de
    // direcciones antes de cualquier llamada de red; nunca se guarda en storage.
    if (fragment) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }

    if (proof) {
      void verifyAndConsume(proof);
      return;
    }
    if (queryIdentity) replaceIdentity(queryIdentity);
    if (fragment && !proof) {
      setView('invalid-proof');
      setMessage('El enlace es inválido, venció o ya fue utilizado. Solicita un acceso nuevo.');
    }

    return () => controller.current?.abort();
  }, []);

  const canRequest = isGuestObjectId(identity.businessId) && isGuestObjectId(identity.appointmentId);
  const showForm = view !== 'verifying' && view !== 'loaded';

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

        {view === 'loaded' && appointment && (
          <dl className={styles.appointment}>
            <div><dt>Reserva</dt><dd>{appointment.appointmentId}</dd></div>
            <div><dt>Negocio</dt><dd>{appointment.business?.name || '—'}</dd></div>
            <div><dt>Servicio</dt><dd>{appointment.service?.name || '—'}</dd></div>
            <div><dt>Profesional</dt><dd>{professionalName(appointment)}</dd></div>
            <div><dt>Fecha</dt><dd>{formatDate(appointment.date)}</dd></div>
            <div><dt>Hora</dt><dd>{appointment.startTime}–{appointment.endTime}</dd></div>
            <div><dt>Estado</dt><dd>{appointment.status}</dd></div>
            <div><dt>Pago</dt><dd>{appointment.paymentStatus}</dd></div>
          </dl>
        )}

        {(view === 'loaded' || view === 'invalid-proof' || view === 'capability-expired' || view === 'recoverable-error') && (
          <button
            type="button"
            className={styles.secondary}
            onClick={() => {
              setAppointment(null);
              setView('identify');
              setMessage('Solicita un acceso nuevo para esta reserva.');
            }}
          >
            Solicitar acceso nuevamente
          </button>
        )}

        <p className={styles.boundary}>
          Este acceso autoriza únicamente la lectura de esta reserva. No crea una cuenta y no habilita cancelación ni reagendado.
        </p>
      </section>
    </main>
  );
}
