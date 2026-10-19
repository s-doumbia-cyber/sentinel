import "dotenv/config";
import { createApp } from "./app.js";
import { connectDB } from "./config/db.js";

const app = createApp();
const PORT = process.env.PORT || 4000;

connectDB()
  .then(() => {
    const server = app.listen(PORT, () => console.log(`[server] Sentinel API listening on port ${PORT}`));
    server.timeout = 10 * 60 * 1000; // 10 minutes — large CICIDS2017 CSV uploads are parsed synchronously
  })
  .catch((err) => {
    console.error("[server] Failed to connect to MongoDB:", err.message);
    process.exit(1);
  });
