/**
 * Bootstrap de tests — DEBE importarse como PRIMERA línea de cada test file.
 *
 * Configuración:
 *   - Requiere la variable de entorno MONGO_TEST_URI apuntando a una base de datos
 *     cuyo nombre termine en "_test" (ej: mongodb://localhost:27017/agenda_test).
 *   - Si MONGO_TEST_URI no está definida, el proceso termina con código 1 y un mensaje
 *     indicando que debe configurarse en el archivo .env o como variable de entorno.
 *   - NODE_ENV se fuerza a "test" y se valida que permanezca así.
 *   - Se rechaza la ejecución si el nombre de la base de datos no termina en "_test".
 *
 * Uso:
 *   import './setup.js';          // desde test/
 *   import '../setup.js';         // desde test/unit/
 */
import 'dotenv/config';

// 1. Forzar NODE_ENV = test
process.env.NODE_ENV = 'test';

// 2. Validar NODE_ENV (por si algo lo sobreescribió antes de este import)
if (process.env.NODE_ENV !== 'test') {
  console.error('FATAL: NODE_ENV debe ser "test" para ejecutar los tests. Valor actual:', process.env.NODE_ENV);
  process.exit(1);
}

// 3. Exigir MONGO_TEST_URI explícita (no derivada de MONGO_URI)
const testUri = process.env.MONGO_TEST_URI;
if (!testUri) {
  console.error(
    'FATAL: MONGO_TEST_URI no está definida.\n' +
    'Configure esta variable en su archivo .env o como variable de entorno.\n' +
    'Ejemplo: MONGO_TEST_URI=mongodb://localhost:27017/agenda_test\n' +
    'El nombre de la base de datos DEBE terminar en "_test".'
  );
  process.exit(1);
}

// 4. Validar que el nombre de la base de datos termine en "_test"
try {
  const url = new URL(testUri);
  const dbName = url.pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    console.error(
      `FATAL: El nombre de la base de datos "${dbName}" no termina en "_test".\n` +
      'Esto es un requisito de seguridad para evitar ejecutar tests contra bases productivas.\n' +
      `URI recibida: ${testUri}`
    );
    process.exit(1);
  }
  console.log(`[TEST] Base de datos de test: ${dbName} (NODE_ENV=${process.env.NODE_ENV})`);
} catch (err) {
  console.error(`FATAL: MONGO_TEST_URI no es una URL válida: ${testUri}`);
  process.exit(1);
}

// 5. Sobreescribir MONGO_URI con MONGO_TEST_URI para que app.js / db.js la usen
process.env.MONGO_URI = testUri;

export const TEST_DB_URI = testUri;
