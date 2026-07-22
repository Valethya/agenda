export function generateHoras(slotDuration: number = 60, startHour: number = 8, endHour: number = 20): string[] {
  const horas: string[] = [];
  const startMins = startHour * 60;
  const endMins = endHour * 60;
  const totalMins = endMins - startMins;

  for (let m = 0; m <= totalMins; m += slotDuration) {
    const currentMins = startMins + m;
    const h = Math.floor(currentMins / 60) % 24;
    const mins = currentMins % 60;
    horas.push(`${String(h).padStart(2, '0')}:${String(mins).padStart(2, '0')}`);
  }
  return horas;
}

export function timeToMinutes(time: string): number {
  if (!time) return 0;
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function timeToMinutesFromDayStart(time: string, startHour: number = 0): number {
  const minutes = timeToMinutes(time);
  const dayStartMinutes = startHour * 60;
  return minutes < dayStartMinutes ? minutes + 24 * 60 : minutes;
}

export function timeRangeToSlotSpan(
  startTime: string,
  endTime: string,
  slotDuration: number = 60,
  startHour: number = 0
): number {
  const startMinutes = timeToMinutesFromDayStart(startTime, startHour);
  const endMinutes = timeToMinutesFromDayStart(endTime, startHour);
  return Math.max(1, Math.round((endMinutes - startMinutes) / slotDuration));
}

export function timeToRowIndex(startTime: string, slotDuration: number = 60, startHour: number = 8): number {
  if (!startTime) return 1;
  const mins = timeToMinutesFromDayStart(startTime, startHour) - startHour * 60;
  return Math.round(mins / slotDuration) + 1;
}

export function formatLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
 
export function parseUTCDateToLocal(dateInput: string | Date): Date {
  if (!dateInput) return new Date();
  if (dateInput instanceof Date) return dateInput;
  const parts = dateInput.split('T')[0].split('-').map(Number);
  if (parts.length === 3) {
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  return new Date(dateInput);
}
export function getWorkerDaysOff(email?: string | string[], workerShifts?: any[]): number[] {
  // Si tenemos los turnos reales de la base de datos para este trabajador, los usamos de forma dinámica
  if (workerShifts && workerShifts.length > 0) {
    const workingDays = workerShifts
      .filter(s => s.isOpen)
      .map(s => s.dayOfWeek);
    
    const daysOff: number[] = [];
    for (let day = 0; day <= 6; day++) {
      if (!workingDays.includes(day)) {
        daysOff.push(day);
      }
    }
    return daysOff;
  }

  // Fallback estático basado en correos
  if (!email) return [0, 6];
  const emailStr = Array.isArray(email) ? (email[0] || '') : email;
  const eLower = emailStr.toLowerCase();
  if (eLower.includes('sofia@barberia.com') || eLower.includes('lucas@barberia.com')) {
    return [0, 1, 2]; // Domingo, Lunes, Martes
  }
  if (eLower.includes('javier@barberia.com') || eLower.includes('elena@barberia.com')) {
    return [1, 2, 3]; // Lunes, Martes, Miércoles
  }
  return [0, 6]; // Domingo, Sábado por defecto
}

export function getBusinessHoursBounds(businessConfig: any) {
  let startHour = 8;
  let endHour = 20;

  if (businessConfig && businessConfig.workingHours && businessConfig.workingHours.length > 0) {
    const openDays = businessConfig.workingHours.filter((wh: any) => wh.isOpen);
    if (openDays.length > 0) {
      const startTimes = openDays.map((wh: any) => {
        const [h] = wh.startTime.split(':').map(Number);
        return h;
      });
      startHour = Math.min(...startTimes);

      const endTimes = openDays.map((wh: any) => {
        const [h] = wh.endTime.split(':').map(Number);
        return h;
      });
      endHour = Math.max(...endTimes);
    }
  }

  // Ajustar límites: mostrar desde 1 hora antes de abrir hasta 1 hora después de cerrar
  startHour = Math.max(0, startHour - 1);
  endHour = Math.min(24, endHour + 1);
  return { startHour, endHour };
}
