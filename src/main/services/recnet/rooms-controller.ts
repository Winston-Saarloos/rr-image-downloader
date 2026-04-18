import { RoomDto } from '../../models/RoomDto';
import {
  RecNetHttpClient,
  RecNetRequestOptions,
  UNIVERSAL_BATCH_SIZE,
} from './http-client';

export class RoomsController {
  constructor(private readonly http: RecNetHttpClient) {}

  async lookupRoomByName(
    roomName: string,
    token?: string,
    options?: RecNetRequestOptions
  ): Promise<RoomDto> {
    const room = await this.http.requestOrThrow<RoomDto>(
      {
        url: `https://rooms.rec.net/rooms?name=${encodeURIComponent(roomName)}&include=8489`,
        method: 'GET',
      },
      token,
      options
    );

    return {
      ...room,
      RoomId: String(room.RoomId),
      CreatorAccountId: String(room.CreatorAccountId),
      RankedEntityId: String(room.RankedEntityId),
    };
  }

  async fetchBulkRooms(
    roomIds: string[],
    token?: string,
    options?: RecNetRequestOptions
  ): Promise<RoomDto[]> {
    if (roomIds.length === 0) {
      return [];
    }

    const results: RoomDto[] = [];
    const batchSize = UNIVERSAL_BATCH_SIZE;

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
          token,
          options
        );

        if (response.success && Array.isArray(response.value)) {
          console.log(`Rooms pulled: ${response.value.length}`)
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
    }

    return results;
  }
}
