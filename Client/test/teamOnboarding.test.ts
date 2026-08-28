import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  TEAM_ADD_PERSON_LABEL,
  TEAM_ONBOARDING_ENDPOINT,
  TEAM_ONBOARDING_ERROR_MESSAGE,
  TEAM_ONBOARDING_SUCCESS_MESSAGE,
  buildTeamOnboardingIssueBody
} from '../src/features/team/teamOnboardingRules.ts';

const teamViewSource = readFileSync(
  new URL('../src/components/TeamView.tsx', import.meta.url),
  'utf8'
);

const onboardingSubmitSection = teamViewSource.slice(
  teamViewSource.indexOf('const handleOnboardingSubmit'),
  teamViewSource.indexOf("if (accessState !== 'active')")
);

const onboardingFormSection = teamViewSource.slice(
  teamViewSource.indexOf('{isAddingPerson && ('),
  teamViewSource.indexOf('{isReconciling && (')
);

test('D2 emits the canonical onboarding request with email and no authority-bearing fields', () => {
  const body = buildTeamOnboardingIssueBody('persona@example.com');

  assert.equal(TEAM_ONBOARDING_ENDPOINT, '/team/onboardings');
  assert.deepEqual(body, { email: 'persona@example.com' });
  assert.deepEqual(Object.keys(body), ['email']);
  assert.equal(JSON.stringify(body), '{"email":"persona@example.com"}');

  for (const forbiddenField of [
    'role',
    'isBookable',
    'isActive',
    'businessId',
    'userId',
    'password',
    'owner',
    'membership',
    'service',
    'shift'
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, forbiddenField),
      false,
      `onboarding body must not carry ${forbiddenField}`
    );
  }

  assert.match(onboardingSubmitSection, /apiFetch\(TEAM_ONBOARDING_ENDPOINT/);
  assert.match(onboardingSubmitSection, /method: 'POST'/);
  assert.match(onboardingSubmitSection, /body: buildTeamOnboardingIssueBody\(email\)/);
  assert.doesNotMatch(onboardingSubmitSection, /\/consume|\/bind|getWorkers|users\/workers/);
});

test('D2 exposes only the email onboarding UI after canonical Team access succeeds', () => {
  assert.equal(TEAM_ADD_PERSON_LABEL, 'Añadir persona');
  assert.ok(
    teamViewSource.indexOf('{TEAM_ADD_PERSON_LABEL}') > teamViewSource.indexOf("if (loadState === 'error')"),
    'add-person action must not render before Team GET has cleared loading/error states'
  );

  assert.match(onboardingFormSection, /<form/);
  assert.match(onboardingFormSection, /htmlFor="team-onboarding-email"/);
  assert.match(onboardingFormSection, /id="team-onboarding-email"/);
  assert.match(onboardingFormSection, /type="email"/);
  assert.match(onboardingFormSection, /required/);
  assert.match(onboardingFormSection, /autoComplete="email"/);
  assert.doesNotMatch(onboardingFormSection, /<select|type="checkbox"|name="(?:role|isBookable|isActive|businessId|userId)"/);
  assert.doesNotMatch(teamViewSource, /getWorkers|users\/workers|lookupUser|findUserByEmail/);
  assert.doesNotMatch(teamViewSource, /currentUser\?\.role|currentUser\.role/);
});

test('D2 prevents accidental double submit and provides basic accessible focus/disabled states', () => {
  assert.match(onboardingSubmitSection, /onboardingPendingRef\.current/);
  assert.match(onboardingSubmitSection, /onboardingPendingRef\.current = true/);
  assert.match(onboardingSubmitSection, /onboardingPendingRef\.current = false/);
  assert.match(teamViewSource, /disabled=\{isOnboardingPending\}/);
  assert.match(teamViewSource, /aria-busy=\{isOnboardingPending\}/);
  assert.match(teamViewSource, /emailInputRef\.current\?\.focus\(\)/);
  assert.match(teamViewSource, /aria-live=/);
  assert.match(teamViewSource, /Cerrar/);
  assert.match(teamViewSource, /Enviando…/);
});

test('D2 success stays pending semantically and never creates an optimistic Membership', () => {
  assert.match(TEAM_ONBOARDING_SUCCESS_MESSAGE, /Invitación enviada/i);
  assert.match(TEAM_ONBOARDING_SUCCESS_MESSAGE, /antes de aparecer en Equipo/i);
  assert.doesNotMatch(
    TEAM_ONBOARDING_SUCCESS_MESSAGE,
    /Persona añadida|Profesional creado|Usuario creado|Membership creada/i
  );

  assert.match(onboardingSubmitSection, /TEAM_ONBOARDING_SUCCESS_MESSAGE/);
  assert.doesNotMatch(onboardingSubmitSection, /setTeam\s*\(/);
  assert.doesNotMatch(onboardingSubmitSection, /replaceCanonicalMembership/);
});

test('D2 keeps backend failures generic and adds no reactivation or claimant consume flow', () => {
  assert.equal(
    TEAM_ONBOARDING_ERROR_MESSAGE,
    'No pudimos enviar la invitación. Intenta nuevamente más tarde.'
  );
  assert.doesNotMatch(
    TEAM_ONBOARDING_ERROR_MESSAGE,
    /ya tiene cuenta|Membership|inactiva|challenge|binding|otro negocio/i
  );

  assert.match(onboardingSubmitSection, /handleTeamAccessError\(normalizedError\)/);
  assert.match(onboardingSubmitSection, /TEAM_ONBOARDING_ERROR_MESSAGE/);
  assert.doesNotMatch(onboardingSubmitSection, /normalizedError\.message|error\.message/);
  assert.doesNotMatch(teamViewSource, /Reinvitar|Reactivar|Volver a agregar/);
  assert.doesNotMatch(teamViewSource, /onboardings\/.+\/consume|onboardings\/.+\/bind/);
});
