import * as businessConfigRepository from "../repositories/businessConfig.repository.js";

// Datos por defecto para inicializar la configuración si la DB está vacía
const createDefaults = () => {
  const workingHours = [];
  
  // Lunes a Viernes abierto (1 a 5)
  for (let day = 1; day <= 5; day++) {
    workingHours.push({
      dayOfWeek: day,
      isOpen: true,
      startTime: "09:00",
      endTime: "18:00",
      breaks: [{ startTime: "13:00", endTime: "14:00" }], // Almuerzo
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
    businessName: "Mi Agenda de Servicios",
    workingHours,
    appointmentSettings: {
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
  };
};

export const getOrInitializeConfig = async (businessId) => {
  let config = await businessConfigRepository.getConfig(businessId);
  
  if (!config) {
    // Inicialización automática si es la primera ejecución
    const defaults = createDefaults();
    defaults.business = businessId; // Asociar con el negocio específico
    config = await businessConfigRepository.createDefaultConfig(defaults);
  }

  return config;
};

export const updateConfig = async (businessId, updateData) => {
  const config = await getOrInitializeConfig(businessId);
  return await businessConfigRepository.updateConfig(config._id, updateData);
};
