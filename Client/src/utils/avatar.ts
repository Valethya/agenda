const PERSON_AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#8A9BAE,#7A8E9E)',
  'linear-gradient(135deg,#B5A898,#A5988A)',
  'linear-gradient(135deg,#7A9E8C,#6A8E7C)',
  'linear-gradient(135deg,#C4AA7A,#B49A6A)'
] as const;

const BUSINESS_AVATAR_GRADIENTS = [
  ...PERSON_AVATAR_GRADIENTS,
  'linear-gradient(135deg,#B5827A,#A5726A)'
] as const;

const BUSINESS_NAME_STOP_WORDS = new Set([
  'de', 'del', 'el', 'la', 'los', 'las', 'y', 'en', 'para', 'con', 'a'
]);

export function getPersonAvatarGradient(index: number): string {
  const normalizedIndex = Math.abs(index) % PERSON_AVATAR_GRADIENTS.length;
  return PERSON_AVATAR_GRADIENTS[normalizedIndex];
}

export function getBusinessAvatarGradient(key: string): string {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = key.charCodeAt(index) + ((hash << 5) - hash);
  }
  return BUSINESS_AVATAR_GRADIENTS[Math.abs(hash) % BUSINESS_AVATAR_GRADIENTS.length];
}

export function getPersonInitials(firstName: string, lastName: string): string {
  return `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase();
}

export function getMeaningfulInitials(name: string): string {
  if (!name) return '';

  const words = name.split(/\s+/).filter(word => (
    word.length > 0 && !BUSINESS_NAME_STOP_WORDS.has(word.toLocaleLowerCase('es'))
  ));

  if (words.length === 0) return name.slice(0, 2).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}
