import React, { useEffect, useState } from 'react';
import styles from './ProfessionalScheduleCard.module.scss';
import type { Professional, Shift } from '../types';
import * as api from '../services/api';
import { useCalendar } from '../context/CalendarContext';
import { parseUTCDateToLocal } from '../utils/time';

interface ProfessionalScheduleCardProps {
  professional: Professional;
  idx: number;
}

const DAYS_LABEL = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const COLORS = [
  'linear-gradient(135deg,#8A9BAE,#7A8E9E)',
  'linear-gradient(135deg,#B5A898,#A5988A)',
  'linear-gradient(135deg,#7A9E8C,#6A8E7C)',
  'linear-gradient(135deg,#C4AA7A,#B49A6A)'
];

export const ProfessionalScheduleCard: React.FC<ProfessionalScheduleCardProps> = ({ professional, idx }) => {
  const { citas, currentDate } = useCalendar();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Helper: get start of week (Monday)
  const getStartOfWeek = (d: Date): Date => {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const start = new Date(date.setDate(diff));
    start.setHours(0,0,0,0);
    return start;
  };

  // Helper: get end of week (Sunday)
  const getEndOfWeek = (d: Date): Date => {
    const start = getStartOfWeek(d);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23,59,59,999);
    return end;
  };

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

  const initials = `${professional.firstName[0] || ''}${professional.lastName[0] || ''}`.toUpperCase();
  const avatarColor = COLORS[idx % COLORS.length];

  // Map and sort shifts by Monday-first order
  const sortedShifts = DAY_ORDER.map(dayNum => {
    const foundShift = shifts.find(s => s.dayOfWeek === dayNum);
    return foundShift || { dayOfWeek: dayNum, isOpen: false, startTime: '', endTime: '', breaks: [], worker: professional._id };
  });

  // Calculate total weekly working hours
  let totalHours = 0;
  sortedShifts.forEach(s => {
    if (s.isOpen && s.startTime && s.endTime) {
      const [hStart, mStart] = s.startTime.split(':').map(Number);
      const [hEnd, mEnd] = s.endTime.split(':').map(Number);
      let diff = (hEnd * 60 + mEnd - (hStart * 60 + mStart)) / 60;
      if (s.breaks) {
        s.breaks.forEach(b => {
          const [bSH, bSM] = b.startTime.split(':').map(Number);
          const [bEH, bEM] = b.endTime.split(':').map(Number);
          diff -= (bEH * 60 + bEM - (bSH * 60 + bSM)) / 60;
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
