import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as templates from "../../src/services/email/templates.js";

const mockBranding = {
  brandColor: "#FF5733",
  logoUrl: "https://example.com/logo.png",
  customFooter: "Gracias por preferirnos",
  businessName: "Test Barbería",
  contactEmail: "contacto@test.cl",
};

describe("Email Templates", () => {
  describe("resetPassword", () => {
    it("debería retornar subject y html con el URL de reset", () => {
      const result = templates.resetPassword("https://example.com/reset?token=abc123");

      assert.ok(result.subject.includes("Restablece tu contraseña"));
      assert.ok(result.html.includes("https://example.com/reset?token=abc123"));
      assert.ok(result.html.includes("Restablecer Contraseña"));
    });
  });

  describe("appointmentBooked", () => {
    it("debería incluir datos del servicio y profesional", () => {
      const detail = {
        worker: { firstName: "Carlos", lastName: "López" },
        service: { name: "Corte de pelo" },
        date: "2026-03-15",
        startTime: "10:00",
        status: "pending",
      };

      const result = templates.appointmentBooked(detail, mockBranding);

      assert.ok(result.subject.includes("Test Barbería"));
      assert.ok(result.html.includes("Corte de pelo"));
      assert.ok(result.html.includes("Carlos López"));
      assert.ok(result.html.includes("10:00"));
      assert.ok(result.html.includes("Pendiente"));
    });

    it("debería mostrar 'Pendiente de Pago' cuando status es pending_payment", () => {
      const detail = {
        worker: { firstName: "A", lastName: "B" },
        service: { name: "Servicio" },
        date: "2026-01-01",
        startTime: "09:00",
        status: "pending_payment",
      };

      const result = templates.appointmentBooked(detail, mockBranding);
      assert.ok(result.html.includes("Pendiente de Pago"));
    });
  });

  describe("appointmentConfirmed", () => {
    it("debería incluir badge de confirmada", () => {
      const detail = {
        worker: { firstName: "A", lastName: "B" },
        service: { name: "Barba" },
        date: "2026-06-20",
        startTime: "14:30",
      };

      const result = templates.appointmentConfirmed(detail, mockBranding);

      assert.ok(result.subject.includes("Confirmada"));
      assert.ok(result.html.includes("Confirmada"));
      assert.ok(result.html.includes("Barba"));
    });
  });

  describe("appointmentCancelled", () => {
    it("debería incluir badge de cancelada", () => {
      const detail = {
        worker: { firstName: "A", lastName: "B" },
        service: { name: "Tinte" },
        date: "2026-06-20",
        startTime: "16:00",
      };

      const result = templates.appointmentCancelled(detail, mockBranding);

      assert.ok(result.subject.includes("Cancelada"));
      assert.ok(result.html.includes("Cancelada"));
    });
  });

  describe("workerPendingApproval", () => {
    it("debería incluir datos del cliente y del worker", () => {
      const detail = {
        client: { firstName: "María", lastName: "García", phone: ["123"], email: ["m@test.com"] },
        worker: { firstName: "Carlos", lastName: "López" },
        service: { name: "Corte" },
        date: "2026-07-01",
        startTime: "11:00",
      };

      const result = templates.workerPendingApproval(detail, mockBranding);

      assert.ok(result.subject.includes("pendiente de aprobación"));
      assert.ok(result.html.includes("María García"));
      assert.ok(result.html.includes("Carlos"));
    });
  });

  describe("Branding", () => {
    it("debería usar el color de marca del negocio", () => {
      const detail = {
        worker: { firstName: "A", lastName: "B" },
        service: { name: "S" },
        date: "2026-01-01",
        startTime: "09:00",
      };

      const result = templates.appointmentConfirmed(detail, mockBranding);
      assert.ok(result.html.includes("#FF5733"));
    });

    it("debería incluir logo si está configurado", () => {
      const detail = {
        worker: { firstName: "A", lastName: "B" },
        service: { name: "S" },
        date: "2026-01-01",
        startTime: "09:00",
      };

      const result = templates.appointmentConfirmed(detail, mockBranding);
      assert.ok(result.html.includes("https://example.com/logo.png"));
    });

    it("debería incluir footer personalizado si está configurado", () => {
      const detail = {
        worker: { firstName: "A", lastName: "B" },
        service: { name: "S" },
        date: "2026-01-01",
        startTime: "09:00",
      };

      const result = templates.appointmentConfirmed(detail, mockBranding);
      assert.ok(result.html.includes("Gracias por preferirnos"));
    });
  });
});
