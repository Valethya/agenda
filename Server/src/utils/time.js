/**
 * Convierte una cadena de hora "HH:MM" a minutos totales desde medianoche.
 */
export const timeToMinutes = (timeStr) => {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
};

/**
 * Convierte minutos totales desde medianoche a una cadena "HH:MM".
 */
export const minutesToTime = (totalMinutes) => {
  const hours = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (totalMinutes % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
};

/**
 * Añade minutos a una hora "HH:MM" y retorna "HH:MM".
 */
export const addMinutesToTime = (timeStr, minutesToAdd) => {
  const [hours, minutes] = timeStr.split(":").map(Number);
  const totalMinutes = hours * 60 + minutes + minutesToAdd;
  const newHours = Math.floor(totalMinutes / 60).toString().padStart(2, "0");
  const newMinutes = (totalMinutes % 60).toString().padStart(2, "0");
  return `${newHours}:${newMinutes}`;
};

/**
 * Verifica si dos rangos de tiempo se solapan.
 */
export const checkOverlap = (startA, endA, startB, endB) => {
  return Math.max(startA, startB) < Math.min(endA, endB);
};
