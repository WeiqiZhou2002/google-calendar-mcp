import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { ListEventsArgumentsSchema } from "../../schemas/validators.js";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { google, calendar_v3 } from 'googleapis';
import { z } from 'zod';
import { formatEventList } from "../utils.js";
import { CalendarApi } from "../../calendarAPI.js"

export class ListEventsHandler extends BaseToolHandler {
    async runTool(args: any, oauth2Client: OAuth2Client): Promise<CallToolResult> {
        const validArgs = ListEventsArgumentsSchema.parse(args);
        const res = await CalendarApi.listEvents(oauth2Client,{
            calendarId: validArgs.calendarId,
                timeMin: validArgs.timeMin,
                timeMax: validArgs.timeMax,
                singleEvents: true,
                orderBy: 'startTime',
        })
        const events: calendar_v3.Schema$Event[] =  res.data.items ?? [];
        return {
            content: [{
                type: "text",
                text: formatEventList(events),
            }],
        };
    }

    // private async listEvents(
    //     client: OAuth2Client,
    //     args: z.infer<typeof ListEventsArgumentsSchema>
    // ): Promise<calendar_v3.Schema$Event[]> {
    //     try {
    //         const calendar = this.getCalendar(client);
    //         const response = await calendar.events.list({
    //             calendarId: args.calendarId,
    //             timeMin: args.timeMin,
    //             timeMax: args.timeMax,
    //             singleEvents: true,
    //             orderBy: 'startTime',
    //         });
    //         return response.data.items || [];
    //     } catch (error) {
    //         throw this.handleGoogleApiError(error);
    //     }
    // }
}
