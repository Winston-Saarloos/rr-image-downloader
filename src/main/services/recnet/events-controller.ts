import { Event } from '../../models/Event';
import { RecNetHttpClient } from './http-client';

export class EventsController {
  constructor(private readonly http: RecNetHttpClient) {}

  async fetchBulkEvents(eventIds: string[], token?: string): Promise<Event[]> {
    if (eventIds.length === 0) {
      return [];
    }

    const results: Event[] = [];
    const batchSize = 100;

    for (let i = 0; i < eventIds.length; i += batchSize) {
      const batch = eventIds.slice(i, i + batchSize);

      try {
        const response = await this.http.request<Event[]>(
          {
            url: 'https://apim.rec.net/apis/api/playerevents/v1/bulk',
            method: 'POST',
            data: { ids: batch },
            headers: {
              'Content-Type': 'application/json',
            },
          },
          token
        );

        if (response.success && Array.isArray(response.value)) {
          const transformedEvents = response.value.map((event: Event) => ({
            ...event,
            PlayerEventId: event.PlayerEventId.toString(),
            CreatorPlayerId: event.CreatorPlayerId.toString(),
            RoomId: event.RoomId.toString(),
          }));
          results.push(...transformedEvents);
        } else {
          console.log(
            `Failed to fetch batch of events: status ${response.status} - ${response.message || response.error}`
          );
        }
      } catch (error) {
        console.log(
          `Failed to fetch batch of events: ${(error as Error).message}`
        );
      }

      if (i + batchSize < eventIds.length) {
        await this.delayBetweenBatches();
      }
    }

    return results;
  }

  private delayBetweenBatches(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 100));
  }
}
