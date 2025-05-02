import { google, calendar_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";

const MAX_FUTURE_DAYS = parseInt(
    process.env.MCP_MAX_FUTURE_DAYS ?? "7",
    10 /* base */
  );
  
  let maxFutureDays = MAX_FUTURE_DAYS; 

export class CalendarApi {
  private static clientCache = new WeakMap<OAuth2Client, calendar_v3.Calendar>();

  /** Get or create a google.calendar client bound to this OAuth2 token */
  static getClient(auth: OAuth2Client): calendar_v3.Calendar {
    if (!this.clientCache.has(auth)) {
      this.clientCache.set(auth, google.calendar({ version: "v3", auth }));
    }
    return this.clientCache.get(auth)!;
  }

  /* -------------------- Convenience wrappers -------------------- */

  static async createEvent(
    auth: OAuth2Client,
    params: calendar_v3.Params$Resource$Events$Insert
  ) {
    return this.retry(() => this.getClient(auth).events.insert(params));
  }

  static async listEvents(
    auth: OAuth2Client,
    params: calendar_v3.Params$Resource$Events$List
  ) {
    return this.retry(() => this.getClient(auth).events.list(params));
  }

  static async updateEvent(
    auth: OAuth2Client,
    params: calendar_v3.Params$Resource$Events$Patch
  ) {
    return this.retry(() => this.getClient(auth).events.patch(params));
  }

  /* -------------------- Generic retry + logging -------------------- */

  private static async retry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
    const t0 = Date.now();
    try {
      return await fn();
    } catch (err: any) {
      if (tries > 1 && this.isRetryable(err)) {
        return this.retry(fn, tries - 1);
      }
      throw err;
    } finally {
        console.log(`[CalendarApi] call took ${Date.now() - t0} ms`);
    }
  }

  private static isRetryable(err: any) {
    const code = err?.code || err?.response?.status;
    return [429, 500, 502, 503, 504].includes(code);
  }
}