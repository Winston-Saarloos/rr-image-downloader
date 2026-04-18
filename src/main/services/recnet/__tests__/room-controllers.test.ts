import { PhotosController } from '../photos-controller';
import { RoomsController } from '../rooms-controller';
import { RecNetHttpClient } from '../http-client';

describe('room RecNet controllers', () => {
  let http: jest.Mocked<Pick<RecNetHttpClient, 'requestOrThrow' | 'request'>>;

  beforeEach(() => {
    http = {
      requestOrThrow: jest.fn(),
      request: jest.fn(),
    };
  });

  it('looks up room metadata by name with include flags', async () => {
    http.requestOrThrow.mockResolvedValue({
      RoomId: 2754290,
      Name: 'TheRoomies',
      CreatorAccountId: 1,
      RankedEntityId: '2754290',
    });

    const controller = new RoomsController(http as unknown as RecNetHttpClient);
    const result = await controller.lookupRoomByName('The Roomies', 'token');

    expect(http.requestOrThrow).toHaveBeenCalledWith(
      {
        url: 'https://rooms.rec.net/rooms?name=The%20Roomies&include=8489',
        method: 'GET',
      },
      'token',
      undefined
    );
    expect(result.RoomId).toBe('2754290');
    expect(result.CreatorAccountId).toBe('1');
  });

  it('fetches room photo metadata with room paging parameters', async () => {
    http.requestOrThrow.mockResolvedValue([]);

    const controller = new PhotosController(http as unknown as RecNetHttpClient);
    await controller.fetchRoomPhotos('2754290', {
      skip: 100,
      take: 100,
      filter: 1,
      sort: 1,
    });

    expect(http.requestOrThrow).toHaveBeenCalledWith(
      {
        url: 'https://apim.rec.net/apis/api/images/v4/room/2754290?skip=100&take=100&filter=1&sort=1',
        method: 'GET',
      },
      undefined,
      undefined
    );
  });
});
