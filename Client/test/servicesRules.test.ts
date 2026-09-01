import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Service, TeamMembership } from '../src/types/index.ts';
import {
  ADMIN_SERVICES_ENDPOINT,
  SERVICE_MUTATION_ENDPOINT,
  SERVICE_TEAM_ENDPOINT,
  buildServiceWriteInput,
  getAssignableTeamMembers,
  getUnavailableAssignedWorkers,
  removeWorkerAssignment,
  replaceCanonicalService,
  serviceToForm,
  validateServiceWriteInput
} from '../src/features/services/serviceRules.ts';

const member = (overrides: Partial<TeamMembership> = {}): TeamMembership => ({
  membershipId: '64f000000000000000000001',
  userId: '64f000000000000000000101',
  name: 'Persona Demo',
  role: 'worker',
  isBookable: true,
  isActive: true,
  isOwner: false,
  ...overrides
});

const service = (overrides: Partial<Service> = {}): Service => ({
  _id: '64f000000000000000000201',
  name: 'Corte',
  duration: 45,
  price: 15000,
  depositAmount: 5000,
  isActive: true,
  workers: [],
  ...overrides
});

test('selector de profesionales deriva exclusivamente de Team activo + bookable', () => {
  const eligibleAdmin = member({ role: 'admin', userId: 'admin', isBookable: true });
  const eligibleWorker = member({ role: 'worker', userId: 'worker', isBookable: true });
  const nonBookable = member({ userId: 'non-bookable', isBookable: false });
  const inactive = member({ userId: 'inactive', isActive: false, isBookable: true });

  assert.deepEqual(
    getAssignableTeamMembers([eligibleAdmin, eligibleWorker, nonBookable, inactive]).map((item) => item.userId),
    ['admin', 'worker']
  );
  assert.equal(SERVICE_TEAM_ENDPOINT, '/team');
  assert.notEqual(SERVICE_TEAM_ENDPOINT, '/internal/users/workers');
});

test('edición permite retirar asignaciones existentes que ya no son elegibles sin volverlas candidatas', () => {
  const eligible = member({ userId: 'worker-a', name: 'Profesional A' });
  const nonBookable = member({ userId: 'worker-b', name: 'Profesional B', isBookable: false });
  const inactive = member({ userId: 'worker-c', name: 'Profesional C', isActive: false });
  const currentService = service({
    workers: [
      { _id: 'worker-a', firstName: 'Profesional', lastName: 'A' },
      { _id: 'worker-b', firstName: 'Profesional', lastName: 'B' },
      'worker-c'
    ]
  });
  const team = [eligible, nonBookable, inactive];

  const form = serviceToForm(currentService);
  assert.deepEqual(form.workers, ['worker-a', 'worker-b', 'worker-c']);
  assert.deepEqual(
    getUnavailableAssignedWorkers(currentService, team),
    [
      { userId: 'worker-b', name: 'Profesional B' },
      { userId: 'worker-c', name: 'Profesional C' }
    ]
  );
  assert.deepEqual(getAssignableTeamMembers(team).map((item) => item.userId), ['worker-a']);

  const withoutNonBookable = removeWorkerAssignment(form, 'worker-b');
  const recoveredForm = removeWorkerAssignment(withoutNonBookable, 'worker-c');
  assert.deepEqual(recoveredForm.workers, ['worker-a']);
  assert.deepEqual(buildServiceWriteInput(recoveredForm).workers, ['worker-a']);

  assert.equal(getAssignableTeamMembers(team).some((item) => item.userId === 'worker-b'), false);
  assert.equal(getAssignableTeamMembers(team).some((item) => item.userId === 'worker-c'), false);
});

test('payload de escritura contiene sólo campos funcionales y nunca autoridad tenant', () => {
  const payload = buildServiceWriteInput({
    name: '  Corte premium  ',
    description: '  Detalle  ',
    duration: '60',
    price: '20000',
    depositAmount: '5000',
    workers: ['worker-a', 'worker-a', 'worker-b']
  });

  assert.deepEqual(payload, {
    name: 'Corte premium',
    description: 'Detalle',
    duration: 60,
    price: 20000,
    depositAmount: 5000,
    workers: ['worker-a', 'worker-b']
  });
  assert.equal('business' in payload, false);
  assert.equal('isActive' in payload, false);
  assert.equal('role' in payload, false);
  assert.equal('isBookable' in payload, false);
});

test('contrato cliente valida depósito contra el precio antes de enviar', () => {
  const valid = buildServiceWriteInput({
    name: 'Servicio válido', description: '', duration: '30', price: '10000', depositAmount: '5000', workers: []
  });
  const invalid = { ...valid, depositAmount: 15000 };

  assert.equal(validateServiceWriteInput(valid), null);
  assert.match(validateServiceWriteInput(invalid) || '', /no puede superar el precio/i);
});

test('estado local sólo se reemplaza con la representación canónica confirmada', () => {
  const original = service();
  const confirmed = service({ name: 'Corte actualizado', price: 18000 });
  const canonical = replaceCanonicalService([original], confirmed);

  assert.equal(canonical[0].name, 'Corte actualizado');
  assert.equal(canonical[0].price, 18000);
});

test('Servicios usa superficie admin interna para read y CRUD existente para mutaciones', () => {
  assert.equal(ADMIN_SERVICES_ENDPOINT, '/internal/services');
  assert.equal(SERVICE_MUTATION_ENDPOINT, '/services');

  const apiSource = readFileSync(new URL('../src/services/api.ts', import.meta.url), 'utf8');
  const viewSource = readFileSync(new URL('../src/components/ServicesView.tsx', import.meta.url), 'utf8');
  const rulesSource = readFileSync(new URL('../src/features/services/serviceRules.ts', import.meta.url), 'utf8');
  const dashboardSource = readFileSync(new URL('../src/components/AdminDashboard.tsx', import.meta.url), 'utf8');
  const sidebarSource = readFileSync(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8');

  assert.match(apiSource, /ADMIN_SERVICES_ENDPOINT/);
  assert.match(apiSource, /SERVICE_MUTATION_ENDPOINT/);
  assert.match(dashboardSource, /viewType === 'servicios'.*<ServicesView/s);
  assert.match(sidebarSource, /selectTenantView\('servicios'\)/);
  assert.doesNotMatch(viewSource, /internal\/users\/workers/);
  assert.doesNotMatch(viewSource, /hard=true|Eliminar permanentemente/i);
  assert.match(viewSource, /Desactivar servicio/);
  assert.match(viewSource, /Asignaciones existentes no disponibles/);
  assert.match(viewSource, /Quitar del servicio/);
  assert.match(viewSource, /getUnavailableAssignedWorkers/);
  assert.match(viewSource, /removeWorkerAssignment/);
  assert.match(viewSource, /aria-live/);
  assert.doesNotMatch(viewSource, /name=["']business|name=["']role|name=["']isBookable/i);
  assert.doesNotMatch(rulesSource, /member\.role|role\s*===/);
});
