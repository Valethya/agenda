const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export const parseStrictISODate = (value) => {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return null;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.toISOString().slice(0, 10) !== value) return null;

  return parsed;
};

export const isStrictISODate = (value) => Boolean(parseStrictISODate(value));
