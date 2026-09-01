import React, { useEffect, useMemo, useState } from 'react';
import styles from './ProfessionalScheduleCard.module.scss';
import type { Break, Shift, TeamMembership } from '../types';
import * as api from '../services/api';
import {
  buildSevenDaySchedule,
  buildShiftWriteInput,
  mergeCanonicalShift
} from '../features/availability/scheduleRules';
import { timeToMinutes } from '../utils/time';

interface ProfessionalScheduleCardProps {
  member: TeamMembership;
  editable: boolean;
}

const DAYS_LABEL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const cloneSchedule = (schedule: Shift[]): Shift[] => schedule.map((shift) => ({
  ...shift,
  breaks: shift.breaks.map((entry) => ({ ...entry }))
}));

const getInitials = (name: string | null) => {
  const parts = (name || 'P').trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'P';
};

export const ProfessionalScheduleCard: React.FC<ProfessionalScheduleCardProps> = ({ member, editable }) => {
  const [canonicalSchedule, setCanonicalSchedule] = useState<Shift[]>([]);
  const [draftSchedule, setDraftSchedule] = useState<Shift[]>([]);
  const [dirtyDays, setDirtyDays] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadCanonicalSchedule = async () => {
    const shifts = await api.getWorkerShifts(member.userId);
    const normalized = buildSevenDaySchedule(member.userId, shifts || []);
    setCanonicalSchedule(normalized);
    setDraftSchedule(cloneSchedule(normalized));
    setDirtyDays(new Set());
    return normalized;
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const shifts = await api.getWorkerShifts(member.userId);
        if (cancelled) return;
        const normalized = buildSevenDaySchedule(member.userId, shifts || []);
        setCanonicalSchedule(normalized);
        setDraftSchedule(cloneSchedule(normalized));
        setDirtyDays(new Set());
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar los horarios.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [member.userId]);

  useEffect(() => {
    if (!editable && !saving) {
      setDraftSchedule(cloneSchedule(canonicalSchedule));
      setDirtyDays(new Set());
      setError(null);
      setSuccess(null);
    }
  }, [editable, saving, canonicalSchedule]);

  const totalHours = useMemo(() => draftSchedule.reduce((total, shift) => {
    if (!shift.isOpen) return total;
    const breakMinutes = shift.breaks.reduce(
      (sum, entry) => sum + Math.max(0, timeToMinutes(entry.endTime) - timeToMinutes(entry.startTime)),
      0
    );
    return total + Math.max(0, timeToMinutes(shift.endTime) - timeToMinutes(shift.startTime) - breakMinutes) / 60;
  }, 0), [draftSchedule]);

  const updateDay = (dayOfWeek: number, updater: (shift: Shift) => Shift) => {
    if (!editable || saving) return;
    setDraftSchedule((current) => current.map((shift) =>
      shift.dayOfWeek === dayOfWeek ? updater(shift) : shift
    ));
    setDirtyDays((current) => new Set(current).add(dayOfWeek));
    setSuccess(null);
    setError(null);
  };

  const updateBreak = (dayOfWeek: number, breakIndex: number, patch: Partial<Break>) => {
    updateDay(dayOfWeek, (shift) => ({
      ...shift,
      breaks: shift.breaks.map((entry, index) => index === breakIndex ? { ...entry, ...patch } : entry)
    }));
  };

  const saveChanges = async () => {
    if (saving || dirtyDays.size === 0) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      let nextCanonical = cloneSchedule(canonicalSchedule);
      for (const dayOfWeek of Array.from(dirtyDays).sort((left, right) => left - right)) {
        const day = draftSchedule.find((shift) => shift.dayOfWeek === dayOfWeek);
        if (!day) continue;
        const saved = await api.saveWorkerShift(buildShiftWriteInput(member.userId, day));
        nextCanonical = mergeCanonicalShift(nextCanonical, saved);
      }
      setCanonicalSchedule(nextCanonical);
      setDraftSchedule(cloneSchedule(nextCanonical));
      setDirtyDays(new Set());
      setSuccess('Horarios guardados correctamente.');
    } catch (saveError) {
      try {
        await loadCanonicalSchedule();
      } catch {
        setDraftSchedule(cloneSchedule(canonicalSchedule));
        setDirtyDays(new Set());
      }
      setError(saveError instanceof Error ? saveError.message : 'No se pudieron guardar los horarios.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.avatar}>{getInitials(member.name)}</div>
        <div>
          <div className={styles.name}>{member.name || 'Profesional sin nombre'}</div>
          <div className={styles.role}>{member.role === 'admin' ? 'Administrador' : 'Especialista'}</div>
        </div>
      </div>

      <div className={styles.body}>
        {loading ? (
          <div className={styles.state}>Cargando horarios...</div>
        ) : error && canonicalSchedule.length === 0 ? (
          <div className={`${styles.state} ${styles.error}`}>{error}</div>
        ) : (
          draftSchedule.map((shift) => (
            <div key={shift.dayOfWeek} className={styles.dayCard}>
              <div className={styles.dayHeader}>
                <strong className={styles.day}>{DAYS_LABEL[shift.dayOfWeek]}</strong>
                <label className={styles.toggleLabel}>
                  <input
                    type="checkbox"
                    checked={shift.isOpen}
                    disabled={!editable || saving}
                    onChange={(event) => updateDay(shift.dayOfWeek, (current) => ({
                      ...current,
                      isOpen: event.target.checked
                    }))}
                  />
                  {shift.isOpen ? 'Disponible' : 'No disponible'}
                </label>
              </div>

              {shift.isOpen && (
                <div className={styles.dayBody}>
                  <div className={styles.timeGrid}>
                    <label>
                      Inicio
                      <input
                        type="time"
                        value={shift.startTime}
                        disabled={!editable || saving}
                        onChange={(event) => updateDay(shift.dayOfWeek, (current) => ({
                          ...current,
                          startTime: event.target.value
                        }))}
                      />
                    </label>
                    <label>
                      Término
                      <input
                        type="time"
                        value={shift.endTime}
                        disabled={!editable || saving}
                        onChange={(event) => updateDay(shift.dayOfWeek, (current) => ({
                          ...current,
                          endTime: event.target.value
                        }))}
                      />
                    </label>
                  </div>

                  <div className={styles.breaks}>
                    {shift.breaks.map((entry, breakIndex) => (
                      <div className={styles.breakRow} key={`${shift.dayOfWeek}-${breakIndex}`}>
                        <span>Descanso {breakIndex + 1}</span>
                        <input
                          aria-label={`Inicio descanso ${breakIndex + 1}`}
                          type="time"
                          value={entry.startTime}
                          disabled={!editable || saving}
                          onChange={(event) => updateBreak(shift.dayOfWeek, breakIndex, { startTime: event.target.value })}
                        />
                        <input
                          aria-label={`Término descanso ${breakIndex + 1}`}
                          type="time"
                          value={entry.endTime}
                          disabled={!editable || saving}
                          onChange={(event) => updateBreak(shift.dayOfWeek, breakIndex, { endTime: event.target.value })}
                        />
                        {editable && (
                          <button
                            type="button"
                            className={styles.removeButton}
                            disabled={saving}
                            onClick={() => updateDay(shift.dayOfWeek, (current) => ({
                              ...current,
                              breaks: current.breaks.filter((_, index) => index !== breakIndex)
                            }))}
                          >
                            Quitar
                          </button>
                        )}
                      </div>
                    ))}
                    {editable && (
                      <button
                        type="button"
                        className={styles.addButton}
                        disabled={saving}
                        onClick={() => updateDay(shift.dayOfWeek, (current) => ({
                          ...current,
                          breaks: [...current.breaks, { startTime: '13:00', endTime: '14:00' }]
                        }))}
                      >
                        Añadir descanso
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className={styles.footer}>
        <div>
          <span className={styles.statNum}>{Math.round(totalHours * 10) / 10}h</span>
          <span className={styles.statLabel}> semanales</span>
        </div>
        {editable && (
          <button
            type="button"
            className={styles.saveButton}
            disabled={saving || dirtyDays.size === 0}
            onClick={() => void saveChanges()}
          >
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        )}
      </div>
      {success && <div className={styles.feedback}>{success}</div>}
      {error && canonicalSchedule.length > 0 && <div className={`${styles.feedback} ${styles.error}`}>{error}</div>}
    </div>
  );
};

export default ProfessionalScheduleCard;
