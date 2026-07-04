import fs from "node:fs/promises";
import { checkStock, STATUS } from "./checkStock.js";
import { getConfig, hasAnyNotifier, loadDotEnv } from "./config.js";
import { sendErrorNotification, sendStockNotifications } from "./notifiers.js";
import {
  nextErrorState,
  nextSuccessState,
  readState,
  shouldAlertForError,
  shouldAlertForStock,
  writeState
} from "./stateStore.js";

loadDotEnv();

const args = new Set(process.argv.slice(2));
const config = getConfig();

if (args.has("--help") || args.has("-h")) {
  printHelp();
  process.exit(0);
}

if (args.has("--test-alert")) {
  await runTestAlert(config);
  process.exit(0);
}

if (args.has("--notify-once")) {
  await runOnce(config, { notify: true });
  process.exit(0);
}

if (args.has("--once")) {
  await runOnce(config, { notify: false });
  process.exit(0);
}

await runForever(config);

async function runForever(currentConfig) {
  if (!hasAnyNotifier(currentConfig)) {
    console.warn("No notification channel configured. Fill .env or run with --once to inspect status.");
  }

  console.log(`Monitoring ${currentConfig.productUrl}`);
  console.log(`Interval: ${Math.round(currentConfig.checkIntervalMs / 1000)}s`);

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  while (!stopping) {
    await runOnce(currentConfig, { notify: true });
    await sleep(currentConfig.checkIntervalMs);
  }

  console.log("Stopped.");
}

async function runOnce(currentConfig, options) {
  const state = await readState(currentConfig.stateFile);

  try {
    const result = await checkStock(currentConfig);
    console.log(formatResult(result));

    const shouldNotify = options.notify && shouldAlertForStock(result, state, currentConfig);
    let notificationOutcomes = [];
    if (shouldNotify) {
      notificationOutcomes = await sendStockNotifications(result, currentConfig);
      logNotificationOutcomes(notificationOutcomes);
    }

    await writeState(currentConfig.stateFile, nextSuccessState(state, result, shouldNotify));
    await writeGitHubStepSummary({ result, didAlert: shouldNotify, notificationOutcomes });
    return result;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] check failed: ${error.message}`);

    const errorState = nextErrorState(state, error);
    if (options.notify && shouldAlertForError(errorState, currentConfig)) {
      const outcomes = await sendErrorNotification(error, errorState, currentConfig);
      logNotificationOutcomes(outcomes);
      errorState.lastErrorAlertAt = new Date().toISOString();
    }

    await writeState(currentConfig.stateFile, errorState);
    await writeGitHubStepSummary({ error, errorState });
    if (!options.notify) {
      throw error;
    }

    return null;
  }
}

async function runTestAlert(currentConfig) {
  const sample = {
    status: STATUS.IN_STOCK,
    source: "manual-test",
    productName: "Nintendo Switch 2",
    price: "KRW 648,000",
    evidence: "test alert requested",
    checkedAt: new Date().toISOString(),
    httpStatus: 200,
    url: currentConfig.productUrl
  };

  const outcomes = await sendStockNotifications(sample, currentConfig);
  logNotificationOutcomes(outcomes);
}

function formatResult(result) {
  return [
    `[${result.checkedAt}]`,
    result.productName || "Nintendo Switch 2",
    result.status,
    `via ${result.source}`,
    result.evidence ? `(${result.evidence})` : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function logNotificationOutcomes(outcomes) {
  for (const outcome of outcomes) {
    if (outcome.ok) {
      console.log(`Notification sent: ${outcome.channel}`);
    } else {
      console.warn(`Notification failed: ${outcome.channel} - ${outcome.error}`);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp() {
  console.log(`Usage:
  npm start             Monitor continuously and notify on restock
  npm run check         Check once without sending stock alerts
  npm run check:notify  Check once and notify if stock is detected
  npm run test-alert    Send a test notification

Configuration is read from .env. Start with:
  cp .env.example .env`);
}

async function writeGitHubStepSummary({ result, didAlert = false, notificationOutcomes = [], error, errorState }) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) {
    return;
  }

  const lines = ["## Nintendo Switch 2 Stock Monitor", ""];

  if (result) {
    lines.push(
      `- Status: \`${result.status}\``,
      `- Product: ${result.productName || "Nintendo Switch 2"}`,
      `- Evidence: \`${result.evidence || "n/a"}\``,
      `- Source: \`${result.source}\``,
      `- Checked at: \`${result.checkedAt}\``,
      `- Alert sent: \`${didAlert ? "yes" : "no"}\``,
      `- URL: ${result.url}`
    );

    if (notificationOutcomes.length > 0) {
      lines.push("", "### Notifications");
      for (const outcome of notificationOutcomes) {
        lines.push(`- ${outcome.channel}: \`${outcome.ok ? "ok" : `failed - ${outcome.error}`}\``);
      }
    }
  } else {
    lines.push(
      "- Status: `error`",
      `- Error: \`${error?.message || "unknown error"}\``,
      `- Consecutive errors: \`${errorState?.consecutiveErrors || 0}\``,
      `- Checked at: \`${new Date().toISOString()}\``
    );
  }

  try {
    await fs.appendFile(summaryFile, `${lines.join("\n")}\n`, "utf8");
  } catch (summaryError) {
    console.warn(`Could not write GitHub step summary: ${summaryError.message}`);
  }
}
