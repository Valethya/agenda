import * as userRepository from "../repositories/user.repository.js";
import * as shiftRepository from "../repositories/shift.repository.js";
import { createHash } from "../utils/password.js";
import { ConflictError, NotFoundError } from "../utils/appError.js";

// 1. Crear Cuenta de Trabajador
export const createWorker = async (workerData, businessId) => {
  const { firstName, lastName, email, password, phone } = workerData;

  // A. Verificar que el correo electrónico no esté registrado
  const existingUser = await userRepository.findByEmail(email);
  if (existingUser) {
    throw new ConflictError("El correo electrónico ingresado ya está registrado");
  }

  // B. Encriptar contraseña del trabajador
  const hashedPassword = await createHash(password);

  // C. Crear el usuario en base de datos con rol 'worker' y asociado a su negocio
  const newWorker = await userRepository.createUser({
    firstName,
    lastName,
    email: [email],
    password: hashedPassword,
    phone: phone ? [phone] : [],
    role: "worker",
    isActive: true,
    business: businessId,
  });

  // D. PRESTACIÓN PREMIUM: Inicializar horarios semanales estándar por defecto (Lunes a Viernes de 09:00 a 18:00)
  // Esto ahorra tiempo al administrador al no tener que configurar cada día de forma manual.
  const defaultBreaks = [{ startTime: "13:00", endTime: "14:00" }]; // Almuerzo
  for (let day = 1; day <= 5; day++) {
    await shiftRepository.upsert(newWorker._id, day, {
      isOpen: true,
      startTime: "09:00",
      endTime: "18:00",
      breaks: defaultBreaks,
    });
  }

  // Inicializar fin de semana como CERRADO
  for (let day of [0, 6]) {
    await shiftRepository.upsert(newWorker._id, day, {
      isOpen: false,
      startTime: "09:00",
      endTime: "18:00",
      breaks: [],
    });
  }

  return {
    id: newWorker._id,
    firstName: newWorker.firstName,
    lastName: newWorker.lastName,
    email: Array.isArray(newWorker.email) ? newWorker.email[0] : newWorker.email,
    phone: Array.isArray(newWorker.phone) ? newWorker.phone[0] : newWorker.phone,
    role: newWorker.role,
  };
};

// 2. Dar de baja a un trabajador (Soft Delete)
export const deleteWorker = async (workerId, softDelete = true) => {
  const worker = await userRepository.findAll({ _id: workerId, role: "worker" });
  
  if (!worker || worker.length === 0) {
    throw new NotFoundError("El trabajador especificado no existe o no tiene ese rol");
  }

  if (softDelete) {
    // Desactivamos la cuenta del trabajador (baja lógica)
    // De este modo se protegen los registros históricos de las citas ya realizadas con él
    await userRepository.updateUser(workerId, { isActive: false });
  } else {
    // Eliminación física e invalidación de sus turnos
    await userRepository.updateUser(workerId, { isActive: false }); // Opcional
    await shiftRepository.deleteByWorker(workerId);
    // Nota: Es mejor desaconsejar el hard delete por integridad referencial en MongoDB
  }
};

// 3. Obtener listado de trabajadores
export const getWorkersList = async (businessId, onlyActive = true) => {
  const query = { role: "worker", business: businessId };
  if (onlyActive) {
    query.isActive = true;
  }
  
  return await userRepository.findAll(query);
};
