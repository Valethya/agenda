/**
 * Gateway de pagos Transbank (Webpay Plus).
 * Encapsula la configuración del SDK y expone operaciones atómicas.
 * Para producción, configurar los códigos de comercio reales en variables de entorno.
 */
import pkg from "transbank-sdk";
const { WebpayPlus } = pkg;

const getTransactionInstance = () => {
  const { Options, IntegrationCommerceCodes, IntegrationApiKeys, Environment } = pkg;
  
  const options = new Options(
    IntegrationCommerceCodes.WEBPAY_PLUS,
    IntegrationApiKeys.WEBPAY,
    Environment.Integration
  );

  return new WebpayPlus.Transaction(options);
};

/**
 * Crea una transacción en Webpay Plus.
 * @param {string} buyOrder - Identificador único de la orden
 * @param {string} sessionId - ID de sesión para tracking
 * @param {number} amount - Monto en CLP
 * @param {string} returnUrl - URL de retorno tras el pago
 * @returns {Promise<{token: string, url: string}>}
 */
export const createTransaction = async (buyOrder, sessionId, amount, returnUrl) => {
  const transaction = getTransactionInstance();
  return await transaction.create(buyOrder, sessionId, amount, returnUrl);
};

/**
 * Confirma (commit) una transacción de Webpay Plus.
 * @param {string} token - Token de la transacción
 * @returns {Promise<Object>} Resultado de la confirmación
 */
export const commitTransaction = async (token) => {
  const transaction = getTransactionInstance();
  return await transaction.commit(token);
};
