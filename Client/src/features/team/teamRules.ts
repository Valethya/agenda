import type {
  TeamMembership,
  TeamMembershipPatch,
  TeamMembershipRole
} from '../../types/index.ts';

export interface TeamMutationErrorLike {
  status?: number;
  message?: string;
}

export const TEAM_ROLE_LABELS: Record<TeamMembershipRole, string> = {
  admin: 'Administrador',
  worker: 'Profesional'
};

export function getTeamMemberName(member: TeamMembership): string {
  return member.name?.trim() || 'Persona sin nombre';
}

export function canChangeTeamRole(member: TeamMembership): boolean {
  return member.isActive && !member.isOwner;
}

export function canChangeBookability(member: TeamMembership): boolean {
  return member.isActive;
}

export function canDeactivateMembership(member: TeamMembership): boolean {
  return member.isActive && !member.isOwner;
}

export function rolePatch(role: TeamMembershipRole): TeamMembershipPatch {
  return { role };
}

export function bookabilityPatch(isBookable: boolean): TeamMembershipPatch {
  return { isBookable };
}

export function deactivatePatch(): TeamMembershipPatch {
  return { isActive: false };
}

export function replaceCanonicalMembership(
  team: TeamMembership[],
  canonicalMembership: TeamMembership
): TeamMembership[] {
  return team.map((member) =>
    member.membershipId === canonicalMembership.membershipId
      ? canonicalMembership
      : member
  );
}

export function shouldRefetchTeamAfterMutationError(error: TeamMutationErrorLike): boolean {
  return error.status === 409;
}

export function getTeamMutationErrorMessage(error: TeamMutationErrorLike): string {
  if (error.status === 409) {
    const reason = error.message && !error.message.startsWith('API error:')
      ? `${error.message} `
      : '';
    return `${reason}El equipo se actualizó con el estado más reciente. Revisa el cambio e intenta nuevamente.`;
  }

  if (error.status === 403) {
    return 'No tienes autorización administrativa vigente para modificar este equipo.';
  }

  if (error.message && !error.message.startsWith('API error:')) {
    return error.message;
  }

  return 'No pudimos guardar el cambio. El estado anterior se mantiene.';
}
