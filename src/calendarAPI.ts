import { google, calendar_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { parseISO, isAfter, addDays } from "date-fns";
import { DeleteEventArgumentsSchema } from "../src/schemas/validators.js";
import { z } from 'zod';
import { toZonedTime } from "date-fns-tz";
import { PolicyManager } from "./PolicyManager.js"; 

/**
 * Read the limit once from env but expose a setter so tests (or admin UI)
 * can tune it at runtime without rebooting the server.
 */
const DEFAULT_LIMIT = parseInt(process.env.MCP_MAX_FUTURE_DAYS ?? "7", 10);
let maxFutureDays = DEFAULT_LIMIT;

const TRACE = process.env.MCP_TRACE === "1";

export class CalendarApi {
  /* ------------------------------------------------------------------ */
  // ≡≡≡  Public helper to mutate the policy at runtime  ≡≡≡
  static setMaxFutureDays(days: number) {
    maxFutureDays = days > 0 ? days : 0;   // clamp
  }

  /* ------------------------------------------------------------------ */
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
    const start = this.extractStart(params.requestBody);
  PolicyManager.enforce("write", {
    start,
    calendarId: params.calendarId as string | undefined
  });
  return this.retry(() => this.getClient(auth).events.insert(params));
  }

  static async listEvents(
    auth: OAuth2Client,
    params: calendar_v3.Params$Resource$Events$List
  ) {
    const min = params.timeMin ? parseISO(params.timeMin as string) : undefined;
    const max = params.timeMax ? parseISO(params.timeMax as string) : undefined;
    try {PolicyManager.enforce("read", {
      start: min,
      end: max,
      calendarId: params.calendarId as string | undefined
    });
    } catch (e: any) {
      if (e.code === "MCP_READ_CLIPPED") {
        params.timeMax = e.horizon.toISOString();
      } else {
        throw e;
      }
    }
    return this.retry(() => this.getClient(auth).events.list(params));
  }

  static async deleteEvent(
        auth: OAuth2Client,
        params: z.infer<typeof DeleteEventArgumentsSchema>
    ){
      const calendar = this.getClient(auth);
      let ev: calendar_v3.Schema$Event | undefined;
      try {
        const res = await calendar.events.get({
          calendarId: params.calendarId,
          eventId: params.eventId,
        });
        ev = res.data;
      } catch (e) {
        throw e;
      }
        PolicyManager.enforce("delete", {calendarId: params.calendarId, start : this.extractStart(ev)});
        return this.retry(() => this.getClient(auth).events.delete(params));
    }

  static async updateEvent(
    auth: OAuth2Client,
    params: calendar_v3.Params$Resource$Events$Patch
  ) {
    const start = this.extractStart(params.requestBody);
  PolicyManager.enforce("write", {
    start,
    calendarId: params.calendarId as string | undefined
  });
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
      if (TRACE) {
        const delta = Date.now() - t0;
        // Write to stderr so stdout stays pure NDJSON for the MCP transport
        console.error(`[CalendarApi] call took ${delta} ms`);
      }
    }
  }

  private static isRetryable(err: any) {
    const code = err?.code || err?.response?.status;
    return [429, 500, 502, 503, 504].includes(code);
  }

  /* -------------------- Guard helpers -------------------- */

  /** Convert DTSTART (date or dateTime) field to Date, else null */
  private static extractStart(body: calendar_v3.Schema$Event | undefined): Date | undefined {
    if (!body) return undefined;
    if (body.start?.dateTime) return parseISO(body.start.dateTime);
    if (body.start?.date) return parseISO(body.start.date);
    return undefined;
  }

}
