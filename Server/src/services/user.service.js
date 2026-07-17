import * as userRepository from "../repositories/user.repository.js";
import * as shiftRepository from "../repositories/shift.repository.js";
import { createHash } from "../utils/password.js";
import { ConflictError, NotFoundError } from "../utils/appError.js";
import * as membershipRepository from "../repositories/membership.repository.js";

// 1. Crear Cuenta de Trabajador (o agregar membresía a un usuario existente)
export const createWorker = async (workerData, businessId) => {
  const { firstName, lastName, email, password, phone } = workerData;

  // A. Verificar si el usuario ya existe en el sistema
  const existingUser = await userRepository.findByEmail(email);
  let workerUser = existingUser;

  if (existingUser) {
    // Si ya existe, verificar si ya tiene una membresía en este negocio
    const existingMembership = await membershipRepository.findByUserAndBusiness(existingUser._id, businessId);
    if (existingMembership) {
      throw new ConflictError("El profesional ya está registrado en este negocio");
    }
  } else {
    // B. Encriptar contraseña del trabajador
    const hashedPassword = await createHash(password);

    // C. Crear el usuario en base de datos con rol 'worker' por defecto
    workerUser = await userRepository.createUser({
      firstName,
      lastName,
      email: [email],
      password: hashedPassword,
      phone: phone ? [phone] : [],
      role: "worker",
      isActive: true,
      business: businessId,
    });
  }

  // D. Crear la membresía de tipo 'worker' para asociar el usuario al negocio
  await membershipRepository.create({
    user: workerUser._id,
    business: businessId,
    role: "worker",
    isActive: true,
  });

  // E. PRESTACIÓN PREMIUM: Inicializar horarios semanales estándar por defecto (Lunes a Viernes de 09:00 a 18:00)
  // Solo los creamos si el usuario no poseía turnos previamente configurados
  const existingShifts = await shiftRepository.findByWorker(workerUser._id);
  if (!existingShifts || existingShifts.length === 0) {
    const defaultBreaks = [{ startTime: "13:00", endTime: "14:00" }]; // Almuerzo
    for (let day = 1; day <= 5; day++) {
      await shiftRepository.upsert(workerUser._id, day, {
        isOpen: true,
        startTime: "09:00",
        endTime: "18:00",
        breaks: defaultBreaks,
      });
    }

    // Inicializar fin de semana como CERRADO
    for (let day of [0, 6]) {
      await shiftRepository.upsert(workerUser._id, day, {
        isOpen: false,
        startTime: "09:00",
        endTime: "18:00",
        breaks: [],
      });
    }
  }

  return {
    id: workerUser._id,
    firstName: workerUser.firstName,
    lastName: workerUser.lastName,
    email: Array.isArray(workerUser.email) ? workerUser.email[0] : workerUser.email,
    phone: Array.isArray(workerUser.phone) ? workerUser.phone[0] : workerUser.phone,
    role: "worker",
  };
};

// 2. Dar de baja a un trabajador (Soft Delete en membresía)
export const deleteWorker = async (workerId, businessId, softDelete = true) => {
  const membership = await membershipRepository.findByUserBusinessAndRole(workerId, businessId, "worker");
  
  if (!membership) {
    throw new NotFoundError("El trabajador especificado no existe o no tiene ese rol en este negocio");
  }

  if (softDelete) {
    // Desactivamos la membresía en este negocio
    membership.isActive = false;
    await membershipRepository.save(membership);
  } else {
    // Eliminación física de la membresía
    await membershipRepository.deleteOne(membership);
    
    // Si no tiene más membresías activas en ningún otro negocio, desactivamos el usuario global
    const otherMembershipsCount = await membershipRepository.countByUser(workerId);
    if (otherMembershipsCount === 0) {
      await userRepository.updateUser(workerId, { isActive: false });
      await shiftRepository.deleteByWorker(workerId);
    }
  }
};

// 3. Obtener listado de trabajadores de un negocio mediante membresías
export const getWorkersList = async (businessId, onlyActive = true) => {
  const query = { business: businessId, role: "worker" };
  if (onlyActive) {
    query.isActive = true;
  }
  
  const memberships = await membershipRepository.findAll(query);
  
  return memberships
    .filter(m => m.user && (!onlyActive || m.user.isActive))
    .map(m => {
      const userObj = m.user.toObject();
      return {
        ...userObj,
        id: userObj._id,
        role: m.role, // Sobrescribir rol con el de la membresía específica de este negocio
      };
    });
};
