import { PhotosController } from '../photos-controller';
import { RoomsController } from '../rooms-controller';
import { EventsController } from '../events-controller';
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

  it('fetches creator event metadata with paging parameters', async () => {
    http.requestOrThrow.mockResolvedValue([
      {
        PlayerEventId: '2051021358685204130',
        CreatorPlayerId: '730697255',
        RoomId: '6897034601176031687',
        Name: 'Lost.home.forest',
      },
    ]);

    const controller = new EventsController(http as unknown as RecNetHttpClient);
    const result = await controller.fetchCreatorEvents(
      '730697255',
      { skip: 20, take: 20 },
      'token'
    );

    expect(http.requestOrThrow).toHaveBeenCalledWith(
      {
        url: 'https://apim.rec.net/apis/api/playerevents/v1/creator/730697255?skip=20&take=20',
        method: 'GET',
      },
      'token',
      undefined
    );
    expect(result[0].PlayerEventId).toBe('2051021358685204130');
    expect(result[0].CreatorPlayerId).toBe('730697255');
    expect(result[0].RoomId).toBe('6897034601176031687');
  });

  it('fetches event photo metadata with event paging parameters', async () => {
    http.requestOrThrow.mockResolvedValue([]);

    const controller = new PhotosController(http as unknown as RecNetHttpClient);
    await controller.fetchPlayerEventPhotos('2051021358685204130', {
      skip: 30,
      take: 30,
    });

    expect(http.requestOrThrow).toHaveBeenCalledWith(
      {
        url: 'https://apim.rec.net/apis/api/images/v1/playerevent/2051021358685204130?skip=30&take=30',
        method: 'GET',
      },
      undefined,
      undefined
    );
  });
});
