import fs from "node:fs";
import path from "node:path";

const DEFAULT_PRODUCT_URL = "https://store.nintendo.co.kr/beeskb6aakor";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (compatible; NintendoSwitch2StockMonitor/1.0; +https://store.nintendo.co.kr/)";

export function loadDotEnv(filePath = ".env", env = process.env) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (env[key] !== undefined) {
      continue;
    }

    env[key] = unquoteEnvValue(rawValue.trim());
  }
}

export function getConfig(env = process.env) {
  const smtpSecure = parseBool(env.SMTP_SECURE, false);
  const smtpPort = parseIntWithDefault(env.SMTP_PORT, smtpSecure ? 465 : 587);

  return {
    productUrl: env.PRODUCT_URL || DEFAULT_PRODUCT_URL,
    checkIntervalMs: parseIntWithDefault(env.CHECK_INTERVAL_SECONDS, 60) * 1000,
    requestTimeoutMs: parseIntWithDefault(env.REQUEST_TIMEOUT_SECONDS, 20) * 1000,
    stateFile: path.resolve(env.STATE_FILE || ".monitor-state.json"),
    alertOnStart: parseBool(env.ALERT_ON_START, true),
    alertRepeatMs: parseIntWithDefault(env.ALERT_REPEAT_MINUTES, 0) * 60 * 1000,
    errorAlertThreshold: parseIntWithDefault(env.ERROR_ALERT_THRESHOLD, 3),
    userAgent: env.USER_AGENT || DEFAULT_USER_AGENT,
    soldOutHints: splitCsv(env.SOLD_OUT_HINTS),
    inStockHints: splitCsv(env.IN_STOCK_HINTS),
    discordWebhookUrl: env.DISCORD_WEBHOOK_URL || "",
    genericWebhook: {
      url: env.WEBHOOK_URL || "",
      bearerToken: env.WEBHOOK_BEARER_TOKEN || ""
    },
    smtp: {
      host: env.SMTP_HOST || "",
      port: smtpPort,
      secure: smtpSecure,
      startTls: parseBool(env.SMTP_STARTTLS, !smtpSecure),
      user: env.SMTP_USER || "",
      pass: env.SMTP_PASS || "",
      from: env.EMAIL_FROM || env.SMTP_USER || "",
      to: splitCsv(env.EMAIL_TO)
    }
  };
}

export function hasAnyNotifier(config) {
  return Boolean(
    config.discordWebhookUrl ||
      config.genericWebhook.url ||
      (config.smtp.host && config.smtp.from && config.smtp.to.length > 0)
  );
}

function parseBool(value, defaultValue) {
  if (value === undefined || value === "") {
    return defaultValue;
  }

  return ["1", "true", "yes", "y", "on"].includes(String(value).trim().toLowerCase());
}

function parseIntWithDefault(value, defaultValue) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function splitCsv(value) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
