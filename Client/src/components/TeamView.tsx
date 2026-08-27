import React from 'react';
import styles from './TeamView.module.scss';
import { useCalendarNavigation } from '../context/CalendarNavigationContext';
import { useSession } from '../context/SessionContext';
import { buildAdminViewUrl } from '../context/sessionPolicy';
import { getTeam, isApiError, updateTeamMembership } from '../services/api';
import type { TeamMembership, TeamMembershipPatch, TeamMembershipRole } from '../types';
import {
  TEAM_ROLE_LABELS,
  TeamSyncCoordinator,
  bookabilityPatch,
  canChangeBookability,
  canChangeTeamRole,
  canDeactivateMembership,
  deactivatePatch,
  didCallerLoseTeamAdminAuthority,
  getTeamMemberName,
  getTeamMutationErrorMessage,
  isTeamAuthorityError,
  replaceCanonicalMembership,
  rolePatch,
  shouldRefetchTeamAfterMutationError
} from '../features/team/teamRules';

type Feedback = {
  tone: 'success' | 'error';
  message: string;
};

type NormalizedTeamError = {
  status?: number;
  message?: string;
};

const LOAD_ERROR_MESSAGE = 'No pudimos cargar el equipo. Revisa tu conexión o acceso e intenta nuevamente.';
const REFRESH_ERROR_MESSAGE = 'No pudimos reconciliar Equipo con el servidor. Actualiza la lista antes de intentar otra modificación.';
const AUTHORITY_LOST_MESSAGE = 'Tu acceso administrativo a Equipo ya no está vigente. La sesión se volverá a validar.';

function normalizeTeamError(error: unknown): NormalizedTeamError {
  return isApiError(error)
    ? { status: error.status, message: error.message }
    : { message: error instanceof Error ? error.message : undefined };
}

export const TeamView: React.FC = () => {
  const { setViewType } = useCalendarNavigation();
  const { currentUser, refreshSession } = useSession();
  const [team, setTeam] = React.useState<TeamMembership[]>([]);
  const [loadState, setLoadState] = React.useState<'loading' | 'loaded' | 'error'>('loading');
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [feedbackByMembership, setFeedbackByMembership] = React.useState<Record<string, Feedback>>({});
  const [confirmingMembershipId, setConfirmingMembershipId] = React.useState<string | null>(null);
  const [pendingMembershipIds, setPendingMembershipIds] = React.useState<Set<string>>(new Set());
  const [isReconciling, setIsReconciling] = React.useState(false);
  const [authorityLost, setAuthorityLost] = React.useState(false);
  const pendingRef = React.useRef<Set<string>>(new Set());
  const authorityLostRef = React.useRef(false);
  const syncRef = React.useRef(new TeamSyncCoordinator());
  const reconciliationPromiseRef = React.useRef<Promise<boolean> | null>(null);

  const abandonTeamSurface = React.useCallback((message = AUTHORITY_LOST_MESSAGE) => {
    if (authorityLostRef.current) return;

    authorityLostRef.current = true;
    syncRef.current.invalidateReads();
    setAuthorityLost(true);
    setTeam([]);
    setConfirmingMembershipId(null);
    setLoadError(message);
    setFeedbackByMembership({});

    setViewType('semana');
    window.history.replaceState(
      null,
      '',
      buildAdminViewUrl(window.location.search, 'semana')
    );
    void refreshSession();
  }, [refreshSession, setViewType]);

  const loadCanonicalTeam = React.useCallback(async (preserveCurrentState = false) => {
    if (!preserveCurrentState) {
      setLoadState('loading');
    }
    setLoadError(null);

    const readTicket = syncRef.current.beginRead();

    try {
      const canonicalTeam = await getTeam();
      if (!syncRef.current.canApplyRead(readTicket) || authorityLostRef.current) {
        return true;
      }

      setTeam(canonicalTeam);
      setLoadState('loaded');
      return true;
    } catch (error) {
      const normalizedError = normalizeTeamError(error);
      if (isTeamAuthorityError(normalizedError)) {
        abandonTeamSurface();
        return false;
      }

      if (preserveCurrentState) {
        setLoadError(REFRESH_ERROR_MESSAGE);
      } else {
        setLoadState('error');
        setLoadError(LOAD_ERROR_MESSAGE);
      }
      return false;
    }
  }, [abandonTeamSurface]);

  const reconcileCanonicalTeam = React.useCallback((): Promise<boolean> => {
    if (reconciliationPromiseRef.current) {
      return reconciliationPromiseRef.current;
    }

    syncRef.current.beginReconciliation();
    setIsReconciling(true);

    const run = async (): Promise<boolean> => {
      try {
        await syncRef.current.waitForMutationsToDrain();
        if (authorityLostRef.current) return false;

        const readTicket = syncRef.current.beginRead();
        const canonicalTeam = await getTeam();
        if (!syncRef.current.canApplyRead(readTicket) || authorityLostRef.current) {
          return true;
        }

        setTeam(canonicalTeam);
        setLoadState('loaded');
        setLoadError(null);
        return true;
      } catch (error) {
        const normalizedError = normalizeTeamError(error);
        if (isTeamAuthorityError(normalizedError)) {
          abandonTeamSurface();
          return false;
        }

        setLoadError(REFRESH_ERROR_MESSAGE);
        return false;
      } finally {
        syncRef.current.endReconciliation();
        setIsReconciling(false);
      }
    };

    const task = run();
    reconciliationPromiseRef.current = task;
    void task.then(
      () => {
        if (reconciliationPromiseRef.current === task) reconciliationPromiseRef.current = null;
      },
      () => {
        if (reconciliationPromiseRef.current === task) reconciliationPromiseRef.current = null;
      }
    );
    return task;
  }, [abandonTeamSurface]);

  React.useEffect(() => {
    void loadCanonicalTeam();
  }, [loadCanonicalTeam]);

  const setMembershipPending = (membershipId: string, isPending: boolean) => {
    if (isPending) {
      pendingRef.current.add(membershipId);
    } else {
      pendingRef.current.delete(membershipId);
    }
    setPendingMembershipIds(new Set(pendingRef.current));
  };

  const setFeedback = (membershipId: string, feedback?: Feedback) => {
    setFeedbackByMembership((current) => {
      const next = { ...current };
      if (feedback) next[membershipId] = feedback;
      else delete next[membershipId];
      return next;
    });
  };

  const mutateMembership = async (
    membership: TeamMembership,
    patch: TeamMembershipPatch
  ) => {
    const { membershipId } = membership;
    if (
      authorityLostRef.current
      || pendingRef.current.has(membershipId)
      || !syncRef.current.beginMutation()
    ) return;

    setMembershipPending(membershipId, true);
    setFeedback(membershipId);

    let canonicalAccepted = false;
    let needsReconciliation = false;

    try {
      const canonicalMembership = await updateTeamMembership(membershipId, patch);
      canonicalAccepted = true;
      setTeam((current) => replaceCanonicalMembership(current, canonicalMembership));
      setConfirmingMembershipId((current) => current === membershipId ? null : current);

      if (didCallerLoseTeamAdminAuthority(canonicalMembership, currentUser)) {
        abandonTeamSurface();
      } else {
        setFeedback(membershipId, { tone: 'success', message: 'Cambios guardados.' });
      }
    } catch (error) {
      const normalizedError = normalizeTeamError(error);

      if (isTeamAuthorityError(normalizedError)) {
        abandonTeamSurface();
      } else {
        setFeedback(membershipId, {
          tone: 'error',
          message: getTeamMutationErrorMessage(normalizedError)
        });
        needsReconciliation = shouldRefetchTeamAfterMutationError(normalizedError);
      }
    } finally {
      syncRef.current.finishMutation(canonicalAccepted);
      setMembershipPending(membershipId, false);
    }

    if (needsReconciliation && !authorityLostRef.current) {
      await reconcileCanonicalTeam();
    }
  };

  const handleRoleChange = (membership: TeamMembership, role: TeamMembershipRole) => {
    if (role === membership.role) return;
    void mutateMembership(membership, rolePatch(role));
  };

  const handleBookabilityChange = (membership: TeamMembership, isBookable: boolean) => {
    if (isBookable === membership.isBookable) return;
    void mutateMembership(membership, bookabilityPatch(isBookable));
  };

  if (authorityLost) {
    return (
      <section className={styles.statePanel} role="alert">
        <h2>Acceso administrativo actualizado</h2>
        <p>{loadError || AUTHORITY_LOST_MESSAGE}</p>
      </section>
    );
  }

  if (loadState === 'loading') {
    return (
      <section className={styles.statePanel} aria-live="polite" aria-busy="true">
        <div className={styles.spinner} aria-hidden="true" />
        <p>Cargando equipo...</p>
      </section>
    );
  }

  if (loadState === 'error') {
    return (
      <section className={styles.statePanel} role="alert">
        <h2>No pudimos cargar Equipo</h2>
        <p>{loadError || LOAD_ERROR_MESSAGE}</p>
        <button type="button" className={styles.primaryButton} onClick={() => void loadCanonicalTeam()}>
          Reintentar
        </button>
      </section>
    );
  }

  return (
    <section className={styles.teamView} aria-labelledby="team-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Administración</p>
          <h1 id="team-title">Equipo</h1>
          <p className={styles.description}>
            El rol define permisos administrativos. “Miembro” significa acceso no administrativo; “Presta servicios” define, por separado, si la persona puede recibir nuevas reservas.
          </p>
        </div>
        <div className={styles.summary} aria-label={`${team.length} integrantes en el equipo`}>
          <strong>{team.length}</strong>
          <span>{team.length === 1 ? 'integrante' : 'integrantes'}</span>
        </div>
      </header>

      {isReconciling && (
        <div className={styles.refreshWarning} role="status" aria-live="polite">
          <span>Actualizando Equipo con el estado canónico del servidor antes de permitir nuevos cambios.</span>
        </div>
      )}

      {loadError && !isReconciling && (
        <div className={styles.refreshWarning} role="alert">
          <span>{loadError}</span>
          <button type="button" onClick={() => void reconcileCanonicalTeam()}>Actualizar lista</button>
        </div>
      )}

      {team.length === 0 ? (
        <div className={styles.emptyState}>
          <h2>No hay Memberships para mostrar</h2>
          <p>Cuando existan integrantes en este negocio, aparecerán aquí.</p>
        </div>
      ) : (
        <div className={styles.teamGrid}>
          {team.map((membership) => {
            const name = getTeamMemberName(membership);
            const isPending = pendingMembershipIds.has(membership.membershipId);
            const feedback = feedbackByMembership[membership.membershipId];
            const controlsLocked = isPending || isReconciling;
            const canChangeRole = canChangeTeamRole(membership) && !controlsLocked;
            const canChangeServices = canChangeBookability(membership) && !controlsLocked;
            const canDeactivate = canDeactivateMembership(membership) && !controlsLocked;
            const isConfirming = confirmingMembershipId === membership.membershipId;

            return (
              <article
                key={membership.membershipId}
                className={`${styles.memberCard} ${!membership.isActive ? styles.inactiveCard : ''}`}
                aria-busy={isPending}
              >
                <div className={styles.memberHeader}>
                  <div className={styles.identity}>
                    <h2>{name}</h2>
                    <div className={styles.badges}>
                      <span className={styles.roleBadge}>{TEAM_ROLE_LABELS[membership.role]}</span>
                      {membership.isOwner && <span className={styles.ownerBadge}>Propietario</span>}
                      {!membership.isActive && <span className={styles.inactiveBadge}>Acceso desactivado</span>}
                    </div>
                  </div>
                  {isPending && <span className={styles.saving} aria-live="polite">Guardando…</span>}
                </div>

                <div className={styles.settingGroup}>
                  <div className={styles.settingCopy}>
                    <span className={styles.settingLabel}>Rol</span>
                    <small>Administrador puede administrar Equipo; Miembro tiene acceso no administrativo.</small>
                  </div>

                  {membership.isOwner ? (
                    <span className={styles.staticValue}>Administrador</span>
                  ) : (
                    <select
                      className={styles.roleSelect}
                      value={membership.role}
                      disabled={!canChangeRole}
                      aria-label={`Rol de ${name}`}
                      onChange={(event) => handleRoleChange(membership, event.target.value as TeamMembershipRole)}
                    >
                      <option value="admin">Administrador</option>
                      <option value="worker">Miembro</option>
                    </select>
                  )}
                </div>

                <div className={styles.divider} />

                <label className={`${styles.settingGroup} ${styles.bookabilitySetting}`}>
                  <span className={styles.settingCopy}>
                    <span className={styles.settingLabel}>Presta servicios</span>
                    <small>
                      {membership.isActive
                        ? 'Puede recibir nuevas reservas cuando está activado.'
                        : 'El acceso desactivado impide recibir nuevas reservas.'}
                    </small>
                  </span>
                  <span className={styles.switchControl}>
                    <input
                      type="checkbox"
                      checked={membership.isBookable}
                      disabled={!canChangeServices}
                      aria-label={`${name}: presta servicios`}
                      onChange={(event) => handleBookabilityChange(membership, event.target.checked)}
                    />
                    <span className={styles.switchTrack} aria-hidden="true">
                      <span className={styles.switchThumb} />
                    </span>
                  </span>
                </label>

                <div className={styles.accessSection}>
                  <div>
                    <span className={styles.settingLabel}>Acceso al negocio</span>
                    <p>{membership.isActive ? 'Activo' : 'Acceso desactivado'}</p>
                  </div>

                  {canDeactivateMembership(membership) && (
                    <button
                      type="button"
                      className={styles.dangerButton}
                      disabled={!canDeactivate}
                      onClick={() => setConfirmingMembershipId(isConfirming ? null : membership.membershipId)}
                    >
                      Desactivar acceso
                    </button>
                  )}
                </div>

                {membership.isOwner && (
                  <p className={styles.ownerNotice}>
                    El propietario conserva rol Administrador y acceso activo. “Presta servicios” sí puede cambiarse.
                  </p>
                )}

                {isConfirming && membership.isActive && !membership.isOwner && (
                  <div className={styles.confirmation} role="group" aria-label={`Confirmar desactivación de ${name}`}>
                    <p>
                      La persona perderá acceso a este negocio y dejará de poder recibir nuevas reservas. Su historial no se elimina.
                    </p>
                    <div className={styles.confirmActions}>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        disabled={controlsLocked}
                        onClick={() => setConfirmingMembershipId(null)}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className={styles.confirmDangerButton}
                        disabled={controlsLocked}
                        onClick={() => void mutateMembership(membership, deactivatePatch())}
                      >
                        Confirmar desactivación
                      </button>
                    </div>
                  </div>
                )}

                {feedback && (
                  <p
                    className={feedback.tone === 'error' ? styles.errorFeedback : styles.successFeedback}
                    role={feedback.tone === 'error' ? 'alert' : 'status'}
                  >
                    {feedback.message}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default TeamView;
