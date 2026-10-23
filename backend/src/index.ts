
import "dotenv/config";
import express from "express";
import cors from "cors";
import { pool } from "./config/db.js";
const app = express();
const port = Number(process.env.PORT ?? 5000);

app.use(cors());

app.use(
  express.json({
    verify: (req, _res, buffer) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody =
        Buffer.from(buffer);
    },
  }),
);




app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      database: "connected",
    });
  } catch (error) {
    console.error("Database health check failed:", error);
    res.status(503).json({
      status: "error",
      database: "disconnected",
    });
  }
});


app.listen(port, "0.0.0.0", () => {
  console.log(`Backend listening on port ${port}`);
});
