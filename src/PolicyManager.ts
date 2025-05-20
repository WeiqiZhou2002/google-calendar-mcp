import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { addDays, isAfter } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type Action = "read" | "write" | "delete";
interface ActionRule { enabled?: boolean; max_future_days?: number }
interface PolicyFile {
  timezone?: string;
  actions?: Record<Action, ActionRule>;
  calendars?: { whitelist?: string[] };
}

const ENV_PATH = process.env.MCP_POLICY_FILE;

const FALLBACK_PATH = path.resolve(__dirname,  "..", "src", "policy.yml");
const CONFIG_PATH = ENV_PATH ?? FALLBACK_PATH;

function safeLoad(file?: string): PolicyFile {
  if (!file) {
    console.warn("No policy.yml found. Using permissive defaults.");
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
  static enforce(action: Action, opts: { start?: Date; end?: Date; calendarId?: string }) {
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
      
      if(opts.end !== undefined && isAfter(opts.end,horizon)){
        if (action === "read") {
          const err = Object.assign(
            new Error(`${action} end beyond horizon`),
            {
              code: "MCP_READ_CLIPPED",
              horizon,
              httpStatus: 400,
            }
          );
          throw err;
        } else {
          throw this.err(`${action} denied: end beyond ${rule.max_future_days}‑day window`);
        }
      }
    }

   //TODO: enforce calendar access
    if (this.policy.calendars?.whitelist && opts.calendarId) {
      if (!this.policy.calendars.whitelist.includes(opts.calendarId)) {
        throw this.err(
          `${action} denied: calendar '${opts.calendarId}' not whitelisted`
        );
      }
    }
  }

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
// see if any change in config file
if (CONFIG_PATH) {
  fs.watch(CONFIG_PATH, { persistent: false }, () => {
    PolicyManager["policy"] = safeLoad(CONFIG_PATH);
    console.error(`[PolicyManager] Reloaded policy from ${CONFIG_PATH}`);
  });
}
