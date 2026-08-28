export const TEAM_ONBOARDING_ENDPOINT = '/team/onboardings';
export const TEAM_ADD_PERSON_LABEL = 'Añadir persona';
export const TEAM_ONBOARDING_SUCCESS_MESSAGE =
  'Invitación enviada. La persona debe completar el proceso desde el correo recibido antes de aparecer en Equipo.';
export const TEAM_ONBOARDING_ERROR_MESSAGE =
  'No pudimos enviar la invitación. Intenta nuevamente más tarde.';

export interface TeamOnboardingIssueBody {
  email: string;
}

export function buildTeamOnboardingIssueBody(email: string): TeamOnboardingIssueBody {
  return { email };
}
