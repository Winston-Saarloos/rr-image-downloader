import { EventDto } from '../../models/EventDto';
import { RecNetHttpClient } from './http-client';

export class EventsController {
  constructor(private readonly http: RecNetHttpClient) {}

  async fetchBulkEvents(
    eventIds: string[],
    token?: string
  ): Promise<EventDto[]> {
    if (eventIds.length === 0) {
      return [];
    }

    const results: EventDto[] = [];
    const batchSize = 100;

    for (let i = 0; i < eventIds.length; i += batchSize) {
      const batch = eventIds.slice(i, i + batchSize);

      try {
        const response = await this.http.request<EventDto[]>(
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
          const transformedEvents = response.value.map((event: EventDto) => ({
            ...event,
            PlayerEventId: String(event.PlayerEventId),
            CreatorPlayerId: String(event.CreatorPlayerId),
            RoomId: String(event.RoomId),
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
