import mongoose from "mongoose";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";

const config = loadConfig();

try {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
} catch {
  console.error("Could not connect to MongoDB. Check MONGODB_URI in backend/.env and that the database is running.");
  process.exit(1);
}

createApp({ config }).listen(config.port, () => {
  console.log(`Pakka backend listening on port ${config.port}`);
});
