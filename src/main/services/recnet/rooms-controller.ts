import { RoomDto } from '../../models/RoomDto';
import { RecNetHttpClient } from './http-client';

export class RoomsController {
  constructor(private readonly http: RecNetHttpClient) {}

  async fetchBulkRooms(roomIds: string[], token?: string): Promise<RoomDto[]> {
    if (roomIds.length === 0) {
      return [];
    }

    const results: RoomDto[] = [];
    const batchSize = 100;

    for (let i = 0; i < roomIds.length; i += batchSize) {
      const batch = roomIds.slice(i, i + batchSize);

      try {
        const formData = new URLSearchParams();
        for (const id of batch) {
          formData.append('id', id);
        }

        const response = await this.http.request<RoomDto[]>(
          {
            url: 'https://rooms.rec.net/rooms/bulk',
            method: 'POST',
            data: formData.toString(),
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          },
          token
        );

        if (response.success && Array.isArray(response.value)) {
          results.push(
            ...response.value.map(room => ({
              ...room,
              RoomId: String(room.RoomId),
              CreatorAccountId: String(room.CreatorAccountId),
              RankedEntityId: String(room.RankedEntityId),
            }))
          );
        } else {
          console.log(
            `Failed to fetch batch of rooms: status ${response.status} - ${response.message || response.error}`
          );
        }
      } catch (error) {
        console.log(
          `Failed to fetch batch of rooms: ${(error as Error).message}`
        );
      }

      if (i + batchSize < roomIds.length) {
        await this.delayBetweenBatches();
      }
    }

    return results;
  }

  private delayBetweenBatches(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 100));
  }
}
