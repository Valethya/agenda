import * as businessConfigRepository from "../repositories/businessConfig.repository.js";
import * as businessRepository from "../repositories/business.repository.js";
import { DEFAULT_SLOT_DURATION_MINUTES } from "../config/businessConfig.defaults.js";
import { NotFoundError } from "../utils/appError.js";
import { serializePublicWebState } from "../security/publicWebState.js";

// Datos por defecto para inicializar la configuración si la DB está vacía.
// slotDuration se comparte con schema + Availability mediante un único default.
const createDefaults = (businessName = "Agenda") => {
  const workingHours = [];

  // Lunes a Viernes abierto (1 a 5)
  for (let day = 1; day <= 5; day++) {
    workingHours.push({
      dayOfWeek: day,
      isOpen: true,
      startTime: "09:00",
      endTime: "18:00",
      breaks: [{ startTime: "13:00", endTime: "14:00" }],
    });
  }

  // Sábado y Domingo cerrado (6 y 0)
  for (let day of [0, 6]) {
    workingHours.push({
      dayOfWeek: day,
      isOpen: false,
      startTime: "09:00",
      endTime: "18:00",
      breaks: [],
    });
  }

  return {
    businessName,
    workingHours,
    appointmentSettings: {
      slotDuration: DEFAULT_SLOT_DURATION_MINUTES,
      bufferTime: 0,
      minAdvanceHours: 2,
      maxAdvanceDays: 30,
      autoConfirmLocalBookings: false,
    },
    cancellationSettings: {
      allowCancellation: true,
      limitHours: 2,
    },
    paymentSettings: {
      requireDeposit: false,
      depositType: "percentage",
      depositValue: 0,
    },
    emailSettings: {
      brandColor: "#4F46E5",
      logoUrl: "",
      customFooter: "",
    },
    uiSettings: {
      professionalRoleLabel: "Profesional",
      professionalRoleLabelPlural: "Profesionales",
      enabledNavItems: ["calendario", "horarios", "clientes", "servicios", "equipo", "reportes"],
    },
    publicWeb: null,
  };
};

const asBusinessSummary = (business) => {
  if (!business) return null;
  return {
    _id: business._id,
    name: business.name,
    slug: business.slug,
  };
};

const serializeWorkingHours = (workingHours = []) => workingHours.map((entry) => ({
  dayOfWeek: entry.dayOfWeek,
  isOpen: entry.isOpen,
  startTime: entry.startTime,
  endTime: entry.endTime,
  breaks: (entry.breaks || []).map((item) => ({
    startTime: item.startTime,
    endTime: item.endTime,
  })),
}));

// GET /business-settings devuelve siempre este DTO estable; detalles físicos de
// Mongoose (_id de subdocs, timestamps, existencia del documento) no cambian la forma.
// publicWeb expone sólo la proyección operacional segura: nunca challengeHash,
// raw secret, attemptGeneration ni authorityFence.
const serializeConfigPayload = (config) => ({
  businessName: config.businessName,
  business: asBusinessSummary(config.business),
  workingHours: serializeWorkingHours(config.workingHours),
  appointmentSettings: {
    slotDuration: config.appointmentSettings?.slotDuration ?? DEFAULT_SLOT_DURATION_MINUTES,
    bufferTime: config.appointmentSettings?.bufferTime ?? 0,
    minAdvanceHours: config.appointmentSettings?.minAdvanceHours ?? 2,
    maxAdvanceDays: config.appointmentSettings?.maxAdvanceDays ?? 30,
    autoConfirmLocalBookings: config.appointmentSettings?.autoConfirmLocalBookings ?? false,
  },
  cancellationSettings: {
    allowCancellation: config.cancellationSettings?.allowCancellation ?? true,
    limitHours: config.cancellationSettings?.limitHours ?? 2,
  },
  paymentSettings: {
    requireDeposit: config.paymentSettings?.requireDeposit ?? false,
    depositType: config.paymentSettings?.depositType ?? "percentage",
    depositValue: config.paymentSettings?.depositValue ?? 0,
  },
  emailSettings: {
    brandColor: config.emailSettings?.brandColor ?? "#4F46E5",
    logoUrl: config.emailSettings?.logoUrl ?? "",
    customFooter: config.emailSettings?.customFooter ?? "",
  },
  uiSettings: {
    professionalRoleLabel: config.uiSettings?.professionalRoleLabel ?? "Profesional",
    professionalRoleLabelPlural: config.uiSettings?.professionalRoleLabelPlural ?? "Profesionales",
    enabledNavItems: config.uiSettings?.enabledNavItems
      ?? ["calendario", "horarios", "clientes", "servicios", "equipo", "reportes"],
  },
  publicWeb: serializePublicWebState(config.publicWeb),
});

// GET/read path: devuelve una proyección de defaults si aún no existe documento,
// pero no materializa BusinessConfig. La persistencia sólo ocurre en un comando.
export const getConfigOrDefaults = async (businessId) => {
  const config = await businessConfigRepository.getConfig(businessId);
  if (config) return serializeConfigPayload(config);

  const business = await businessRepository.findById(businessId);
  if (!business) throw new NotFoundError("El negocio asociado a la configuración no existe");

  return serializeConfigPayload({
    ...createDefaults(business.name),
    business: asBusinessSummary(business),
  });
};

export const getOrInitializeConfig = async (businessId) => {
  let config = await businessConfigRepository.getConfig(businessId);

  if (!config) {
    // Inicialización explícita desde un comando que realmente necesita persistencia.
    const business = await businessRepository.findById(businessId);
    if (!business) throw new NotFoundError("El negocio asociado a la configuración no existe");
    const defaults = createDefaults(business.name);
    defaults.business = businessId;
    config = await businessConfigRepository.createDefaultConfig(defaults);
  }

  return config;
};

export const updateConfig = async (businessId, updateData) => {
  const config = await getOrInitializeConfig(businessId);
  const normalizedUpdate = { ...updateData };

  // appointmentSettings es un patch parcial por contrato. Conservar el snapshot
  // existente evita que modificar bufferTime u otro campo cambie slotDuration.
  if (updateData.appointmentSettings) {
    normalizedUpdate.appointmentSettings = {
      slotDuration: config.appointmentSettings?.slotDuration ?? DEFAULT_SLOT_DURATION_MINUTES,
      bufferTime: config.appointmentSettings?.bufferTime ?? 0,
      minAdvanceHours: config.appointmentSettings?.minAdvanceHours ?? 2,
      maxAdvanceDays: config.appointmentSettings?.maxAdvanceDays ?? 30,
      autoConfirmLocalBookings: config.appointmentSettings?.autoConfirmLocalBookings ?? false,
      ...updateData.appointmentSettings,
    };
  }

  return await businessConfigRepository.updateConfig(config._id, normalizedUpdate);
};
