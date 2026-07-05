import { dirname } from "path";
import { fileURLToPath } from "url";
import multer from "multer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(dirname(__filename));


export default __dirname;