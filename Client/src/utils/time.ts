export function generateHoras(slotDuration: number = 60): string[] {
  const horas: string[] = [];
  // Spans 17 hours from 08:00 to 01:00 of the next day inclusive (1020 minutes)
  const totalMins = 17 * 60;
  for (let m = 0; m <= totalMins; m += slotDuration) {
    const currentMins = 8 * 60 + m;
    const h = Math.floor(currentMins / 60) % 24;
    const mins = currentMins % 60;
    horas.push(`${String(h).padStart(2, '0')}:${String(mins).padStart(2, '0')}`);
  }
  return horas;
}

export function timeToRowIndex(startTime: string, slotDuration: number = 60): number {
  if (!startTime) return 1;
  const [h, m] = startTime.split(':').map(Number);
  let mins = h * 60 + m - 8 * 60;
  if (h < 8) {
    // For slots after midnight (00:00 to 01:59)
    mins = (h + 24) * 60 + m - 8 * 60;
  }
  return Math.round(mins / slotDuration) + 1;
}

export function formatLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getWorkerDaysOff(email: string | string[], workerShifts?: any[]): number[] {
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
