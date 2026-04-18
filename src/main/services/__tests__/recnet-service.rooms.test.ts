import * as fs from 'fs-extra';
import * as path from 'path';
import { RecNetService } from '../recnet-service';
import { PhotosController } from '../recnet/photos-controller';
import { RoomsController } from '../recnet/rooms-controller';
import { ImageDto } from '../../models/ImageDto';
import { GenericResponse } from '../../models/GenericResponse';

jest.mock('fs-extra', () => {
  const actualFs = jest.requireActual('fs-extra');
  return {
    ...actualFs,
    pathExists: jest.fn(),
    readJson: jest.fn(),
    writeFile: jest.fn(),
    writeJson: jest.fn(),
    ensureDir: jest.fn(),
    readdir: jest.fn(),
  };
});

jest.mock('../recnet/http-client');
jest.mock('../recnet/photos-controller');
jest.mock('../recnet/accounts-controller');
jest.mock('../recnet/rooms-controller');
jest.mock('../recnet/events-controller');
jest.mock('../recnet/image-comments-controller');

const mockedFs = fs as jest.Mocked<typeof fs>;

describe('RecNetService - Room Photo Batches', () => {
  let service: RecNetService;
  let mockPhotosController: jest.Mocked<PhotosController>;
  let mockRoomsController: jest.Mocked<RoomsController>;
  const outputRoot = path.join(__dirname, 'test-output', 'rooms');

  const createRoom = () =>
    ({
      RoomId: '2754290',
      Name: 'TheRoomies',
      CreatorAccountId: '1',
      RankedEntityId: '2754290',
    }) as any;

  const createPhoto = (id: string): ImageDto => ({
    Id: id,
    Type: 1,
    Accessibility: 1,
    AccessibilityLocked: false,
    ImageName: `${id}.jpg`,
    Description: '',
    PlayerId: `player-${id}`,
    TaggedPlayerIds: [],
    RoomId: '2754290',
    PlayerEventId: '',
    CreatedAt: new Date().toISOString(),
    CheerCount: 0,
    CommentCount: 0,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    service = new RecNetService();
    await service.updateSettings({
      outputRoot,
      maxConcurrentDownloads: 1,
      interPageDelayMs: 0,
    });
    jest.spyOn<any, any>(service as any, 'delay').mockResolvedValue(undefined);
    jest.spyOn(service, 'fetchAndSaveBulkData').mockResolvedValue({
      accountsFetched: 0,
      roomsFetched: 0,
      eventsFetched: 0,
      imageCommentsFetched: 0,
    });

    mockPhotosController = {
      downloadPhoto: jest.fn(),
      fetchPlayerPhotos: jest.fn(),
      fetchFeedPhotos: jest.fn(),
      fetchProfilePhotoHistory: jest.fn(),
      fetchRoomPhotos: jest.fn(),
    } as any;
    mockRoomsController = {
      lookupRoomByName: jest.fn(),
      fetchBulkRooms: jest.fn(),
    } as any;
    (service as any).photosController = mockPhotosController;
    (service as any).roomsController = mockRoomsController;

    (mockedFs.pathExists as jest.Mock).mockResolvedValue(false);
    (mockedFs.ensureDir as jest.Mock).mockResolvedValue(undefined);
    (mockedFs.writeJson as jest.Mock).mockResolvedValue(undefined);
    (mockedFs.writeFile as jest.Mock).mockResolvedValue(undefined);
    mockRoomsController.lookupRoomByName.mockResolvedValue(createRoom());
    mockPhotosController.downloadPhoto.mockResolvedValue({
      success: true,
      value: new ArrayBuffer(8),
      status: 200,
    } as GenericResponse<ArrayBuffer>);
  });

  it('writes room batches under outputRoot/rooms/<roomId>', async () => {
    mockPhotosController.fetchRoomPhotos
      .mockResolvedValueOnce([createPhoto('1'), createPhoto('2')])
      .mockResolvedValueOnce([createPhoto('3'), createPhoto('4')])
      .mockResolvedValueOnce([createPhoto('5'), createPhoto('6')])
      .mockResolvedValueOnce([createPhoto('7'), createPhoto('8')])
      .mockResolvedValueOnce([createPhoto('9'), createPhoto('10')]);

    const result = await service.downloadRoomPhotoBatch({
      roomName: 'TheRoomies',
      pageSize: 2,
    });

    const roomDir = path.join(outputRoot, 'rooms', '2754290');
    expect(result.roomDirectory).toBe(roomDir);
    expect(result.metadataPath).toBe(path.join(roomDir, '2754290_photos.json'));
    expect(result.pagesFetched).toBe(5);
    expect(result.hasMore).toBe(true);
    expect(result.nextSkip).toBe(10);
    expect(mockPhotosController.fetchRoomPhotos).toHaveBeenCalledTimes(5);
    expect(mockPhotosController.fetchRoomPhotos).toHaveBeenCalledWith(
      '2754290',
      { skip: 0, take: 2, filter: 1, sort: 0 },
      undefined,
      expect.any(Object)
    );
    expect(mockedFs.writeJson).toHaveBeenCalledWith(
      path.join(roomDir, '2754290_photos.json'),
      expect.any(Array),
      { spaces: 2 }
    );
    expect(mockedFs.writeJson).toHaveBeenCalledWith(
      path.join(roomDir, 'folder-meta.json'),
      expect.objectContaining({
        roomId: '2754290',
        roomName: 'TheRoomies',
        nextSkip: 10,
        roomPhotoCursors: {
          0: expect.objectContaining({
            nextSkip: 10,
            completed: false,
          }),
        },
      }),
      { spaces: 2 }
    );
  });

  it('stops a room batch early when the API returns a short page', async () => {
    mockPhotosController.fetchRoomPhotos
      .mockResolvedValueOnce([createPhoto('1'), createPhoto('2')])
      .mockResolvedValueOnce([createPhoto('3')]);

    const result = await service.downloadRoomPhotoBatch({
      roomName: 'TheRoomies',
      pageSize: 2,
    });

    expect(result.pagesFetched).toBe(2);
    expect(result.hasMore).toBe(false);
    expect(result.nextSkip).toBe(4);
    expect(result.totalPhotos).toBe(3);
    expect(mockPhotosController.fetchRoomPhotos).toHaveBeenCalledTimes(2);
  });

  it('tracks independent resume cursors for room photo sort modes', async () => {
    const roomDir = path.join(outputRoot, 'rooms', '2754290');
    const metadataPath = path.join(roomDir, '2754290_photos.json');
    const folderMetaPath = path.join(roomDir, 'folder-meta.json');

    (mockedFs.pathExists as jest.Mock).mockImplementation(async filePath => {
      return filePath === folderMetaPath || filePath === metadataPath;
    });
    (mockedFs.readJson as jest.Mock).mockImplementation(async filePath => {
      if (filePath === folderMetaPath) {
        return {
          schemaVersion: 1,
          roomId: '2754290',
          roomName: 'TheRoomies',
          displayLabel: 'TheRoomies',
          updatedAt: '2026-01-01T00:00:00.000Z',
          nextSkip: 500,
          roomPhotoCursors: {
            0: { nextSkip: 500, completed: false },
            1: { nextSkip: 200, completed: false },
          },
        };
      }
      if (filePath === metadataPath) {
        return [createPhoto('existing')];
      }
      return null;
    });
    mockPhotosController.fetchRoomPhotos.mockResolvedValueOnce([
      createPhoto('popular-201'),
    ]);

    const result = await service.downloadRoomPhotoBatch({
      roomName: 'TheRoomies',
      pageSize: 100,
      batchPages: 1,
      sort: 1,
    });

    expect(result.roomPhotoSort).toBe(1);
    expect(result.startSkip).toBe(200);
    expect(result.nextSkip).toBe(300);
    expect(result.totalPhotos).toBe(2);
    expect(mockPhotosController.fetchRoomPhotos).toHaveBeenCalledWith(
      '2754290',
      { skip: 200, take: 100, filter: 1, sort: 1 },
      undefined,
      expect.any(Object)
    );
    expect(mockedFs.writeJson).toHaveBeenCalledWith(
      folderMetaPath,
      expect.objectContaining({
        nextSkip: 500,
        roomPhotoCursors: {
          0: { nextSkip: 500, completed: false },
          1: expect.objectContaining({
            nextSkip: 300,
            completed: true,
          }),
        },
      }),
      { spaces: 2 }
    );
  });
});
