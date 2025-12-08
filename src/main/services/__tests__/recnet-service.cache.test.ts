/**
 * Tests for RecNetService data caching functionality
 *
 * This test suite verifies the caching system for accounts, rooms, and events data:
 * - Using cached data when available to avoid unnecessary API calls
 * - Fetching only missing data and merging with cache
 * - Force refresh option to bypass cache
 * - Handling corrupted cache files gracefully
 *
 * Caching is important for performance and to respect API rate limits.
 * These tests ensure the cache works correctly in all scenarios.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { RecNetService } from '../recnet-service';
import { AccountsController } from '../recnet/accounts-controller';
import { RoomsController } from '../recnet/rooms-controller';
import { EventsController } from '../recnet/events-controller';
import { PlayerResult } from '../../models/PlayerDto';
import { RoomDto } from '../../models/RoomDto';
import { EventDto } from '../../models/EventDto';
import { ImageDto } from '../../models/ImageDto';

// Mock dependencies
jest.mock('fs-extra', () => {
  const actualFs = jest.requireActual('fs-extra');
  return {
    ...actualFs,
    pathExists: jest.fn(),
    readJson: jest.fn(),
    writeJson: jest.fn(),
    ensureDir: jest.fn(),
    remove: jest.fn(),
  };
});

jest.mock('../recnet/http-client');
jest.mock('../recnet/photos-controller');
jest.mock('../recnet/accounts-controller');
jest.mock('../recnet/rooms-controller');
jest.mock('../recnet/events-controller');

const mockedFs = fs as jest.Mocked<typeof fs>;

describe('RecNetService - Caching Functionality', () => {
  let service: RecNetService;
  let testOutputDir: string;
  let testAccountId: string;
  let mockAccountsController: jest.Mocked<AccountsController>;
  let mockRoomsController: jest.Mocked<RoomsController>;
  let mockEventsController: jest.Mocked<EventsController>;

  beforeEach(() => {
    testOutputDir = path.join(__dirname, 'test-output', `test-${Date.now()}`);
    testAccountId = '256147';

    jest.clearAllMocks();

    service = new RecNetService();
    service.updateSettings({ outputRoot: testOutputDir });

    // Setup controller mocks
    mockAccountsController = {
      fetchBulkAccounts: jest.fn(),
    } as any;

    mockRoomsController = {
      fetchBulkRooms: jest.fn(),
    } as any;

    mockEventsController = {
      fetchBulkEvents: jest.fn(),
    } as any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).accountsController = mockAccountsController;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).roomsController = mockRoomsController;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).eventsController = mockEventsController;
  });

  afterEach(async () => {
    // Cleanup test directory if it exists
    try {
      const actualFs = jest.requireActual('fs-extra');
      if (await actualFs.pathExists(testOutputDir)) {
        await actualFs.remove(testOutputDir);
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Tests for account data caching
   *
   * Account data includes user information like usernames, display names, etc.
   * This data is extracted from photos and cached to avoid repeated API calls
   * for the same accounts across multiple photo collections.
   */
  describe('fetchAndSaveBulkData - Accounts Caching', () => {
    const createMockAccount = (id: string): PlayerResult => ({
      accountId: id,
      username: `user-${id}`,
      displayName: `User ${id}`,
      displayEmoji: '😀',
      profileImage: 'profile.jpg',
      bannerImage: 'banner.jpg',
      isJunior: false,
      platforms: 1,
      personalPronouns: 0,
      identityFlags: 0,
      createdAt: new Date().toISOString(),
      isMetaPlatformBlocked: false,
    });

    const createMockPhoto = (
      accountId: string,
      roomId: string,
      eventId: string
    ): ImageDto => ({
      Id: 'photo-1',
      Type: 1,
      Accessibility: 0,
      AccessibilityLocked: false,
      ImageName: 'image.jpg',
      Description: '',
      PlayerId: accountId,
      TaggedPlayerIds: [],
      RoomId: roomId,
      PlayerEventId: eventId,
      CreatedAt: new Date().toISOString(),
      CheerCount: 0,
      CommentCount: 0,
    });

    /**
     * Verifies that when cached account data exists and force refresh is not enabled,
     * the cached data is used without making API calls. This improves performance
     * and reduces API load.
     */
    it('should use cached accounts when available and not forcing refresh', async () => {
      const cachedAccounts: PlayerResult[] = [
        createMockAccount('account-1'),
        createMockAccount('account-2'),
      ];

      const photos: ImageDto[] = [
        createMockPhoto('account-1', 'room-1', 'event-1'),
        createMockPhoto('account-2', 'room-1', 'event-1'),
      ];

      const accountDir = path.join(testOutputDir, testAccountId);
      const accountsJsonPath = path.join(
        accountDir,
        `${testAccountId}_accounts.json`
      );

      (mockedFs.pathExists as jest.Mock).mockImplementation(
        async (p: string) => {
          if (p === accountsJsonPath) return true;
          return false;
        }
      );

      (mockedFs.readJson as jest.Mock).mockImplementation(async (p: string) => {
        if (p === accountsJsonPath) return cachedAccounts;
        return [];
      });

      const result = await service.fetchAndSaveBulkData(
        testAccountId,
        photos,
        undefined,
        { forceAccountsRefresh: false }
      );

      expect(result.accountsFetched).toBe(0); // No new accounts fetched
      expect(mockAccountsController.fetchBulkAccounts).not.toHaveBeenCalled();
    });

    /**
     * Verifies that only missing accounts are fetched from the API, and the results
     * are merged with existing cached data. This incremental update approach
     * minimizes API calls while keeping the cache up-to-date.
     */
    it('should fetch missing accounts and merge with cache', async () => {
      const cachedAccounts: PlayerResult[] = [createMockAccount('account-1')];
      const newAccounts: PlayerResult[] = [createMockAccount('account-2')];

      const photos: ImageDto[] = [
        createMockPhoto('account-1', 'room-1', 'event-1'),
        createMockPhoto('account-2', 'room-1', 'event-1'),
      ];

      const accountDir = path.join(testOutputDir, testAccountId);
      const accountsJsonPath = path.join(
        accountDir,
        `${testAccountId}_accounts.json`
      );

      (mockedFs.pathExists as jest.Mock).mockImplementation(
        async (p: string) => {
          if (p === accountsJsonPath) return true;
          return false;
        }
      );

      (mockedFs.readJson as jest.Mock).mockImplementation(async (p: string) => {
        if (p === accountsJsonPath) return cachedAccounts;
        return [];
      });

      mockAccountsController.fetchBulkAccounts.mockResolvedValue(newAccounts);

      const result = await service.fetchAndSaveBulkData(
        testAccountId,
        photos,
        undefined,
        { forceAccountsRefresh: false }
      );

      expect(result.accountsFetched).toBe(1);
      expect(mockAccountsController.fetchBulkAccounts).toHaveBeenCalledWith(
        ['account-2'],
        undefined
      );
      expect(mockedFs.writeJson).toHaveBeenCalled();
    });

    /**
     * Verifies that when forceAccountsRefresh is enabled, all accounts are
     * re-fetched from the API regardless of cache status. This is useful when
     * you want to ensure you have the latest account information.
     */
    it('should force refresh accounts when forceAccountsRefresh is true', async () => {
      const cachedAccounts: PlayerResult[] = [createMockAccount('account-1')];
      const freshAccounts: PlayerResult[] = [
        createMockAccount('account-1'),
        createMockAccount('account-2'),
      ];

      const photos: ImageDto[] = [
        createMockPhoto('account-1', 'room-1', 'event-1'),
        createMockPhoto('account-2', 'room-1', 'event-1'),
      ];

      const accountDir = path.join(testOutputDir, testAccountId);
      const accountsJsonPath = path.join(
        accountDir,
        `${testAccountId}_accounts.json`
      );

      (mockedFs.pathExists as jest.Mock).mockImplementation(
        async (p: string) => {
          if (p === accountsJsonPath) return true;
          return false;
        }
      );

      (mockedFs.readJson as jest.Mock).mockImplementation(async (p: string) => {
        if (p === accountsJsonPath) return cachedAccounts;
        return [];
      });

      mockAccountsController.fetchBulkAccounts.mockResolvedValue(freshAccounts);

      const result = await service.fetchAndSaveBulkData(
        testAccountId,
        photos,
        undefined,
        { forceAccountsRefresh: true }
      );

      expect(result.accountsFetched).toBe(2);
      expect(mockAccountsController.fetchBulkAccounts).toHaveBeenCalledWith(
        ['account-1', 'account-2'],
        undefined
      );
    });

    /**
     * Verifies that when no cache file exists, all accounts are fetched and
     * a new cache file is created. This handles the first-run scenario.
     */
    it('should create cache file if it does not exist', async () => {
      const newAccounts: PlayerResult[] = [createMockAccount('account-1')];

      const photos: ImageDto[] = [
        createMockPhoto('account-1', 'room-1', 'event-1'),
      ];

      (mockedFs.pathExists as jest.Mock).mockResolvedValue(false);

      mockAccountsController.fetchBulkAccounts.mockResolvedValue(newAccounts);

      const result = await service.fetchAndSaveBulkData(
        testAccountId,
        photos,
        undefined,
        { forceAccountsRefresh: false }
      );

      expect(result.accountsFetched).toBe(1);
      expect(mockAccountsController.fetchBulkAccounts).toHaveBeenCalled();
      expect(mockedFs.writeJson).toHaveBeenCalled();
    });

    /**
     * Verifies that when an accounts cache file exists but cannot be read,
     * the service falls back to fetching all accounts instead of failing.
     */
    it('should refetch accounts when cache read fails', async () => {
      const photos: ImageDto[] = [
        createMockPhoto('account-1', 'room-1', 'event-1'),
      ];

      const accountDir = path.join(testOutputDir, testAccountId);
      const accountsJsonPath = path.join(
        accountDir,
        `${testAccountId}_accounts.json`
      );

      (mockedFs.pathExists as jest.Mock).mockImplementation(
        async (p: string) => p === accountsJsonPath
      );
      (mockedFs.readJson as jest.Mock).mockRejectedValue(
        new Error('Bad cache')
      );

      const refreshedAccounts: PlayerResult[] = [
        createMockAccount('account-1'),
      ];
      mockAccountsController.fetchBulkAccounts.mockResolvedValue(
        refreshedAccounts
      );

      const result = await service.fetchAndSaveBulkData(
        testAccountId,
        photos,
        undefined,
        { forceAccountsRefresh: false }
      );

      expect(result.accountsFetched).toBe(1);
      expect(mockAccountsController.fetchBulkAccounts).toHaveBeenCalledWith(
        ['account-1'],
        undefined
      );
      expect(mockedFs.writeJson).toHaveBeenCalled();
    });
  });

  /**
   * Tests for room data caching
   *
   * Room data includes information about Rec Room spaces where photos were taken.
   * Similar to accounts, this data is cached to avoid redundant API calls.
   */
  describe('fetchAndSaveBulkData - Rooms Caching', () => {
    const createMockRoom = (id: string): RoomDto => ({
      RoomId: id,
      Name: `Room ${id}`,
      Description: '',
      ImageName: 'room.jpg',
      WarningMask: 0,
      CustomWarning: null,
      CreatorAccountId: 'creator-1',
      State: 0,
      Accessibility: 0,
      PublishState: 0,
      SupportsLevelVoting: false,
      IsRRO: false,
      IsRecRoomApproved: false,
      ExcludeFromLists: false,
      ExcludeFromSearch: false,
      SupportsScreens: false,
      SupportsWalkVR: false,
      SupportsTeleportVR: false,
      SupportsVRLow: false,
      SupportsQuest2: false,
      SupportsMobile: false,
      SupportsJuniors: false,
      MinLevel: 0,
      AgeRating: 0,
      CreatedAt: new Date().toISOString(),
      PublishedAt: new Date().toISOString(),
      BecameRRStudioRoomAt: '',
      Stats: {
        CheerCount: 0,
        FavoriteCount: 0,
        VisitorCount: 0,
        VisitCount: 0,
      },
      RankingContext: null,
      IsDorm: false,
      IsPlacePlay: false,
      MaxPlayersCalculationMode: 0,
      MaxPlayers: 0,
      CloningAllowed: false,
      DisableMicAutoMute: false,
      DisableRoomComments: false,
      EncryptVoiceChat: false,
      ToxmodEnabled: false,
      LoadScreenLocked: false,
      UgcVersion: 0,
      PersistenceVersion: 0,
      UgcSubVersion: 0,
      MinUgcSubVersion: 0,
      AutoLocalizedRoom: false,
      IsDeveloperOwned: false,
      RankedEntityId: '',
      BoostCount: 0,
    });

    const createMockPhoto = (roomId: string, eventId: string): ImageDto => ({
      Id: 'photo-1',
      Type: 1,
      Accessibility: 0,
      AccessibilityLocked: false,
      ImageName: 'image.jpg',
      Description: '',
      PlayerId: 'player-1',
      TaggedPlayerIds: [],
      RoomId: roomId,
      PlayerEventId: eventId,
      CreatedAt: new Date().toISOString(),
      CheerCount: 0,
      CommentCount: 0,
    });

    /**
     * Verifies that cached room data is used when available, avoiding API calls.
     */
    it('should use cached rooms when available', async () => {
      const cachedRooms: RoomDto[] = [createMockRoom('room-1')];

      const photos: ImageDto[] = [createMockPhoto('room-1', 'event-1')];

      const accountDir = path.join(testOutputDir, testAccountId);
      const roomsJsonPath = path.join(
        accountDir,
        `${testAccountId}_rooms.json`
      );

      (mockedFs.pathExists as jest.Mock).mockImplementation(
        async (p: string) => {
          if (p === roomsJsonPath) return true;
          return false;
        }
      );

      (mockedFs.readJson as jest.Mock).mockImplementation(async (p: string) => {
        if (p === roomsJsonPath) return cachedRooms;
        return [];
      });

      const result = await service.fetchAndSaveBulkData(
        testAccountId,
        photos,
        undefined,
        { forceRoomsRefresh: false }
      );

      expect(result.roomsFetched).toBe(0);
      expect(mockRoomsController.fetchBulkRooms).not.toHaveBeenCalled();
    });

    /**
     * Verifies that only missing rooms are fetched and merged with cached data.
     */
    it('should fetch missing rooms and merge with cache', async () => {
      const cachedRooms: RoomDto[] = [createMockRoom('room-1')];
      const newRooms: RoomDto[] = [createMockRoom('room-2')];

      const photos: ImageDto[] = [
        createMockPhoto('room-1', 'event-1'),
        createMockPhoto('room-2', 'event-1'),
      ];

      const accountDir = path.join(testOutputDir, testAccountId);
      const roomsJsonPath = path.join(
        accountDir,
        `${testAccountId}_rooms.json`
      );

      (mockedFs.pathExists as jest.Mock).mockImplementation(
        async (p: string) => {
          if (p === roomsJsonPath) return true;
          return false;
        }
      );

      (mockedFs.readJson as jest.Mock).mockImplementation(async (p: string) => {
        if (p === roomsJsonPath) return cachedRooms;
        return [];
      });

      mockRoomsController.fetchBulkRooms.mockResolvedValue(newRooms);

      const result = await service.fetchAndSaveBulkData(
        testAccountId,
        photos,
        undefined,
        { forceRoomsRefresh: false }
      );

      expect(result.roomsFetched).toBe(1);
      expect(mockRoomsController.fetchBulkRooms).toHaveBeenCalledWith(
        ['room-2'],
        undefined
      );
    });

    /**
     * Verifies that when forceRoomsRefresh is enabled, all rooms are re-fetched
     * even if they already exist in the cache.
     */
    it('should force refresh rooms when forceRoomsRefresh is true', async () => {
      const photos: ImageDto[] = [
        createMockPhoto('room-1', 'event-1'),
        createMockPhoto('room-2', 'event-2'),
      ];

      const accountDir = path.join(testOutputDir, testAccountId);
      const roomsJsonPath = path.join(
        accountDir,
        `${testAccountId}_rooms.json`
      );

      (mockedFs.pathExists as jest.Mock).mockImplementation(
        async (p: string) => p === roomsJsonPath
      );
      (mockedFs.readJson as jest.Mock).mockImplementation(async (p: string) => {
        if (p === roomsJsonPath) return [createMockRoom('room-1')];
        return [];
      });

      const refreshedRooms: RoomDto[] = [
        createMockRoom('room-1'),
        createMockRoom('room-2'),
      ];
      mockRoomsController.fetchBulkRooms.mockResolvedValue(refreshedRooms);

      const result = await service.fetchAndSaveBulkData(
        testAccountId,
        photos,
        undefined,
        { forceRoomsRefresh: true }
      );

      expect(result.roomsFetched).toBe(2);
      expect(mockRoomsController.fetchBulkRooms).toHaveBeenCalledWith(
        ['room-1', 'room-2'],
        undefined
      );
    });

    /**
     * Verifies that corrupted room cache files trigger a full refresh instead of failing.
     */
    it('should refetch rooms when cache read fails', async () => {
      const photos: ImageDto[] = [createMockPhoto('room-1', 'event-1')];

      const accountDir = path.join(testOutputDir, testAccountId);
      const roomsJsonPath = path.join(
        accountDir,
        `${testAccountId}_rooms.json`
      );

      (mockedFs.pathExists as jest.Mock).mockImplementation(
        async (p: string) => p === roomsJsonPath
      );
      (mockedFs.readJson as jest.Mock).mockRejectedValue(
        new Error('Rooms cache corrupted')
      );

      const refreshedRooms: RoomDto[] = [createMockRoom('room-1')];
      mockRoomsController.fetchBulkRooms.mockResolvedValue(refreshedRooms);

      const result = await service.fetchAndSaveBulkData(
        testAccountId,
        photos,
        undefined,
        { forceRoomsRefresh: false }
      );

      expect(result.roomsFetched).toBe(1);
      expect(mockRoomsController.fetchBulkRooms).toHaveBeenCalledWith(
        ['room-1'],
        undefined
      );
      expect(mockedFs.writeJson).toHaveBeenCalled();
    });
  });

  /**
   * Tests for event data caching
   *
   * Event data includes information about Rec Room events where photos were taken.
   * Events are cached similarly to accounts and rooms.
   */
  describe('fetchAndSaveBulkData - Events Caching', () => {
    const createMockEvent = (id: string): EventDto => ({
      PlayerEventId: id,
      CreatorPlayerId: 'creator-1',
      ImageName: null,
      RoomId: 'room-1',
      SubRoomId: null,
      ClubId: null,
      Name: `Event ${id}`,
      Description: '',
      StartTime: new Date().toISOString(),
      EndTime: new Date().toISOString(),
      AttendeeCount: 0,
      State: 0,
      AccessibilityLevel: 0,
      IsMultiInstance: false,
      SupportMultiInstanceRoomChat: false,
      BroadcastingRoomInstanceId: null,
      DefaultBroadcastPermissions: 0,
      CanRequestBroadcastPermissions: 0,
      RecurrenceSchedule: null,
    });

    const createMockPhoto = (eventId: string): ImageDto => ({
      Id: 'photo-1',
      Type: 1,
      Accessibility: 0,
      AccessibilityLocked: false,
      ImageName: 'image.jpg',
      Description: '',
      PlayerId: 'player-1',
      TaggedPlayerIds: [],
      RoomId: 'room-1',
      PlayerEventId: eventId,
      CreatedAt: new Date().toISOString(),
      CheerCount: 0,
      CommentCount: 0,
    });

    /**
     * Verifies that cached event data is used when available.
     */
    it('should use cached events when available', async () => {
      const cachedEvents: EventDto[] = [createMockEvent('event-1')];

      const photos: ImageDto[] = [createMockPhoto('event-1')];

      const accountDir = path.join(testOutputDir, testAccountId);
      const eventsJsonPath = path.join(
        accountDir,
        `${testAccountId}_events.json`
      );

      (mockedFs.pathExists as jest.Mock).mockImplementation(
        async (p: string) => {
          if (p === eventsJsonPath) return true;
          return false;
        }
      );

      (mockedFs.readJson as jest.Mock).mockImplementation(async (p: string) => {
        if (p === eventsJsonPath) return cachedEvents;
        return [];
      });

      const result = await service.fetchAndSaveBulkData(
        testAccountId,
        photos,
        undefined,
        { forceEventsRefresh: false }
      );

      expect(result.eventsFetched).toBe(0);
      expect(mockEventsController.fetchBulkEvents).not.toHaveBeenCalled();
    });

    /**
     * Verifies that only missing events are fetched and merged with cached data.
     */
    it('should fetch missing events and merge with cache', async () => {
      const cachedEvents: EventDto[] = [createMockEvent('event-1')];
      const newEvents: EventDto[] = [createMockEvent('event-2')];

      const photos: ImageDto[] = [
        createMockPhoto('event-1'),
        createMockPhoto('event-2'),
      ];

      const accountDir = path.join(testOutputDir, testAccountId);
      const eventsJsonPath = path.join(
        accountDir,
        `${testAccountId}_events.json`
      );

      (mockedFs.pathExists as jest.Mock).mockImplementation(
        async (p: string) => {
          if (p === eventsJsonPath) return true;
          return false;
        }
      );

      (mockedFs.readJson as jest.Mock).mockImplementation(async (p: string) => {
        if (p === eventsJsonPath) return cachedEvents;
        return [];
      });

      mockEventsController.fetchBulkEvents.mockResolvedValue(newEvents);

      const result = await service.fetchAndSaveBulkData(
        testAccountId,
        photos,
        undefined,
        { forceEventsRefresh: false }
      );

      expect(result.eventsFetched).toBe(1);
      expect(mockEventsController.fetchBulkEvents).toHaveBeenCalledWith(
        ['event-2'],
        undefined
      );
    });

    /**
     * Verifies that when forceEventsRefresh is enabled, all events are fetched
     * regardless of what exists in the cache.
     */
    it('should force refresh events when forceEventsRefresh is true', async () => {
      const photos: ImageDto[] = [
        createMockPhoto('event-1'),
        createMockPhoto('event-2'),
      ];

      const accountDir = path.join(testOutputDir, testAccountId);
      const eventsJsonPath = path.join(
        accountDir,
        `${testAccountId}_events.json`
      );

      (mockedFs.pathExists as jest.Mock).mockImplementation(
        async (p: string) => p === eventsJsonPath
      );
      (mockedFs.readJson as jest.Mock).mockImplementation(async (p: string) => {
        if (p === eventsJsonPath) return [createMockEvent('event-1')];
        return [];
      });

      const refreshedEvents: EventDto[] = [
        createMockEvent('event-1'),
        createMockEvent('event-2'),
      ];
      mockEventsController.fetchBulkEvents.mockResolvedValue(refreshedEvents);

      const result = await service.fetchAndSaveBulkData(
        testAccountId,
        photos,
        undefined,
        { forceEventsRefresh: true }
      );

      expect(result.eventsFetched).toBe(2);
      expect(mockEventsController.fetchBulkEvents).toHaveBeenCalledWith(
        ['event-1', 'event-2'],
        undefined
      );
    });

    /**
     * Verifies that if a cache file exists but is corrupted (invalid JSON),
     * the error is caught and the system falls back to fetching fresh data
     * rather than crashing. This ensures robustness against file system issues.
     */
    it('should handle corrupted cache files gracefully', async () => {
      const photos: ImageDto[] = [createMockPhoto('event-1')];

      (mockedFs.pathExists as jest.Mock).mockResolvedValue(true);
      (mockedFs.readJson as jest.Mock).mockRejectedValue(
        new Error('Invalid JSON')
      );

      const newEvents: EventDto[] = [createMockEvent('event-1')];
      mockEventsController.fetchBulkEvents.mockResolvedValue(newEvents);

      // Should not throw, should continue and fetch fresh data
      const result = await service.fetchAndSaveBulkData(
        testAccountId,
        photos,
        undefined,
        { forceEventsRefresh: false }
      );

      expect(result.eventsFetched).toBe(1);
    });
  });
});
