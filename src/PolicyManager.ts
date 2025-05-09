// src/policy/PolicyManager.ts  – ES‑module safe version
// YAML‑driven policy loader with flexible path resolution.
// Works whether the project runs via ts‑node (src/) **or** from the compiled
// build/ directory, and under "type":"module" package settings (no __dirname).

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { addDays, isAfter } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { fileURLToPath } from "node:url";

/* -------------------------------------------------------------------------- */
// Polyfill __dirname / __filename in an ESM world
/* -------------------------------------------------------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type Action = "read" | "write" | "delete";
interface ActionRule { enabled?: boolean; max_future_days?: number }
interface PolicyFile {
  timezone?: string;
  actions?: Record<Action, ActionRule>;
  calendars?: { whitelist?: string[] };
}

/* -------------------------------------------------------------------------- */
// 1) Choose config file path in this precedence order:
//    a) MCP_POLICY_FILE env var (absolute or relative)
//    b) src/config/policy.yml   – when running directly from TS source
//    c) build/config/policy.yml – after transpile (dist/build folder)
//    d) Fallback = no file ⇒ permissive defaults.
/* -------------------------------------------------------------------------- */
const ENV_PATH = process.env.MCP_POLICY_FILE;

const CANDIDATES = [
  path.resolve(__dirname, "..", "config", "policy.yml"),              // src/config/...
  path.resolve(__dirname, "..", "..", "config", "policy.yml"),        // build/config/...
];

function firstExisting(paths: string[]): string | undefined {
  return paths.find(p => fs.existsSync(p));
}

const FALLBACK_PATH = firstExisting(CANDIDATES);
const CONFIG_PATH = ENV_PATH ?? FALLBACK_PATH;

/* -------------------------------------------------------------------------- */
function safeLoad(file?: string): PolicyFile {
  if (!file) {
    console.warn("⚠️  No policy.yml found. Using permissive defaults.");
    return {} as PolicyFile;
  }
  try {
    const txt = fs.readFileSync(file, "utf-8");
    return YAML.parse(txt) as PolicyFile;
  } catch (e) {
    console.error(`⚠️  Failed to read ${file}. Using permissive defaults.`, e);
    return {} as PolicyFile;
  }
}

export class PolicyManager {
  private static policy: PolicyFile = safeLoad(CONFIG_PATH);

  /**
   * Enforce the current YAML rules against an action.  Throws 403‑style
   * Error with code="MCP_POLICY_VIOLATION" if disallowed.
   */
  static enforce(action: Action, opts: { start?: Date; calendarId?: string }) {
    const rule = this.policy.actions?.[action] ?? {};

    /* 1. enabled flag */
    if (rule.enabled === false) {
      throw this.err(`Action '${action}' disabled by policy`);
    }

    /* 2. maximum future window */
    if (rule.max_future_days !== undefined && opts.start) {
      const horizon = addDays(toZonedTime(new Date(), this.tz()), rule.max_future_days);
      if (isAfter(opts.start, horizon)) {
        throw this.err(
          `${action} denied: ${opts.start.toISOString()} beyond ` +
          `${rule.max_future_days}‑day window`
        );
      }
    }

    /* 3. calendar whitelist */
    if (this.policy.calendars?.whitelist && opts.calendarId) {
      if (!this.policy.calendars.whitelist.includes(opts.calendarId)) {
        throw this.err(
          `${action} denied: calendar '${opts.calendarId}' not whitelisted`
        );
      }
    }
  }

  /* ------------------- helpers ------------------- */
  private static tz() {
    return this.policy.timezone ?? "America/Chicago";
  }

  private static err(msg: string) {
    return Object.assign(new Error(msg), {
      code: "MCP_POLICY_VIOLATION",
      httpStatus: 403,
    });
  }
}

/* -------------------------------------------------------------------------- */
// Hot‑reload the YAML whenever it changes on disk, **if** we actually have one.
/* -------------------------------------------------------------------------- */
if (CONFIG_PATH) {
  fs.watch(CONFIG_PATH, { persistent: false }, () => {
    PolicyManager["policy"] = safeLoad(CONFIG_PATH);
    console.error(`[PolicyManager] Reloaded policy from ${CONFIG_PATH}`);
  });
}
