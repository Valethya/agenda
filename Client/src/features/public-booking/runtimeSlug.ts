import { normalizePublicBookingSlug } from './bookingModel.ts';

export function resolvePublicBookingSlugFromSearch(search: string): string | null {
  return normalizePublicBookingSlug(new URLSearchParams(search).get('slug'));
}
