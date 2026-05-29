import {app} from "./app.js";
import {port} from "./config/env.js";
import {connectDB} from "./config/db.js";
import logger from "./config/logger.js";

logger.info('server running');

connectDB();

const httpServer= app.listen(port,()=>{logger.info(`server running at port ${port}`);});