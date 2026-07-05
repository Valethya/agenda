import mongoose from "mongoose";
import User from "../db/models/user.model.js";
import Appointment from "../db/models/appointment.model.js";
import Payment from "../db/models/payment.model.js";
import Holiday from "../db/models/holiday.model.js";
import Business from "../db/models/business.model.js";
import { getOrInitializeConfig } from "./businessConfig.service.js";
import { createHash } from "../utils/password.js";
import { ConflictError, NotFoundError } from "../utils/appError.js";

export const getGlobalMetrics = async (businessId) => {
  const matchPayment = { status: "approved" };
  const matchUser = {};
  const matchAppointment = {};
  const matchTopServices = { status: { $ne: "cancelled" } };

  if (businessId) {
    const bId = new mongoose.Types.ObjectId(businessId);
    matchPayment.business = bId;
    matchUser.business = bId;
    matchAppointment.business = bId;
    matchTopServices.business = bId;
  }

  // Estadísticas financieras
  const paymentStats = await Payment.aggregate([
    { $match: matchPayment },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: "$amount" },
        totalTransactions: { $sum: 1 },
        averageTicket: { $avg: "$amount" },
      },
    },
  ]);

  const financialMetrics = paymentStats[0] || {
    totalRevenue: 0,
    totalTransactions: 0,
    averageTicket: 0,
  };

  // Distribución de usuarios por rol
  const userStatsStages = [];
  if (businessId) {
    userStatsStages.push({ $match: matchUser });
  }
  const userStats = await User.aggregate([
    ...userStatsStages,
    {
      $group: {
        _id: "$role",
        count: { $sum: 1 },
      },
    },
  ]);

  const userMetrics = {
    totalUsers: userStats.reduce((acc, curr) => acc + curr.count, 0),
    breakdown: userStats.reduce((acc, curr) => {
      acc[curr._id] = curr.count;
      return acc;
    }, { admin: 0, worker: 0, user: 0, superadmin: 0 }),
  };

  // Distribución de citas por estado
  const appointmentStatsStages = [];
  if (businessId) {
    appointmentStatsStages.push({ $match: matchAppointment });
  }
  const appointmentStats = await Appointment.aggregate([
    ...appointmentStatsStages,
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
  ]);

  const appointmentMetrics = {
    totalAppointments: appointmentStats.reduce((acc, curr) => acc + curr.count, 0),
    breakdown: appointmentStats.reduce((acc, curr) => {
      acc[curr._id] = curr.count;
      return acc;
    }, { pending_payment: 0, pending: 0, confirmed: 0, cancelled: 0, completed: 0 }),
  };

  // Servicios más demandados (Top 5)
  const topServices = await Appointment.aggregate([
    { $match: matchTopServices },
    {
      $group: {
        _id: "$service",
        bookingsCount: { $sum: 1 },
      },
    },
    { $sort: { bookingsCount: -1 } },
    { $limit: 5 },
    {
      $lookup: {
        from: "services",
        localField: "_id",
        foreignField: "_id",
        as: "serviceDetail",
      },
    },
    { $unwind: "$serviceDetail" },
    {
      $project: {
        _id: 1,
        name: "$serviceDetail.name",
        price: "$serviceDetail.price",
        bookingsCount: 1,
      },
    },
  ]);

  return {
    finances: financialMetrics,
    users: userMetrics,
    appointments: appointmentMetrics,
    topServices,
  };
};

// 2. Obtener análisis avanzado (concurrencia horaria, días concurridos, tendencias y feriados)
export const getAdvancedAnalytics = async (businessId) => {
  const matchStage = {};
  if (businessId) {
    matchStage.business = new mongoose.Types.ObjectId(businessId);
  }

  // A. Concurrencia horaria en el día (Horas con más y menos citas)
  const hourlyConcurrency = await Appointment.aggregate([
    { $match: { status: { $ne: "cancelled" }, ...matchStage } },
    {
      $group: {
        _id: "$startTime",
        totalBookings: { $sum: 1 },
      },
    },
    { $sort: { totalBookings: -1 } },
  ]);

  // B. Días de la semana más y menos concurridos
  const dayOfWeekConcurrency = await Appointment.aggregate([
    { $match: { status: { $ne: "cancelled" }, ...matchStage } },
    {
      $group: {
        _id: { $dayOfWeek: "$date" }, // 1 = Domingo, 2 = Lunes, ...
        totalBookings: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const daysMap = {
    1: "Domingo",
    2: "Lunes",
    3: "Martes",
    4: "Miércoles",
    5: "Jueves",
    6: "Viernes",
    7: "Sábado",
  };

  const dayOfWeekStats = dayOfWeekConcurrency.map((item) => ({
    day: daysMap[item._id] || `Día ${item._id}`,
    totalBookings: item.totalBookings,
  }));

  // C. Distribución mensual (Meses del año)
  const monthlyTrends = await Appointment.aggregate([
    { $match: { status: { $ne: "cancelled" }, ...matchStage } },
    {
      $group: {
        _id: { $month: "$date" }, // 1 a 12
        totalBookings: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const monthsMap = {
    1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril", 5: "Mayo", 6: "Junio",
    7: "Julio", 8: "Agosto", 9: "Septiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre",
  };

  const monthlyStats = monthlyTrends.map((item) => ({
    month: monthsMap[item._id] || `Mes ${item._id}`,
    totalBookings: item.totalBookings,
  }));

  // D. Tendencia semanal del año (Semanas 1-53)
  const weeklyTrends = await Appointment.aggregate([
    { $match: { status: { $ne: "cancelled" }, ...matchStage } },
    {
      $group: {
        _id: { $week: "$date" },
        totalBookings: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const weeklyStats = weeklyTrends.map((item) => ({
    weekNumber: item._id,
    totalBookings: item.totalBookings,
  }));

  // E. Correlación con días feriados (Vísperas de Feriados vs Días Normales)
  const holidays = await Holiday.find();
  let holidayCorrelationStats = {
    hasHolidaysConfigured: holidays.length > 0,
    averageOnNormalDays: 0,
    averageOnHolidays: 0,
    averageOnHolidayEves: 0,
  };

  if (holidays.length > 0) {
    const holidayDates = holidays.map((h) => {
      const d = new Date(h.date);
      d.setUTCHours(0, 0, 0, 0);
      return d;
    });

    const eveDates = holidays.map((h) => {
      const d = new Date(h.date);
      d.setUTCDate(d.getUTCDate() - 1); // Día anterior (Víspera)
      d.setUTCHours(0, 0, 0, 0);
      return d;
    });

    const dailyBookings = await Appointment.aggregate([
      { $match: { status: { $ne: "cancelled" }, ...matchStage } },
      {
        $group: {
          _id: {
            $dateFromParts: {
              year: { $year: "$date" },
              month: { $month: "$date" },
              day: { $dayOfMonth: "$date" },
            },
          },
          count: { $sum: 1 },
        },
      },
    ]);

    let holidaySum = 0, holidayCount = 0;
    let eveSum = 0, eveCount = 0;
    let normalSum = 0, normalCount = 0;

    dailyBookings.forEach((day) => {
      const dayTime = new Date(day._id).getTime();

      const isHoliday = holidayDates.some((h) => h.getTime() === dayTime);
      const isEve = eveDates.some((e) => e.getTime() === dayTime);

      if (isHoliday) {
        holidaySum += day.count;
        holidayCount++;
      } else if (isEve) {
        eveSum += day.count;
        eveCount++;
      } else {
        normalSum += day.count;
        normalCount++;
      }
    });

    holidayCorrelationStats = {
      hasHolidaysConfigured: true,
      averageOnNormalDays: normalCount > 0 ? parseFloat((normalSum / normalCount).toFixed(2)) : 0,
      averageOnHolidays: holidayCount > 0 ? parseFloat((holidaySum / holidayCount).toFixed(2)) : 0,
      averageOnHolidayEves: eveCount > 0 ? parseFloat((eveSum / eveCount).toFixed(2)) : 0,
      sampleDetails: {
        normalDaysCounted: normalCount,
        holidaysCounted: holidayCount,
        holidayEvesCounted: eveCount,
      },
    };
  }

  return {
    hourlyConcurrency,
    dayOfWeekConcurrency: dayOfWeekStats,
    monthlyTrends: monthlyStats,
    weeklyTrends: weeklyStats,
    holidayCorrelation: holidayCorrelationStats,
  };
};

// 3. Crear un negocio (con su respectiva cuenta de dueño Admin y BusinessConfig semilla)
export const createBusiness = async (businessData) => {
  const { name, slug, ownerEmail, ownerPassword, ownerFirstName, ownerLastName, ownerPhone } = businessData;

  const normalizedSlug = slug.toLowerCase().trim();

  // Validar si el slug ya existe
  const existingBusiness = await Business.findOne({ slug: normalizedSlug });
  if (existingBusiness) {
    throw new ConflictError("Ya existe un negocio registrado con este slug");
  }

  // Validar si el email del administrador ya existe
  const existingUser = await User.findOne({ email: ownerEmail });
  if (existingUser) {
    throw new ConflictError("El correo electrónico del administrador ya está registrado");
  }

  // A. Crear el negocio
  const business = await Business.create({
    name,
    slug: normalizedSlug,
    isActive: true,
  });

  // B. Encriptar contraseña y crear usuario Admin
  const hashedPassword = await createHash(ownerPassword);
  const owner = await User.create({
    firstName: ownerFirstName || "Administrador",
    lastName: ownerLastName || "Negocio",
    email: ownerEmail,
    password: hashedPassword,
    role: "admin",
    phone: ownerPhone || "",
    business: business._id,
  });

  // C. Vincular dueño en el negocio
  business.owner = owner._id;
  await business.save();

  // D. Inicializar BusinessConfig semilla para el negocio
  await getOrInitializeConfig(business._id);

  return {
    business,
    owner: {
      id: owner._id,
      firstName: owner.firstName,
      lastName: owner.lastName,
      email: owner.email,
    }
  };
};

// 4. Listar todos los negocios
export const listBusinesses = async () => {
  return await Business.find().populate("owner", "firstName lastName email phone");
};

// 5. Activar/Desactivar un negocio
export const toggleBusinessStatus = async (id) => {
  const business = await Business.findById(id);
  if (!business) {
    throw new NotFoundError("El negocio especificado no existe");
  }

  business.isActive = !business.isActive;
  await business.save();

  return business;
};
