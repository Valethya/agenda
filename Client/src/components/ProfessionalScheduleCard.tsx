import React, { useEffect, useState } from 'react';
import styles from './ProfessionalScheduleCard.module.scss';
import type { Professional, Shift } from '../types';
import * as api from '../services/api';
import { useCalendarData } from '../context/CalendarDataContext';
import { useCalendarNavigation } from '../context/CalendarNavigationContext';
import { getPersonAvatarGradient, getPersonInitials } from '../utils/avatar';
import { getEndOfWeek, getStartOfWeek } from '../utils/calendarDate';
import { parseUTCDateToLocal, timeToMinutes } from '../utils/time';

interface ProfessionalScheduleCardProps {
  professional: Professional;
  idx: number;
}

const DAYS_LABEL = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const ProfessionalScheduleCard: React.FC<ProfessionalScheduleCardProps> = ({ professional, idx }) => {
  const { citas } = useCalendarData();
  const { currentDate } = useCalendarNavigation();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const fetchShifts = async () => {
      try {
        setLoading(true);
        const data = await api.getWorkerShifts(professional._id);
        setShifts(data || []);
      } catch (err) {
        console.error("Error loading shifts for professional " + professional._id, err);
      } finally {
        setLoading(false);
      }
    };
    fetchShifts();
  }, [professional._id]);

  const initials = getPersonInitials(professional.firstName, professional.lastName);
  const avatarColor = getPersonAvatarGradient(idx);

  // Map and sort shifts by Monday-first order
  const sortedShifts = DAY_ORDER.map(dayNum => {
    const foundShift = shifts.find(s => s.dayOfWeek === dayNum);
    return foundShift || { dayOfWeek: dayNum, isOpen: false, startTime: '', endTime: '', breaks: [], worker: professional._id };
  });

  // Calculate total weekly working hours
  let totalHours = 0;
  sortedShifts.forEach(s => {
    if (s.isOpen && s.startTime && s.endTime) {
      let diff = (timeToMinutes(s.endTime) - timeToMinutes(s.startTime)) / 60;
      if (s.breaks) {
        s.breaks.forEach(b => {
          diff -= (timeToMinutes(b.endTime) - timeToMinutes(b.startTime)) / 60;
        });
      }
      totalHours += diff;
    }
  });

  // Count worker appointments for the current week
  const startOfWeek = getStartOfWeek(currentDate);
  const endOfWeek = getEndOfWeek(currentDate);
  const weeklyAppointmentsCount = citas.filter(c => {
    const cWorkerId = typeof c.worker === 'object' ? c.worker._id : c.worker;
    if (cWorkerId !== professional._id) return false;
    const cDate = parseUTCDateToLocal(c.date);
    return cDate >= startOfWeek && cDate <= endOfWeek && c.status !== 'cancelled';
  }).length;

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.avatar} style={{ background: avatarColor }}>{initials}</div>
        <div>
          <div className={styles.name}>{professional.firstName} {professional.lastName}</div>
          <div className={styles.role}>
            {professional.role === 'admin' ? 'Administrador' : 'Especialista'}
          </div>
        </div>
      </div>
      
      <div className={styles.body}>
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--texto-suave)' }}>
            Cargando horarios...
          </div>
        ) : (
          sortedShifts.map(s => {
            const dayName = DAYS_LABEL[s.dayOfWeek];
            return (
              <div key={s.dayOfWeek} className={styles.row}>
                <span className={styles.day}>{dayName}</span>
                <div className={styles.blocks}>
                  {s.isOpen ? (
                    <>
                      <span className={`${styles.bloque} ${styles.trabajo}`}>
                        {s.startTime}–{s.endTime}
                      </span>
                      {s.breaks && s.breaks.map((b, bIdx) => (
                        <span key={bIdx} className={`${styles.bloque} ${styles.descanso}`}>
                          Colación {b.startTime}–{b.endTime}
                        </span>
                      ))}
                    </>
                  ) : (
                    <span className={`${styles.bloque} ${styles.libre}`}>Libre</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <div className={styles.statNum}>{weeklyAppointmentsCount}</div>
          <div className={styles.statLabel}>Citas semana</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statNum}>{Math.round(totalHours)}h</div>
          <div className={styles.statLabel}>Horas semanales</div>
        </div>
      </div>
    </div>
  );
};

export default ProfessionalScheduleCard;
