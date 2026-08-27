import React from 'react';
import styles from './TeamView.module.scss';
import { getTeam, isApiError, updateTeamMembership } from '../services/api';
import type { TeamMembership, TeamMembershipPatch, TeamMembershipRole } from '../types';
import {
  TEAM_ROLE_LABELS,
  bookabilityPatch,
  canChangeBookability,
  canChangeTeamRole,
  canDeactivateMembership,
  deactivatePatch,
  getTeamMemberName,
  getTeamMutationErrorMessage,
  replaceCanonicalMembership,
  rolePatch,
  shouldRefetchTeamAfterMutationError
} from '../features/team/teamRules';

type Feedback = {
  tone: 'success' | 'error';
  message: string;
};

const LOAD_ERROR_MESSAGE = 'No pudimos cargar el equipo. Revisa tu conexión o acceso e intenta nuevamente.';
const REFRESH_ERROR_MESSAGE = 'El cambio entró en conflicto y no pudimos actualizar la lista. Recarga Equipo antes de intentar otra modificación.';

export const TeamView: React.FC = () => {
  const [team, setTeam] = React.useState<TeamMembership[]>([]);
  const [loadState, setLoadState] = React.useState<'loading' | 'loaded' | 'error'>('loading');
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [feedbackByMembership, setFeedbackByMembership] = React.useState<Record<string, Feedback>>({});
  const [confirmingMembershipId, setConfirmingMembershipId] = React.useState<string | null>(null);
  const [pendingMembershipIds, setPendingMembershipIds] = React.useState<Set<string>>(new Set());
  const pendingRef = React.useRef<Set<string>>(new Set());

  const loadCanonicalTeam = React.useCallback(async (preserveCurrentState = false) => {
    if (!preserveCurrentState) {
      setLoadState('loading');
    }
    setLoadError(null);

    try {
      const canonicalTeam = await getTeam();
      setTeam(canonicalTeam);
      setLoadState('loaded');
      return true;
    } catch {
      if (preserveCurrentState) {
        setLoadError(REFRESH_ERROR_MESSAGE);
      } else {
        setLoadState('error');
        setLoadError(LOAD_ERROR_MESSAGE);
      }
      return false;
    }
  }, []);

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
    if (pendingRef.current.has(membershipId)) return;

    setMembershipPending(membershipId, true);
    setFeedback(membershipId);

    try {
      const canonicalMembership = await updateTeamMembership(membershipId, patch);
      setTeam((current) => replaceCanonicalMembership(current, canonicalMembership));
      setConfirmingMembershipId((current) => current === membershipId ? null : current);
      setFeedback(membershipId, { tone: 'success', message: 'Cambios guardados.' });
    } catch (error) {
      const normalizedError = isApiError(error)
        ? { status: error.status, message: error.message }
        : { message: error instanceof Error ? error.message : undefined };

      setFeedback(membershipId, {
        tone: 'error',
        message: getTeamMutationErrorMessage(normalizedError)
      });

      if (shouldRefetchTeamAfterMutationError(normalizedError)) {
        await loadCanonicalTeam(true);
      }
    } finally {
      setMembershipPending(membershipId, false);
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
            El rol define el nivel de acceso. “Presta servicios” define, por separado, si la persona puede recibir nuevas reservas.
          </p>
        </div>
        <div className={styles.summary} aria-label={`${team.length} integrantes en el equipo`}>
          <strong>{team.length}</strong>
          <span>{team.length === 1 ? 'integrante' : 'integrantes'}</span>
        </div>
      </header>

      {loadError && (
        <div className={styles.refreshWarning} role="alert">
          <span>{loadError}</span>
          <button type="button" onClick={() => void loadCanonicalTeam(true)}>Actualizar lista</button>
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
            const canChangeRole = canChangeTeamRole(membership) && !isPending;
            const canChangeServices = canChangeBookability(membership) && !isPending;
            const canDeactivate = canDeactivateMembership(membership) && !isPending;
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
                    <small>Define qué puede administrar dentro del negocio.</small>
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
                      <option value="worker">Profesional</option>
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
                        disabled={isPending}
                        onClick={() => setConfirmingMembershipId(null)}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className={styles.confirmDangerButton}
                        disabled={isPending}
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
