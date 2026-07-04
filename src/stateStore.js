import fs from "node:fs/promises";
import path from "node:path";
import { STATUS } from "./checkStock.js";

export async function readState(stateFile) {
  try {
    const content = await fs.readFile(stateFile, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function writeState(stateFile, state) {
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function shouldAlertForStock(result, state, config) {
  if (result.status !== STATUS.IN_STOCK) {
    return false;
  }

  if (!state.lastStatus) {
    return config.alertOnStart;
  }

  if (state.lastStatus !== STATUS.IN_STOCK) {
    return true;
  }

  if (config.alertRepeatMs > 0 && state.lastAlertAt) {
    const lastAlertTime = Date.parse(state.lastAlertAt);
    return Number.isFinite(lastAlertTime) && Date.now() - lastAlertTime >= config.alertRepeatMs;
  }

  return false;
}

export function nextSuccessState(previousState, result, didAlert) {
  return {
    ...previousState,
    lastStatus: result.status,
    lastCheckedAt: result.checkedAt,
    lastEvidence: result.evidence,
    lastSource: result.source,
    lastError: null,
    consecutiveErrors: 0,
    lastAlertAt: didAlert ? new Date().toISOString() : previousState.lastAlertAt || null
  };
}

export function nextErrorState(previousState, error) {
  return {
    ...previousState,
    lastError: {
      message: error.message,
      at: new Date().toISOString()
    },
    consecutiveErrors: (previousState.consecutiveErrors || 0) + 1
  };
}

export function shouldAlertForError(state, config) {
  const threshold = config.errorAlertThreshold;
  if (!threshold || state.consecutiveErrors < threshold) {
    return false;
  }

  if (!state.lastErrorAlertAt) {
    return true;
  }

  const lastAlertTime = Date.parse(state.lastErrorAlertAt);
  return Number.isFinite(lastAlertTime) && Date.now() - lastAlertTime >= 60 * 60 * 1000;
}
