import type {
  Service,
  ServiceWorkerSummary,
  ServiceWriteInput,
  TeamMembership
} from '../../types/index.ts';

export const ADMIN_SERVICES_ENDPOINT = '/internal/services';
export const SERVICE_MUTATION_ENDPOINT = '/services';
export const SERVICE_TEAM_ENDPOINT = '/team';

export interface ServiceFormState {
  name: string;
  description: string;
  duration: string;
  price: string;
  depositAmount: string;
  workers: string[];
}

export interface UnavailableServiceWorker {
  userId: string;
  name: string | null;
}

export const EMPTY_SERVICE_FORM: ServiceFormState = {
  name: '',
  description: '',
  duration: '',
  price: '',
  depositAmount: '0',
  workers: []
};

export function getAssignableTeamMembers(team: TeamMembership[]): TeamMembership[] {
  return team.filter((member) => member.isActive === true && member.isBookable === true);
}

const getServiceWorkerId = (worker: string | ServiceWorkerSummary): string => (
  typeof worker === 'string' ? worker : worker._id
);

const getServiceWorkerName = (worker: string | ServiceWorkerSummary): string | null => {
  if (typeof worker === 'string') return null;
  const name = `${worker.firstName || ''} ${worker.lastName || ''}`.trim();
  return name || null;
};

export function getUnavailableAssignedWorkers(
  service: Service,
  team: TeamMembership[]
): UnavailableServiceWorker[] {
  const assignableIds = new Set(getAssignableTeamMembers(team).map((member) => member.userId));
  const teamByUserId = new Map(team.map((member) => [member.userId, member]));

  return (service.workers || [])
    .map((worker) => {
      const userId = getServiceWorkerId(worker);
      if (assignableIds.has(userId)) return null;

      return {
        userId,
        name: teamByUserId.get(userId)?.name || getServiceWorkerName(worker)
      };
    })
    .filter((worker): worker is UnavailableServiceWorker => worker !== null);
}

export function serviceToForm(service: Service): ServiceFormState {
  return {
    name: service.name,
    description: service.description || '',
    duration: String(service.duration),
    price: String(service.price),
    depositAmount: String(service.depositAmount ?? 0),
    workers: (service.workers || []).map(getServiceWorkerId)
  };
}

export function removeWorkerAssignment(form: ServiceFormState, userId: string): ServiceFormState {
  return {
    ...form,
    workers: form.workers.filter((workerId) => workerId !== userId)
  };
}

export function buildServiceWriteInput(form: ServiceFormState): ServiceWriteInput {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    duration: Number(form.duration),
    price: Number(form.price),
    depositAmount: form.depositAmount.trim() === '' ? 0 : Number(form.depositAmount),
    workers: [...new Set(form.workers)]
  };
}

export function validateServiceWriteInput(input: ServiceWriteInput): string | null {
  if (input.name.length < 3) return 'El nombre debe tener al menos 3 caracteres.';
  if (!Number.isInteger(input.duration) || input.duration <= 0) {
    return 'La duración debe ser un número entero mayor que 0.';
  }
  if (!Number.isFinite(input.price) || input.price < 0) {
    return 'El precio debe ser igual o mayor que 0.';
  }
  if (!Number.isFinite(input.depositAmount) || input.depositAmount < 0) {
    return 'El monto de abono debe ser igual o mayor que 0.';
  }
  if (input.depositAmount > input.price) {
    return 'El monto de abono no puede superar el precio.';
  }
  return null;
}

export function replaceCanonicalService(services: Service[], canonicalService: Service): Service[] {
  const found = services.some((service) => service._id === canonicalService._id);
  if (!found) return [...services, canonicalService];
  return services.map((service) => service._id === canonicalService._id ? canonicalService : service);
}
