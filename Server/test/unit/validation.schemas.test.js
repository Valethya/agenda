import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  objectIdParamSchema,
  workerIdParamSchema,
  initiatePaymentSchema,
  webpayReturnSchema,
  createBusinessSchema,
  createWorkerSchema,
  googleLoginSchema,
  selectMembershipSchema,
  switchBusinessSchema,
  saveShiftSchema,
} from "../../src/validations/common.validation.js";

// --- Helper: parse debe lanzar ---
const expectFail = (schema, data, fieldSubstring) => {
  try {
    schema.parse(data);
    assert.fail("Debería haber lanzado un error de validación");
  } catch (err) {
    if (fieldSubstring) {
      const msg = JSON.stringify(err.issues || err.errors || err.message);
      assert.ok(
        msg.toLowerCase().includes(fieldSubstring.toLowerCase()),
        `Error esperado para '${fieldSubstring}', recibido: ${msg}`
      );
    }
  }
};

const expectPass = (schema, data) => {
  const result = schema.parse(data);
  assert.ok(result, "El schema debería parsear exitosamente");
  return result;
};

// ========================================================
// objectIdParamSchema
// ========================================================
describe("objectIdParamSchema", () => {
  it("acepta un ObjectId válido de 24 caracteres hex", () => {
    expectPass(objectIdParamSchema, { params: { id: "507f1f77bcf86cd799439011" } });
  });

  it("rechaza un ID con formato inválido", () => {
    expectFail(objectIdParamSchema, { params: { id: "invalid-id" } }, "ID inválido");
  });

  it("rechaza un ID demasiado corto", () => {
    expectFail(objectIdParamSchema, { params: { id: "507f1f" } }, "ID inválido");
  });

  it("rechaza params sin id", () => {
    expectFail(objectIdParamSchema, { params: {} }, "");
  });
});

// ========================================================
// workerIdParamSchema
// ========================================================
describe("workerIdParamSchema", () => {
  it("acepta un workerId válido", () => {
    expectPass(workerIdParamSchema, { params: { workerId: "507f1f77bcf86cd799439011" } });
  });

  it("rechaza un workerId inválido", () => {
    expectFail(workerIdParamSchema, { params: { workerId: "not-valid" } }, "ID inválido");
  });
});

// ========================================================
// initiatePaymentSchema
// ========================================================
describe("initiatePaymentSchema", () => {
  it("acepta payload válido con appointmentId y paymentType", () => {
    const result = expectPass(initiatePaymentSchema, {
      body: { appointmentId: "507f1f77bcf86cd799439011", paymentType: "full" },
    });
    assert.equal(result.body.paymentType, "full");
  });

  it("acepta payload sin paymentType (default deposit)", () => {
    const result = expectPass(initiatePaymentSchema, {
      body: { appointmentId: "507f1f77bcf86cd799439011" },
    });
    assert.equal(result.body.paymentType, "deposit");
  });

  it("rechaza appointmentId inválido", () => {
    expectFail(initiatePaymentSchema, {
      body: { appointmentId: "not-an-id", paymentType: "deposit" },
    }, "ID inválido");
  });

  it("rechaza paymentType inválido (enum)", () => {
    expectFail(initiatePaymentSchema, {
      body: { appointmentId: "507f1f77bcf86cd799439011", paymentType: "partial" },
    }, "invalid");
  });

  it("rechaza body sin appointmentId (campo obligatorio ausente)", () => {
    expectFail(initiatePaymentSchema, { body: {} }, "");
  });
});

// ========================================================
// webpayReturnSchema
// ========================================================
describe("webpayReturnSchema", () => {
  it("acepta callback normal con token_ws en body", () => {
    expectPass(webpayReturnSchema, {
      body: { token_ws: "abc123token" },
      query: {},
    });
  });

  it("acepta callback normal con token_ws en query", () => {
    expectPass(webpayReturnSchema, {
      body: {},
      query: { token_ws: "abc123token" },
    });
  });

  it("acepta callback abortado con TBK_TOKEN_WS en body", () => {
    expectPass(webpayReturnSchema, {
      body: { TBK_TOKEN_WS: "tbk-token", TBK_ORDEN_COMPRA: "order-123", TBK_ID_SESION: "sess-1" },
      query: {},
    });
  });

  it("acepta callback abortado con TBK_TOKEN_WS en query", () => {
    expectPass(webpayReturnSchema, {
      body: {},
      query: { TBK_TOKEN_WS: "tbk-token" },
    });
  });

  it("acepta slug en query junto con token_ws", () => {
    const result = expectPass(webpayReturnSchema, {
      body: {},
      query: { token_ws: "tok", slug: "mi-barberia" },
    });
    assert.equal(result.query.slug, "mi-barberia");
  });

  it("rechaza callback sin ningún token (body y query vacíos)", () => {
    expectFail(webpayReturnSchema, { body: {}, query: {} }, "token_ws");
  });

  it("rechaza callback completamente vacío", () => {
    expectFail(webpayReturnSchema, {}, "token_ws");
  });
});

// ========================================================
// createBusinessSchema
// ========================================================
describe("createBusinessSchema", () => {
  const validBusiness = {
    body: {
      name: "Mi Barbería",
      slug: "mi-barberia",
      ownerEmail: "admin@test.cl",
      ownerPassword: "123456",
    },
  };

  it("acepta payload válido completo", () => {
    expectPass(createBusinessSchema, validBusiness);
  });

  it("acepta con campos opcionales", () => {
    expectPass(createBusinessSchema, {
      body: { ...validBusiness.body, ownerFirstName: "Juan", ownerLastName: "Pérez", ownerPhone: "+56912345678" },
    });
  });

  it("rechaza slug con mayúsculas", () => {
    expectFail(createBusinessSchema, {
      body: { ...validBusiness.body, slug: "Mi-Barberia" },
    }, "slug");
  });

  it("rechaza slug con espacios", () => {
    expectFail(createBusinessSchema, {
      body: { ...validBusiness.body, slug: "mi barberia" },
    }, "slug");
  });

  it("rechaza email inválido", () => {
    expectFail(createBusinessSchema, {
      body: { ...validBusiness.body, ownerEmail: "not-an-email" },
    }, "correo");
  });

  it("rechaza contraseña menor a 6 caracteres", () => {
    expectFail(createBusinessSchema, {
      body: { ...validBusiness.body, ownerPassword: "123" },
    }, "6 caracteres");
  });

  it("rechaza sin nombre (campo obligatorio ausente)", () => {
    const { name, ...rest } = validBusiness.body;
    expectFail(createBusinessSchema, { body: rest }, "");
  });
});

// ========================================================
// createWorkerSchema
// ========================================================
describe("createWorkerSchema", () => {
  const validWorker = {
    body: {
      firstName: "Carlos",
      lastName: "López",
      email: "carlos@test.cl",
      password: "123456",
    },
  };

  it("acepta payload válido", () => {
    expectPass(createWorkerSchema, validWorker);
  });

  it("rechaza sin firstName (campo obligatorio)", () => {
    const { firstName, ...rest } = validWorker.body;
    expectFail(createWorkerSchema, { body: rest }, "");
  });

  it("rechaza email inválido", () => {
    expectFail(createWorkerSchema, {
      body: { ...validWorker.body, email: "not-email" },
    }, "correo");
  });
});

// ========================================================
// googleLoginSchema
// ========================================================
describe("googleLoginSchema", () => {
  it("acepta payload con idToken", () => {
    expectPass(googleLoginSchema, { body: { idToken: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..." } });
  });

  it("rechaza sin idToken (campo obligatorio)", () => {
    expectFail(googleLoginSchema, { body: {} }, "");
  });

  it("rechaza idToken vacío", () => {
    expectFail(googleLoginSchema, { body: { idToken: "" } }, "vacío");
  });
});

// ========================================================
// selectMembershipSchema / switchBusinessSchema
// ========================================================
describe("selectMembershipSchema", () => {
  it("acepta membershipId válido", () => {
    expectPass(selectMembershipSchema, { body: { membershipId: "507f1f77bcf86cd799439011" } });
  });

  it("rechaza membershipId inválido", () => {
    expectFail(selectMembershipSchema, { body: { membershipId: "bad" } }, "ID inválido");
  });
});

describe("switchBusinessSchema", () => {
  it("acepta businessId válido", () => {
    expectPass(switchBusinessSchema, { body: { businessId: "507f1f77bcf86cd799439011" } });
  });

  it("rechaza businessId inválido", () => {
    expectFail(switchBusinessSchema, { body: { businessId: "bad" } }, "ID inválido");
  });
});

// ========================================================
// saveShiftSchema
// ========================================================
describe("saveShiftSchema", () => {
  const validShift = {
    body: {
      workerId: "507f1f77bcf86cd799439011",
      dayOfWeek: 1,
    },
  };

  it("acepta payload mínimo válido (solo workerId + dayOfWeek)", () => {
    expectPass(saveShiftSchema, validShift);
  });

  it("acepta payload completo con horarios y breaks", () => {
    expectPass(saveShiftSchema, {
      body: {
        ...validShift.body,
        isOpen: true,
        startTime: "09:00",
        endTime: "18:00",
        breaks: [{ startTime: "13:00", endTime: "14:00" }],
      },
    });
  });

  it("rechaza dayOfWeek fuera de rango (7)", () => {
    expectFail(saveShiftSchema, {
      body: { ...validShift.body, dayOfWeek: 7 },
    }, "Sábado");
  });

  it("rechaza dayOfWeek negativo", () => {
    expectFail(saveShiftSchema, {
      body: { ...validShift.body, dayOfWeek: -1 },
    }, "Domingo");
  });

  it("rechaza horario con formato incorrecto (HH:MM:SS)", () => {
    expectFail(saveShiftSchema, {
      body: { ...validShift.body, startTime: "09:00:00" },
    }, "HH:MM");
  });

  it("rechaza horario con formato incorrecto (texto)", () => {
    expectFail(saveShiftSchema, {
      body: { ...validShift.body, startTime: "nueve" },
    }, "HH:MM");
  });

  it("rechaza sin workerId (campo obligatorio)", () => {
    expectFail(saveShiftSchema, { body: { dayOfWeek: 1 } }, "");
  });

  it("rechaza sin dayOfWeek (campo obligatorio)", () => {
    expectFail(saveShiftSchema, { body: { workerId: "507f1f77bcf86cd799439011" } }, "");
  });

  it("rechaza break con formato de hora incorrecto", () => {
    expectFail(saveShiftSchema, {
      body: {
        ...validShift.body,
        breaks: [{ startTime: "1pm", endTime: "2pm" }],
      },
    }, "HH:MM");
  });
});
