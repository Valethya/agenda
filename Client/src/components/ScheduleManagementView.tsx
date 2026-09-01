import React, { useEffect, useMemo, useState } from 'react';
import styles from './ScheduleManagementView.module.scss';
import ProfessionalScheduleCard from './ProfessionalScheduleCard';
import * as api from '../services/api';
import type { TeamMembership } from '../types';
import { filterScheduleCandidates } from '../features/availability/scheduleRules';

interface ScheduleManagementViewProps {
  canManageTeam: boolean;
}

const ScheduleManagementView: React.FC<ScheduleManagementViewProps> = ({ canManageTeam }) => {
  const [team, setTeam] = useState<TeamMembership[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadTeam = async () => {
      try {
        setLoading(true);
        setError(null);
        const canonicalTeam = await api.getTeam();
        if (!cancelled) setTeam(canonicalTeam);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar el equipo.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadTeam();
    return () => { cancelled = true; };
  }, []);

  const candidates = useMemo(() => filterScheduleCandidates(team), [team]);

  useEffect(() => {
    if (candidates.length === 0) {
      setSelectedUserId('');
      setEditing(false);
      return;
    }
    if (!candidates.some((member) => member.userId === selectedUserId)) {
      setSelectedUserId(candidates[0].userId);
      setEditing(false);
    }
  }, [candidates, selectedUserId]);

  const selected = candidates.find((member) => member.userId === selectedUserId) ?? null;

  if (loading) {
    return <div className={styles.state}>Cargando profesionales y horarios...</div>;
  }

  if (error) {
    return <div className={`${styles.state} ${styles.error}`}>{error}</div>;
  }

  return (
    <section className={styles.view} aria-labelledby="schedule-title">
      <div className={styles.header}>
        <div>
          <h2 id="schedule-title" className={styles.title}>Horarios del equipo</h2>
          <p className={styles.subtitle}>Configura la disponibilidad semanal de profesionales agendables.</p>
        </div>
        {canManageTeam && selected && (
          <button
            type="button"
            className={styles.editButton}
            onClick={() => setEditing((current) => !current)}
          >
            {editing ? 'Cerrar edición' : 'Editar horarios'}
          </button>
        )}
      </div>

      {candidates.length === 0 ? (
        <div className={styles.state}>No hay profesionales activos y agendables.</div>
      ) : (
        <>
          <label className={styles.selectorLabel} htmlFor="schedule-professional">
            Profesional
          </label>
          <select
            id="schedule-professional"
            className={styles.selector}
            value={selectedUserId}
            onChange={(event) => {
              setSelectedUserId(event.target.value);
              setEditing(false);
            }}
          >
            {candidates.map((member) => (
              <option key={member.membershipId} value={member.userId}>
                {member.name || 'Profesional sin nombre'} · {member.role === 'admin' ? 'Administrador' : 'Especialista'}
              </option>
            ))}
          </select>

          {selected && (
            <ProfessionalScheduleCard
              key={selected.userId}
              member={selected}
              editable={canManageTeam && editing}
            />
          )}

          {!canManageTeam && (
            <p className={styles.notice}>Tu autoridad tenant no permite administrar horarios del equipo.</p>
          )}
        </>
      )}
    </section>
  );
};

export default ScheduleManagementView;
