import express from "express";
import morgan from "morgan";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import __dirname from "./utils/utils.js";

// EXPRESS 

export const app = express();
app.use(express.static(path.resolve(__dirname, "../client/build")));

app.use("/public", express.static(path.join(__dirname, "/public")));

app.use(express.json());
app.use(express.urlencoded({extended:true}));

// CORS

app.use(cors({credentials:true,
    origin: [],
}));

// HELMET

app.use(helmet());


//router(app);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// errores
app.use((err, req, res, next) => {
  logger.error(err.message);
  res.status(500).json({ error: 'Internal server error' });
});

