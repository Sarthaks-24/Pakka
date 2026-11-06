const REQUIRED = ["MONGODB_URI", "GNANI_API_KEY", "GEMINI_API_KEY"];

// Read lazily so tests and providers pick up the current environment.
export function readConfig(env = process.env) {
  return {
    mongoUri: env.MONGODB_URI,
    gnaniKey: env.GNANI_API_KEY,
    geminiKey: env.GEMINI_API_KEY,
    port: Number(env.PORT) || 4000,
    geminiModel: env.GEMINI_MODEL || "gemini-2.5-flash",
    sellerLang: env.SELLER_LANG || "gu-IN",
    buyerLang: env.BUYER_LANG || "hi-IN",
    sellerVoice: env.SELLER_VOICE || "Shivani",
    buyerVoice: env.BUYER_VOICE || "Avinash",
    frontendOrigin: env.FRONTEND_ORIGIN || "http://localhost:5173",
  };
}

export function missingEnv(env = process.env) {
  return REQUIRED.filter((name) => !env[name]);
}

// Exits at start-up naming the variable. Values are never printed.
export function loadConfig(env = process.env) {
  const missing = missingEnv(env);
  if (missing.length) {
    console.error(`Missing required environment variable: ${missing.join(", ")}. Set it in backend/.env (see backend/.env.example).`);
    process.exit(1);
  }
  return readConfig(env);
}
