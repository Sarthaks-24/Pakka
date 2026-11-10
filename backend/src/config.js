const REQUIRED = ["MONGODB_URI", "GNANI_API_KEY", "GEMINI_API_KEY"];

// Read lazily so tests and providers pick up the current environment.
export function readConfig(env = process.env) {
  return {
    mongoUri: env.MONGODB_URI,
    gnaniKey: env.GNANI_API_KEY,
    geminiKey: env.GEMINI_API_KEY,
    port: Number(env.PORT) || 4000,
    geminiModel: env.GEMINI_MODEL || "gemini-3.6-flash",
    geminiThinkingLevel: env.GEMINI_THINKING_LEVEL || null,
    sellerLang: env.SELLER_LANG || "gu-IN",
    buyerLang: env.BUYER_LANG || "hi-IN",
    sellerVoice: env.SELLER_VOICE || "Shivani",
    buyerVoice: env.BUYER_VOICE || "Avinash",
    frontendOrigin: env.FRONTEND_ORIGIN || "http://localhost:5173",
    frontendOrigins: allowedOrigins(env.FRONTEND_ORIGIN || "http://localhost:5173"),
  };
}

// FRONTEND_ORIGIN may be a comma-separated list. A localhost origin also allows its 127.0.0.1 form, and the other way round.
function allowedOrigins(value) {
  const out = new Set();
  for (const origin of value.split(",").map((o) => o.trim().replace(/\/$/, "")).filter(Boolean)) {
    out.add(origin);
    if (origin.includes("//localhost")) out.add(origin.replace("//localhost", "//127.0.0.1"));
    if (origin.includes("//127.0.0.1")) out.add(origin.replace("//127.0.0.1", "//localhost"));
  }
  return [...out];
}

export function missingEnv(env = process.env) {
  return REQUIRED.filter((name) => !env[name]);
}

const THINKING_LEVELS = ["minimal", "low", "medium", "high"];

// Returns a start-up error message, or null when the environment is usable. Values are never included.
export function configError(env = process.env) {
  const missing = missingEnv(env);
  if (missing.length) return `Missing required environment variable: ${missing.join(", ")}. Set it in backend/.env (see backend/.env.example).`;
  if (env.GEMINI_THINKING_LEVEL && !THINKING_LEVELS.includes(env.GEMINI_THINKING_LEVEL)) {
    return `GEMINI_THINKING_LEVEL must be one of ${THINKING_LEVELS.join(", ")}, or left empty.`;
  }
  return null;
}

// Exits at start-up naming the variable.
export function loadConfig(env = process.env) {
  const error = configError(env);
  if (error) {
    console.error(error);
    process.exit(1);
  }
  return readConfig(env);
}
