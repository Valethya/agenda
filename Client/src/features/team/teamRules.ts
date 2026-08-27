import type {
  SessionIdentity,
  TeamMembership,
  TeamMembershipPatch,
  TeamMembershipRole
} from '../../types/index.ts';

export interface TeamMutationErrorLike {
  status?: number;
  message?: string;
}

export interface TeamReadTicket {
  readGeneration: number;
  canonicalGeneration: number;
}

export const TEAM_ROLE_LABELS: Record<TeamMembershipRole, string> = {
  admin: 'Administrador',
  worker: 'Miembro'
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

export function getSessionUserId(user: Pick<SessionIdentity, 'id' | '_id'> | null): string | null {
  return user?._id || user?.id || null;
}

export function isCallerMembership(
  member: TeamMembership,
  user: Pick<SessionIdentity, 'id' | '_id'> | null
): boolean {
  const userId = getSessionUserId(user);
  return Boolean(userId && member.userId === userId);
}

export function hasActiveTeamAdminAuthority(member: TeamMembership): boolean {
  return member.isActive && member.role === 'admin';
}

export function didCallerLoseTeamAdminAuthority(
  member: TeamMembership,
  user: Pick<SessionIdentity, 'id' | '_id'> | null
): boolean {
  return isCallerMembership(member, user) && !hasActiveTeamAdminAuthority(member);
}

export function isTeamAuthenticationError(error: TeamMutationErrorLike): boolean {
  return error.status === 401;
}

export function isTeamAuthorityError(error: TeamMutationErrorLike): boolean {
  return error.status === 403;
}

export function shouldRefetchTeamAfterMutationError(error: TeamMutationErrorLike): boolean {
  return error.status === 409;
}

export function getTeamMutationErrorMessage(error: TeamMutationErrorLike): string {
  if (error.status === 409) {
    const reason = error.message && !error.message.startsWith('API error:')
      ? `${error.message} `
      : '';
    return `${reason}El cambio entró en conflicto con el estado actual. Equipo volverá a consultar el servidor antes de permitir nuevas modificaciones.`;
  }

  if (error.status === 401) {
    return 'Tu sesión ya no está vigente. Se volverá a validar antes de continuar.';
  }

  if (error.status === 403) {
    return 'Tu acceso administrativo a Equipo ya no está vigente.';
  }

  if (error.message && !error.message.startsWith('API error:')) {
    return error.message;
  }

  return 'No pudimos guardar el cambio. El estado anterior se mantiene.';
}

/**
 * Coordinates Team reads and PATCHes without replacing backend authority.
 * Normal PATCHes may run concurrently across rows. Once a 409 requires
 * reconciliation, new mutations remain locked until a fresh canonical GET
 * both succeeds and is valid to apply. A failed reconciliation attempt ends
 * the active GET but intentionally keeps reconciliationRequired=true so the
 * UI stays read-only until a later successful retry.
 */
export class TeamSyncCoordinator {
  private inFlightMutations = 0;
  private canonicalGeneration = 0;
  private latestReadGeneration = 0;
  private reconciling = false;
  private reconciliationRequired = false;
  private drainWaiters = new Set<() => void>();

  beginMutation(): boolean {
    if (this.reconciling || this.reconciliationRequired) return false;
    this.inFlightMutations += 1;
    return true;
  }

  finishMutation(canonicalAccepted: boolean): void {
    if (canonicalAccepted) {
      this.canonicalGeneration += 1;
    }

    this.inFlightMutations = Math.max(0, this.inFlightMutations - 1);
    if (this.inFlightMutations === 0) {
      for (const resolve of this.drainWaiters) resolve();
      this.drainWaiters.clear();
    }
  }

  beginReconciliation(): void {
    this.reconciliationRequired = true;
    this.reconciling = true;
  }

  finishReconciliation(canonicalApplied: boolean): void {
    this.reconciling = false;
    if (canonicalApplied) {
      this.reconciliationRequired = false;
    }
  }

  isReconciliationActive(): boolean {
    return this.reconciling;
  }

  isReconciliationRequired(): boolean {
    return this.reconciliationRequired;
  }

  areMutationsBlocked(): boolean {
    return this.reconciling || this.reconciliationRequired;
  }

  waitForMutationsToDrain(): Promise<void> {
    if (this.inFlightMutations === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.drainWaiters.add(resolve);
    });
  }

  beginRead(): TeamReadTicket {
    return {
      readGeneration: ++this.latestReadGeneration,
      canonicalGeneration: this.canonicalGeneration
    };
  }

  canApplyRead(ticket: TeamReadTicket): boolean {
    return ticket.readGeneration === this.latestReadGeneration
      && ticket.canonicalGeneration === this.canonicalGeneration;
  }

  invalidateReads(): void {
    this.latestReadGeneration += 1;
  }
}
