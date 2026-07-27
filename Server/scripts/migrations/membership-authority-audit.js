import { createHash } from "node:crypto";

export const CANONICAL_SCHEMA_VERSION = 2;

export const MEMBERSHIP_AUTHORITY_COLLECTIONS = Object.freeze({
  users: "users",
  businesses: "businesses",
  memberships: "memberships",
});

export const REQUIRED_MEMBERSHIP_AUTHORITY_COLLECTIONS = Object.freeze(
  Object.values(MEMBERSHIP_AUTHORITY_COLLECTIONS).sort(),
);

export const AUDIT_CATEGORIES = Object.freeze([
  "alreadyConsistent",
  "eligibleBackfill",
  "roleConflict",
  "membershipStateConflict",
  "missingBusinessReference",
  "orphanMembership",
  "duplicateMembership",
  "missingRequiredCollection",
  "snapshotInconsistency",
  "missingUniqueMembershipIndex",
  "platformRoleInMembership",
  "unknownMembershipRole",
  "ownerWithoutAdminMembership",
  "inactiveIdentity",
  "legacyClientScope",
  "multipleMemberships",
  "unknownLegacyRole",
]);

const LEGACY_TENANT_ROLES = new Set(["admin", "worker"]);
const KNOWN_GLOBAL_ROLES = new Set(["user", "worker", "admin", "superadmin"]);
const RECOGNIZED_MEMBERSHIP_ROLES = new Set(["admin", "worker", "superadmin"]);

const fingerprintInvalidValue = (value) =>
  `invalid:${createHash("sha256").update(String(value), "utf8").digest("hex")}`;

const normalizeRole = (value, recognizedRoles) =>
  recognizedRoles.has(value) ? value : fingerprintInvalidValue(value);

const normalizeId = (value) => {
  if (value === null || value === undefined) return null;

  if (typeof value === "string") {
    return /^[a-fA-F0-9]{24}$/.test(value)
      ? value.toLowerCase()
      : fingerprintInvalidValue(value);
  }

  if (typeof value.toHexString === "function") {
    return value.toHexString().toLowerCase();
  }

  if (typeof value === "object" && typeof value.$oid === "string") {
    return value.$oid.toLowerCase();
  }

  return fingerprintInvalidValue(value);
};

const isObjectId = (value) => typeof value === "string" && /^[a-f0-9]{24}$/.test(value);

const normalizeActive = (value) => value !== false;

const compareText = (left, right) => {
  const normalizedLeft = String(left ?? "");
  const normalizedRight = String(right ?? "");
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  return 0;
};

const sortByFields = (items, fields) =>
  [...items].sort((left, right) => {
    for (const field of fields) {
      const comparison = compareText(left[field], right[field]);
      if (comparison !== 0) return comparison;
    }
    return 0;
  });

const withoutUndefined = (value) =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));

const normalizeUser = (user) => ({
  id: normalizeId(user._id),
  business: normalizeId(user.business),
  role: normalizeRole(user.role, KNOWN_GLOBAL_ROLES),
  isActive: normalizeActive(user.isActive),
});

const normalizeBusiness = (business) => ({
  id: normalizeId(business._id),
  owner: normalizeId(business.owner),
  isActive: normalizeActive(business.isActive),
});

const normalizeMembership = (membership) => ({
  id: normalizeId(membership._id),
  user: normalizeId(membership.user),
  business: normalizeId(membership.business),
  role: normalizeRole(membership.role, RECOGNIZED_MEMBERSHIP_ROLES),
  isActive: membership.isActive === true,
});

const normalizeDuplicatePair = (duplicate) => ({
  user: normalizeId(duplicate._id?.user ?? duplicate.user),
  business: normalizeId(duplicate._id?.business ?? duplicate.business),
  memberships: (duplicate.memberships ?? duplicate.membershipIds ?? [])
    .map(normalizeId)
    .sort(compareText),
  count: Number(duplicate.count),
});

const normalizeIndex = (index) => ({
  name: typeof index.name === "string" ? index.name : null,
  key: Object.entries(index.key ?? {}).map(([field, direction]) => [field, direction]),
  unique: index.unique === true,
  sparse: index.sparse === true,
  partial: index.partialFilterExpression !== undefined,
  partialFilterExpression: index.partialFilterExpression ?? null,
  collation: index.collation !== undefined,
  collationDefinition: index.collation ?? null,
  hidden: index.hidden === true,
});

export const isExactMembershipUniqueIndex = (index) => {
  const normalized = normalizeIndex(index);
  const [first, second] = normalized.key;

  return (
    normalized.key.length === 2 &&
    first?.[0] === "user" &&
    first?.[1] === 1 &&
    second?.[0] === "business" &&
    second?.[1] === 1 &&
    normalized.unique &&
    !normalized.sparse &&
    !normalized.partial &&
    !normalized.collation
  );
};

export const inspectMembershipIndexes = (indexes = []) => {
  const relatedIndexes = indexes
    .filter((index) => {
      const fields = Object.keys(index.key ?? {});
      return fields.includes("user") || fields.includes("business");
    })
    .map(normalizeIndex)
    .sort((left, right) =>
      compareText(serializeCanonicalPayload(left), serializeCanonicalPayload(right)),
    );

  return {
    expectedKey: [
      ["user", 1],
      ["business", 1],
    ],
    unique: true,
    exactUniqueExists: indexes.some(isExactMembershipUniqueIndex),
    observedRelatedIndexes: relatedIndexes,
  };
};

const loginOutcome = (activeMembershipCount) => {
  if (activeMembershipCount === 0) return "no_access";
  if (activeMembershipCount === 1) return "single";
  return "needs_selection";
};

const finding = (category, blocking, details = {}) =>
  withoutUndefined({
    category,
    blocking,
    ...details,
  });

const pairKey = (user, business) => `${user ?? "<null>"}:${business ?? "<null>"}`;

const canonicalFindingSort = (findings) =>
  [...findings].sort((left, right) => {
    const fields = ["category", "user", "business", "membership", "reason"];
    for (const field of fields) {
      const comparison = compareText(left[field], right[field]);
      if (comparison !== 0) return comparison;
    }
    return compareText(JSON.stringify(left), JSON.stringify(right));
  });

const canonicalCandidateSort = (candidates) =>
  sortByFields(candidates, ["user", "business", "role"]);

export const canonicalize = (value) => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("El payload canónico no admite números no finitos");
    }
    return value;
  }

  if (value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => {
      const canonical = canonicalize(entry);
      if (canonical === undefined) {
        throw new TypeError("El payload canónico no admite undefined dentro de arrays");
      }
      return canonical;
    });
  }

  if (typeof value === "object") {
    if (typeof value.toHexString === "function") {
      return value.toHexString().toLowerCase();
    }

    if (value instanceof Date) {
      throw new TypeError("El payload canónico no admite timestamps");
    }

    const result = {};
    for (const key of Object.keys(value).sort()) {
      const canonical = canonicalize(value[key]);
      if (canonical !== undefined) result[key] = canonical;
    }
    return result;
  }

  throw new TypeError(`Tipo no admitido en payload canónico: ${typeof value}`);
};

export const serializeCanonicalPayload = (payload) =>
  JSON.stringify(canonicalize(payload));

export const checksumCanonicalPayload = (payload) =>
  createHash("sha256").update(serializeCanonicalPayload(payload), "utf8").digest("hex");

const normalizeCollectionState = (collectionState) => {
  if (!collectionState || !Array.isArray(collectionState.observed)) {
    throw new TypeError(
      "collectionState.observed es obligatorio para construir el audit",
    );
  }

  const expected = [...REQUIRED_MEMBERSHIP_AUTHORITY_COLLECTIONS];
  const observed = [...new Set(collectionState.observed.map(String))].sort(compareText);
  const missing = expected.filter((name) => !observed.includes(name));

  return {
    expected,
    observed,
    missing,
  };
};

const normalizeSnapshotConsistency = (snapshotConsistency) => {
  if (
    !snapshotConsistency ||
    typeof snapshotConsistency.consistent !== "boolean" ||
    typeof snapshotConsistency.firstFingerprint !== "string" ||
    typeof snapshotConsistency.secondFingerprint !== "string"
  ) {
    throw new TypeError(
      "snapshotConsistency completo es obligatorio para construir el audit",
    );
  }

  return {
    consistent: snapshotConsistency.consistent,
    firstFingerprint: snapshotConsistency.firstFingerprint,
    secondFingerprint: snapshotConsistency.secondFingerprint,
  };
};

const documentsForCollection = (documents, collectionName, collectionState) => {
  if (!collectionState.observed.includes(collectionName)) return [];
  if (!Array.isArray(documents)) {
    throw new TypeError(
      `La colección observada "${collectionName}" debe tener una lectura válida`,
    );
  }
  return documents;
};

export const buildMembershipAuthoritySourcePayload = ({
  databaseName,
  collectionState,
  indexes,
  users,
  businesses,
  memberships,
  duplicatePairs,
}) => {
  if (!databaseName || typeof databaseName !== "string") {
    throw new TypeError("databaseName es obligatorio para construir la fuente");
  }

  const normalizedCollections = normalizeCollectionState(collectionState);
  const usersPresent = normalizedCollections.observed.includes(
    MEMBERSHIP_AUTHORITY_COLLECTIONS.users,
  );
  const businessesPresent = normalizedCollections.observed.includes(
    MEMBERSHIP_AUTHORITY_COLLECTIONS.businesses,
  );
  const membershipsPresent = normalizedCollections.observed.includes(
    MEMBERSHIP_AUTHORITY_COLLECTIONS.memberships,
  );

  const normalizedUsers = sortByFields(
    documentsForCollection(
      users,
      MEMBERSHIP_AUTHORITY_COLLECTIONS.users,
      normalizedCollections,
    ).map(normalizeUser),
    ["id"],
  );
  const normalizedBusinesses = sortByFields(
    documentsForCollection(
      businesses,
      MEMBERSHIP_AUTHORITY_COLLECTIONS.businesses,
      normalizedCollections,
    ).map(normalizeBusiness),
    ["id"],
  );
  const normalizedMemberships = sortByFields(
    documentsForCollection(
      memberships,
      MEMBERSHIP_AUTHORITY_COLLECTIONS.memberships,
      normalizedCollections,
    ).map(normalizeMembership),
    ["id"],
  );

  const normalizedIndexes = membershipsPresent
    ? (indexes ?? [])
        .map(normalizeIndex)
        .sort((left, right) =>
          compareText(
            serializeCanonicalPayload(left),
            serializeCanonicalPayload(right),
          ),
        )
    : null;
  const normalizedDuplicatePairs = membershipsPresent
    ? (duplicatePairs ?? [])
        .map(normalizeDuplicatePair)
        .sort((left, right) =>
          compareText(
            pairKey(left.user, left.business),
            pairKey(right.user, right.business),
          ),
        )
    : null;

  return {
    databaseName,
    collections: normalizedCollections,
    users: usersPresent ? normalizedUsers : null,
    businesses: businessesPresent ? normalizedBusinesses : null,
    memberships: membershipsPresent ? normalizedMemberships : null,
    indexes: normalizedIndexes,
    duplicatePairs: normalizedDuplicatePairs,
  };
};

export const fingerprintMembershipAuthoritySource = (snapshot) =>
  checksumCanonicalPayload(buildMembershipAuthoritySourcePayload(snapshot));

export const buildMembershipAuthorityPayload = ({
  databaseName,
  collectionState,
  snapshotConsistency,
  indexes = [],
  users = [],
  businesses = [],
  memberships = [],
  duplicatePairs,
}) => {
  if (!databaseName || typeof databaseName !== "string") {
    throw new TypeError("databaseName es obligatorio para construir el audit");
  }

  const normalizedCollections = normalizeCollectionState(collectionState);
  const normalizedConsistency = normalizeSnapshotConsistency(snapshotConsistency);
  const usersPresent = normalizedCollections.observed.includes(
    MEMBERSHIP_AUTHORITY_COLLECTIONS.users,
  );
  const businessesPresent = normalizedCollections.observed.includes(
    MEMBERSHIP_AUTHORITY_COLLECTIONS.businesses,
  );
  const membershipsPresent = normalizedCollections.observed.includes(
    MEMBERSHIP_AUTHORITY_COLLECTIONS.memberships,
  );
  const normalizedUsers = sortByFields(
    documentsForCollection(
      users,
      MEMBERSHIP_AUTHORITY_COLLECTIONS.users,
      normalizedCollections,
    ).map(normalizeUser),
    ["id"],
  );
  const normalizedBusinesses = sortByFields(
    documentsForCollection(
      businesses,
      MEMBERSHIP_AUTHORITY_COLLECTIONS.businesses,
      normalizedCollections,
    ).map(normalizeBusiness),
    ["id"],
  );
  const normalizedMemberships = sortByFields(
    documentsForCollection(
      memberships,
      MEMBERSHIP_AUTHORITY_COLLECTIONS.memberships,
      normalizedCollections,
    ).map(normalizeMembership),
    ["id"],
  );

  const usersById = new Map(normalizedUsers.map((user) => [user.id, user]));
  const businessesById = new Map(
    normalizedBusinesses.map((business) => [business.id, business]),
  );
  const membershipsByPair = new Map();
  const membershipsByUser = new Map();
  const findings = [];
  const candidates = [];

  for (const collection of normalizedCollections.missing) {
    findings.push(
      finding("missingRequiredCollection", true, {
        collection,
      }),
    );
  }

  if (!normalizedConsistency.consistent) {
    findings.push(
      finding("snapshotInconsistency", true, {
        reason: "sourceReadsDisagree",
      }),
    );
  }

  const indexState = inspectMembershipIndexes(membershipsPresent ? indexes ?? [] : []);
  if (!indexState.exactUniqueExists) {
    findings.push(
      finding("missingUniqueMembershipIndex", true, {
        reason: "exactPhysicalIndexMissing",
      }),
    );
  }

  for (const membership of normalizedMemberships) {
    const key = pairKey(membership.user, membership.business);
    const pairMemberships = membershipsByPair.get(key) ?? [];
    pairMemberships.push(membership);
    membershipsByPair.set(key, pairMemberships);

    const userMemberships = membershipsByUser.get(membership.user) ?? [];
    userMemberships.push(membership);
    membershipsByUser.set(membership.user, userMemberships);

    const missingReferences = [];
    if (!usersById.has(membership.user)) missingReferences.push("user");
    if (!businessesById.has(membership.business)) missingReferences.push("business");

    if (missingReferences.length > 0) {
      findings.push(
        finding("orphanMembership", true, {
          membership: membership.id,
          user: membership.user,
          business: membership.business,
          missingReferences,
        }),
      );
    }

    if (membership.role === "superadmin") {
      findings.push(
        finding("platformRoleInMembership", true, {
          membership: membership.id,
          user: membership.user,
          business: membership.business,
        }),
      );
    } else if (!LEGACY_TENANT_ROLES.has(membership.role)) {
      findings.push(
        finding("unknownMembershipRole", true, {
          membership: membership.id,
          user: membership.user,
          business: membership.business,
          role: membership.role,
        }),
      );
    }
  }

  const derivedDuplicatePairs = [...membershipsByPair.values()]
    .filter(
      (pairMemberships) =>
        pairMemberships.length > 1 &&
        pairMemberships[0].user !== null &&
        pairMemberships[0].business !== null,
    )
    .map((pairMemberships) => ({
      user: pairMemberships[0].user,
      business: pairMemberships[0].business,
      memberships: pairMemberships
        .map((membership) => membership.id)
        .sort(compareText),
      count: pairMemberships.length,
    }))
    .sort((left, right) =>
      compareText(pairKey(left.user, left.business), pairKey(right.user, right.business)),
    );

  const independentlyDetectedDuplicatePairs = membershipsPresent
    ? (
        duplicatePairs === undefined
          ? derivedDuplicatePairs
          : duplicatePairs.map(normalizeDuplicatePair)
      ).sort((left, right) =>
        compareText(
          pairKey(left.user, left.business),
          pairKey(right.user, right.business),
        ),
      )
    : [];

  const duplicatePairsByKey = new Map();
  for (const duplicate of [
    ...derivedDuplicatePairs,
    ...independentlyDetectedDuplicatePairs,
  ]) {
    duplicatePairsByKey.set(pairKey(duplicate.user, duplicate.business), duplicate);
  }

  for (const duplicate of duplicatePairsByKey.values()) {
    findings.push(finding("duplicateMembership", true, duplicate));
  }

  const duplicateScansAgree = membershipsPresent
    ? serializeCanonicalPayload(derivedDuplicatePairs) ===
      serializeCanonicalPayload(independentlyDetectedDuplicatePairs)
    : null;
  if (duplicateScansAgree === false) {
    findings.push(
      finding("snapshotInconsistency", true, {
        reason: "duplicateScansDisagree",
      }),
    );
  }

  for (const [userId, userMemberships] of membershipsByUser.entries()) {
    if (userMemberships.length > 1) {
      findings.push(
        finding("multipleMemberships", false, {
          user: userId,
          memberships: userMemberships.map((membership) => membership.id).sort(),
          count: userMemberships.length,
        }),
      );
    }
  }

  for (const user of normalizedUsers) {
    if (!KNOWN_GLOBAL_ROLES.has(user.role)) {
      findings.push(
        finding("unknownLegacyRole", true, {
          user: user.id,
          business: user.business,
          role: user.role,
        }),
      );
      continue;
    }

    if (user.role === "user") {
      if (user.business !== null) {
        findings.push(
          finding("legacyClientScope", false, {
            user: user.id,
            business: user.business,
          }),
        );
      }
      continue;
    }

    if (!LEGACY_TENANT_ROLES.has(user.role)) continue;

    const businessReferenceIsValid = isObjectId(user.business);
    const referencedBusiness = businessReferenceIsValid
      ? businessesById.get(user.business)
      : null;

    if (!businessReferenceIsValid || !referencedBusiness) {
      findings.push(
        finding("missingBusinessReference", true, {
          user: user.id,
          business: user.business,
          reason: businessReferenceIsValid
            ? "referencedBusinessMissing"
            : user.business === null
              ? "legacyBusinessMissing"
              : "legacyBusinessInvalid",
        }),
      );
    }

    if (!user.isActive) {
      findings.push(
        finding("inactiveIdentity", true, {
          user: user.id,
          business: user.business,
          role: user.role,
        }),
      );
    }

    if (!businessReferenceIsValid || !referencedBusiness || !user.isActive) continue;

    const pairMemberships = membershipsByPair.get(pairKey(user.id, user.business)) ?? [];
    if (pairMemberships.length > 1) continue;

    if (pairMemberships.length === 0) {
      const activeMembershipsBefore = (membershipsByUser.get(user.id) ?? []).filter(
        (membership) => membership.isActive,
      ).length;
      const candidate = {
        user: user.id,
        business: user.business,
        role: user.role,
        isActive: true,
        legacyEvidence: {
          userBusiness: user.business,
          userRole: user.role,
          userIsActive: user.isActive,
        },
        loginOutcomeBefore: loginOutcome(activeMembershipsBefore),
        loginOutcomeAfter: loginOutcome(activeMembershipsBefore + 1),
      };
      candidates.push(candidate);
      findings.push(
        finding("eligibleBackfill", false, {
          user: user.id,
          business: user.business,
          role: user.role,
        }),
      );
      continue;
    }

    const existing = pairMemberships[0];
    if (existing.role !== user.role) {
      findings.push(
        finding("roleConflict", true, {
          membership: existing.id,
          user: user.id,
          business: user.business,
          legacyRole: user.role,
          membershipRole: existing.role,
        }),
      );
      continue;
    }

    if (!existing.isActive) {
      findings.push(
        finding("membershipStateConflict", true, {
          membership: existing.id,
          user: user.id,
          business: user.business,
          legacyIsActive: user.isActive,
          membershipIsActive: existing.isActive,
        }),
      );
      continue;
    }

    findings.push(
      finding("alreadyConsistent", false, {
        membership: existing.id,
        user: user.id,
        business: user.business,
        role: user.role,
      }),
    );
  }

  const candidateKeys = new Set(
    candidates.map((candidate) => pairKey(candidate.user, candidate.business)),
  );

  for (const business of normalizedBusinesses) {
    if (business.owner === null) continue;

    const owner = usersById.get(business.owner);
    const ownerMemberships =
      membershipsByPair.get(pairKey(business.owner, business.id)) ?? [];
    const hasActiveAdminMembership = ownerMemberships.some(
      (membership) => membership.role === "admin" && membership.isActive,
    );

    if (hasActiveAdminMembership) continue;

    const hasExactLegacyEvidence =
      owner?.isActive === true &&
      owner.role === "admin" &&
      owner.business === business.id &&
      candidateKeys.has(pairKey(owner.id, business.id));

    findings.push(
      finding("ownerWithoutAdminMembership", !hasExactLegacyEvidence, {
        user: business.owner,
        business: business.id,
        reason: hasExactLegacyEvidence
          ? "eligibleByExactLegacyEvidence"
          : owner
            ? "insufficientOrContradictoryLegacyEvidence"
            : "ownerIdentityMissing",
      }),
    );
  }

  const sortedFindings = canonicalFindingSort(findings);
  const categoryCounts = Object.fromEntries(
    AUDIT_CATEGORIES.map((category) => [
      category,
      sortedFindings.filter((entry) => entry.category === category).length,
    ]),
  );
  const safeToApply = !sortedFindings.some((entry) => entry.blocking);

  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    databaseName,
    preconditions: {
      collections: normalizedCollections,
      snapshotConsistency: normalizedConsistency,
      membershipUniqueIndex: indexState,
      duplicateScan: {
        performed: membershipsPresent,
        independentlyDetectedPairs: membershipsPresent
          ? independentlyDetectedDuplicatePairs
          : null,
        derivedPairs: membershipsPresent ? derivedDuplicatePairs : null,
        consistent: duplicateScansAgree,
      },
      duplicatePairCount: membershipsPresent ? duplicatePairsByKey.size : null,
    },
    counts: {
      users: usersPresent ? normalizedUsers.length : null,
      businesses: businessesPresent ? normalizedBusinesses.length : null,
      memberships: membershipsPresent ? normalizedMemberships.length : null,
      candidates: candidates.length,
      findings: sortedFindings.length,
    },
    sources: {
      users: usersPresent ? normalizedUsers : null,
      businesses: businessesPresent ? normalizedBusinesses : null,
      memberships: membershipsPresent ? normalizedMemberships : null,
    },
    candidates: canonicalCandidateSort(candidates),
    findings: sortedFindings,
    categoryCounts,
    safeToApply,
  };
};

export const buildMembershipAuthorityReport = (snapshot, metadata = {}) => {
  const canonicalPayload = buildMembershipAuthorityPayload(snapshot);

  return {
    canonicalPayload,
    checksum: {
      algorithm: "sha256",
      value: checksumCanonicalPayload(canonicalPayload),
    },
    metadata: withoutUndefined(metadata),
  };
};

const sessionOption = (session) => (session ? { session } : {});

const listCollectionNames = async (db, session) => {
  const collections = await db
    .listCollections({}, { nameOnly: true, ...sessionOption(session) })
    .toArray();
  return collections.map((collection) => collection.name).sort(compareText);
};

const readCollection = async (
  db,
  collectionNames,
  name,
  projection,
  session,
) => {
  if (!collectionNames.has(name)) return null;
  return db
    .collection(name)
    .find({}, { projection, ...sessionOption(session) })
    .sort({ _id: 1 })
    .toArray();
};

const readDuplicateMembershipPairs = async (
  db,
  collectionNames,
  name,
  session,
) => {
  if (!collectionNames.has(name)) return null;

  return db
    .collection(name)
    .aggregate([
      {
        $group: {
          _id: {
            user: "$user",
            business: "$business",
          },
          memberships: { $push: "$_id" },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { "_id.user": 1, "_id.business": 1 } },
    ], sessionOption(session))
    .toArray();
};

const readMembershipAuthoritySource = async (db, session) => {
  if (!db?.databaseName) {
    throw new TypeError("Se requiere una conexión MongoDB con databaseName");
  }

  const observedCollectionNames = await listCollectionNames(db, session);
  const names = new Set(observedCollectionNames);
  const { users, businesses, memberships } = MEMBERSHIP_AUTHORITY_COLLECTIONS;

  const userDocuments = await readCollection(
    db,
    names,
    users,
    {
      _id: 1,
      business: 1,
      role: 1,
      isActive: 1,
    },
    session,
  );
  const businessDocuments = await readCollection(
    db,
    names,
    businesses,
    {
      _id: 1,
      owner: 1,
      isActive: 1,
    },
    session,
  );
  const membershipDocuments = await readCollection(
    db,
    names,
    memberships,
    {
      _id: 1,
      user: 1,
      business: 1,
      role: 1,
      isActive: 1,
    },
    session,
  );
  const indexes = names.has(memberships)
    ? await db
        .collection(memberships)
        .listIndexes(sessionOption(session))
        .toArray()
    : null;
  const duplicatePairs = await readDuplicateMembershipPairs(
    db,
    names,
    memberships,
    session,
  );

  return {
    databaseName: db.databaseName,
    collectionState: {
      observed: observedCollectionNames,
    },
    indexes,
    users: userDocuments,
    businesses: businessDocuments,
    memberships: membershipDocuments,
    duplicatePairs,
  };
};

const SNAPSHOT_UNSUPPORTED_CODES = new Set([20, 72, 115, 263, 303]);
const SNAPSHOT_UNSUPPORTED_CODE_NAMES = new Set([
  "CommandNotSupported",
  "IllegalOperation",
  "InvalidOptions",
  "OperationNotSupportedInTransaction",
]);

export const isSnapshotReadUnsupported = (error) => {
  if (!error) return false;
  if (SNAPSHOT_UNSUPPORTED_CODES.has(error.code)) return true;
  if (SNAPSHOT_UNSUPPORTED_CODE_NAMES.has(error.codeName)) return true;

  return /(?:read concern|snapshot).*(?:not supported|only supported)|replica set member|mongos|standalone/iu.test(
    String(error.message ?? ""),
  );
};

const attachSnapshotConsistency = (snapshot, firstFingerprint, secondFingerprint) => ({
  ...snapshot,
  snapshotConsistency: {
    consistent: firstFingerprint === secondFingerprint,
    firstFingerprint,
    secondFingerprint,
  },
});

const readWithSnapshotSession = async (db, startSession) => {
  let session;
  try {
    session = await startSession({
      snapshot: true,
      causalConsistency: false,
    });
    const snapshot = await readMembershipAuthoritySource(db, session);
    const fingerprint = fingerprintMembershipAuthoritySource(snapshot);
    return {
      snapshot: attachSnapshotConsistency(snapshot, fingerprint, fingerprint),
      readStrategy: "snapshot",
    };
  } finally {
    if (session) await session.endSession();
  }
};

const readWithDoubleRead = async (db) => {
  const first = await readMembershipAuthoritySource(db);
  const second = await readMembershipAuthoritySource(db);
  const firstFingerprint = fingerprintMembershipAuthoritySource(first);
  const secondFingerprint = fingerprintMembershipAuthoritySource(second);

  return {
    snapshot: attachSnapshotConsistency(
      second,
      firstFingerprint,
      secondFingerprint,
    ),
    readStrategy: "double-read",
  };
};

export const readMembershipAuthoritySnapshot = async (
  db,
  { startSession = db?.client?.startSession?.bind(db.client) } = {},
) => {
  if (startSession) {
    try {
      return await readWithSnapshotSession(db, startSession);
    } catch (error) {
      if (!isSnapshotReadUnsupported(error)) throw error;
    }
  }

  return readWithDoubleRead(db);
};
