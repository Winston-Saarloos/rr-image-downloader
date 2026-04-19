import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import {
  Search,
  Filter,
  ArrowUpDown,
  Heart,
  ArrowLeft,
  Calendar,
  Download,
  Image as ImageIcon,
  Users,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Photo,
  AvailableAccount,
  AvailableEvent,
  AvailableEventCreator,
  AvailableRoom,
  EventDto,
  ImageCommentDto,
  RoomDto,
  PlayerResult,
} from '../../shared/types';
import { DEFAULT_CDN_BASE } from '../../shared/cdnUrl';
import { PhotoGrid } from './PhotoGrid';
import { PhotoDetailModal } from './PhotoDetailModal';
import { AccountSelect } from './AccountSelect';
import { useFavorites } from '../hooks/useFavorites';
import { RoomSelect } from './RoomSelect';
import type { EventDownloadIntent, LibraryMode } from '../../shared/types';
import { EventCoverImage } from './EventCoverImage';

interface PhotoViewerProps {
  filePath: string;
  accountId?: string;
  roomId?: string;
  eventCreatorId?: string;
  libraryMode?: LibraryMode;
  isDownloading?: boolean;
  onAccountChange?: (accountId: string | undefined) => void;
  onRoomChange?: (roomId: string | undefined) => void;
  onEventCreatorChange?: (creatorAccountId: string | undefined) => void;
  onScrollPositionChange?: (scrollTop: number) => void;
  scrollContainerRef?: React.RefObject<HTMLDivElement>;
  headerMode?: 'full' | 'compact' | 'hidden';
  onOpenActivityMenu?: () => void;
  onOpenDownloadPanel?: (intent?: EventDownloadIntent) => void;
  onRevealOutputFolder?: () => void;
  onPhotosLoadError?: (message: string) => void;
  onPhotosLoadSuccess?: () => void;
  cdnBase?: string;
}

type PhotoSource = 'photos' | 'feed' | 'profile-history';

export const PhotoViewer: React.FC<PhotoViewerProps> = ({
  filePath,
  accountId: propAccountId,
  roomId: propRoomId,
  eventCreatorId: propEventCreatorId,
  libraryMode = 'user',
  isDownloading = false,
  onAccountChange,
  onRoomChange,
  onEventCreatorChange,
  onScrollPositionChange,
  scrollContainerRef,
  headerMode = 'full',
  onOpenActivityMenu,
  onOpenDownloadPanel,
  onRevealOutputFolder,
  onPhotosLoadError,
  onPhotosLoadSuccess,
  cdnBase = DEFAULT_CDN_BASE,
}) => {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [groupBy, setGroupBy] = useState<
    'none' | 'room' | 'user' | 'date' | 'event'
  >('none');
  const [sortBy, setSortBy] = useState<
    'oldest-to-newest' | 'newest-to-oldest' | 'most-cheered' | 'most-comments'
  >('newest-to-oldest');
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [availableAccounts, setAvailableAccounts] = useState<
    AvailableAccount[]
  >([]);
  const [availableRooms, setAvailableRooms] = useState<AvailableRoom[]>([]);
  const [availableEvents, setAvailableEvents] = useState<AvailableEvent[]>([]);
  const [availableEventCreators, setAvailableEventCreators] = useState<
    AvailableEventCreator[]
  >([]);
  const [selectedEvent, setSelectedEvent] = useState<AvailableEvent | null>(
    null
  );
  const [selectedAccountId, setSelectedAccountId] = useState<
    string | undefined
  >(propAccountId);
  const [selectedRoomId, setSelectedRoomId] = useState<string | undefined>(
    propRoomId
  );
  const [selectedEventCreatorId, setSelectedEventCreatorId] = useState<
    string | undefined
  >(propEventCreatorId);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [roomMap, setRoomMap] = useState<Map<string, string>>(new Map());
  const [accountMap, setAccountMap] = useState<Map<string, string>>(new Map());
  const [usernameMap, setUsernameMap] = useState<Map<string, string>>(
    new Map()
  );
  const [eventMap, setEventMap] = useState<Map<string, string>>(new Map());
  const [imageComments, setImageComments] = useState<ImageCommentDto[]>([]);
  const [feedPhotos, setFeedPhotos] = useState<Photo[]>([]);
  const [profileHistoryPhotos, setProfileHistoryPhotos] = useState<Photo[]>([]);
  const [photoSource, setPhotoSource] = useState<PhotoSource>('photos');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [eventAlbumScrollTop, setEventAlbumScrollTop] = useState(0);
  const [eventAlbumGridSize, setEventAlbumGridSize] = useState({
    width: 0,
    height: 700,
  });
  const internalScrollRef = useRef<HTMLDivElement | null>(null);
  const wasDownloadingRef = useRef(false);
  const onPhotosLoadErrorRef = useRef(onPhotosLoadError);
  const onPhotosLoadSuccessRef = useRef(onPhotosLoadSuccess);
  const activeScrollRef = scrollContainerRef ?? internalScrollRef;
  const { favorites } = useFavorites();
  const electronAPI = (window as unknown as { electronAPI?: any }).electronAPI;
  const isHeaderVisible = headerMode !== 'hidden';
  const showFullControls = headerMode === 'full';

  useEffect(() => {
    onPhotosLoadErrorRef.current = onPhotosLoadError;
  }, [onPhotosLoadError]);

  useEffect(() => {
    onPhotosLoadSuccessRef.current = onPhotosLoadSuccess;
  }, [onPhotosLoadSuccess]);

  // Use propAccountId if provided, otherwise use selectedAccountId
  const accountId = propAccountId || selectedAccountId;
  const roomId = propRoomId || selectedRoomId;
  const eventCreatorId = propEventCreatorId || selectedEventCreatorId;
  const activeLibraryId =
    libraryMode === 'room'
      ? roomId
      : libraryMode === 'event'
        ? selectedEvent?.eventId
        : accountId;
  const basePhotos =
    libraryMode === 'room' || libraryMode === 'event'
      ? photos
      : photoSource === 'feed'
      ? feedPhotos
      : photoSource === 'profile-history'
        ? profileHistoryPhotos
        : photos;

  // Filter photos based on favorites filter
  const activePhotos = useMemo(() => {
    if (!showFavoritesOnly) return basePhotos;
    return basePhotos.filter(photo => favorites.has(photo.Id.toString()));
  }, [basePhotos, showFavoritesOnly, favorites]);

  const activeViewLabel =
    libraryMode === 'room'
      ? 'room photos'
      : libraryMode === 'event'
        ? 'event photos'
      : photoSource === 'feed'
      ? 'feed photos'
      : photoSource === 'profile-history'
        ? 'profile picture history'
        : 'photos';
  const hasUserPhotos = photos.length > 0;
  const hasFeedPhotos = feedPhotos.length > 0;
  const hasProfileHistoryPhotos = profileHistoryPhotos.length > 0;
  const hasPhotoSections =
    libraryMode === 'room'
      ? hasUserPhotos
      : libraryMode === 'event'
        ? hasUserPhotos
      : hasUserPhotos || hasFeedPhotos || hasProfileHistoryPhotos;

  const loadAvailableAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      if (electronAPI) {
        const result = await electronAPI.listAvailableAccounts();
        if (result.success && result.data) {
          setAvailableAccounts(result.data);
          // If no account is selected and accounts are available, select the first one
          if (!selectedAccountId && !propAccountId && result.data.length > 0) {
            const firstAccountId = result.data[0].accountId;
            setSelectedAccountId(firstAccountId);
            setPhotoSource('photos');
            if (onAccountChange) {
              onAccountChange(firstAccountId);
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to load available accounts:', error);
    } finally {
      setLoadingAccounts(false);
    }
  }, [electronAPI, selectedAccountId, propAccountId, onAccountChange]);

  const loadAvailableRooms = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      if (electronAPI) {
        const result = await electronAPI.listAvailableRooms();
        if (result.success && result.data) {
          setAvailableRooms(result.data);
          if (!selectedRoomId && !propRoomId && result.data.length > 0) {
            const firstRoomId = result.data[0].roomId;
            setSelectedRoomId(firstRoomId);
            setPhotoSource('photos');
            onRoomChange?.(firstRoomId);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load available rooms:', error);
    } finally {
      setLoadingAccounts(false);
    }
  }, [electronAPI, onRoomChange, propRoomId, selectedRoomId]);

  const loadAvailableEventCreators = useCallback(async () => {
    try {
      if (electronAPI) {
        const result = await electronAPI.listAvailableEventCreators();
        if (result.success && result.data) {
          setAvailableEventCreators(result.data);
          if (
            libraryMode === 'event' &&
            !selectedEventCreatorId &&
            !propEventCreatorId &&
            result.data.length > 0
          ) {
            const firstCreatorId = result.data[0].creatorAccountId;
            setSelectedEventCreatorId(firstCreatorId);
            onEventCreatorChange?.(firstCreatorId);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load available event creators:', error);
      setAvailableEventCreators([]);
    }
  }, [
    electronAPI,
    libraryMode,
    onEventCreatorChange,
    propEventCreatorId,
    selectedEventCreatorId,
  ]);

  const loadAvailableEvents = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      if (electronAPI) {
        const creatorId = eventCreatorId || selectedEventCreatorId;
        const result = creatorId
          ? await electronAPI.loadEventAlbumsForCreator(creatorId)
          : await electronAPI.listAvailableEvents();
        if (result.success && result.data) {
          setAvailableEvents(result.data);
        }
      }
    } catch (error) {
      console.error('Failed to load available events:', error);
      setAvailableEvents([]);
    } finally {
      setLoadingAccounts(false);
    }
  }, [
    electronAPI,
    eventCreatorId,
    selectedEventCreatorId,
  ]);

  const loadRoomData = useCallback(async () => {
    if (libraryMode === 'event') {
      if (!selectedEvent) {
        setRoomMap(new Map());
        return;
      }
      try {
        if (electronAPI) {
          const result = await electronAPI.loadEventAlbumRoomsData({
            creatorAccountId: selectedEvent.creatorAccountId,
            eventId: selectedEvent.eventId,
          });
          if (result.success && result.data) {
            const rooms = result.data as RoomDto[];
            const roomMapping = new Map<string, string>();
            rooms.forEach(room => {
              if (room.RoomId) {
                const roomId = String(room.RoomId);
                const roomName = room.Name || roomId;
                roomMapping.set(roomId, roomName);
              }
            });
            setRoomMap(roomMapping);
          }
        }
      } catch (error) {
        console.error('Failed to load room data:', error);
        setRoomMap(new Map());
      }
      return;
    }
    if (!activeLibraryId) {
      setRoomMap(new Map());
      return;
    }

    try {
      if (electronAPI) {
        const result =
          libraryMode === 'room'
            ? await electronAPI.loadRoomRoomsData(activeLibraryId)
            : await electronAPI.loadRoomsData(activeLibraryId);
        if (result.success && result.data) {
          const rooms = result.data as RoomDto[];
          const roomMapping = new Map<string, string>();
          rooms.forEach(room => {
            if (room.RoomId) {
              const roomId = String(room.RoomId);
              const roomName = room.Name || roomId;
              roomMapping.set(roomId, roomName);
            }
          });
          setRoomMap(roomMapping);
        }
      }
    } catch (error) {
      console.error('Failed to load room data:', error);
      setRoomMap(new Map());
    }
  }, [activeLibraryId, electronAPI, libraryMode, selectedEvent]);

  const loadAccountData = useCallback(async () => {
    if (libraryMode === 'event') {
      if (!selectedEvent) {
        setAccountMap(new Map());
        setUsernameMap(new Map());
        return;
      }
      try {
        if (electronAPI) {
          const result = await electronAPI.loadEventAlbumAccountsData({
            creatorAccountId: selectedEvent.creatorAccountId,
            eventId: selectedEvent.eventId,
          });
          if (result.success && result.data) {
            const accounts = result.data as PlayerResult[];
            const accountMapping = new Map<string, string>();
            const usernameMapping = new Map<string, string>();
            accounts.forEach(account => {
              const id = String(account.accountId);
              const displayName =
                account.displayName || account.username || id;
              accountMapping.set(id, displayName);
              usernameMapping.set(id, account.username || '');
            });
            setAccountMap(accountMapping);
            setUsernameMap(usernameMapping);
          }
        }
      } catch (error) {
        console.error('Failed to load account data:', error);
        setAccountMap(new Map());
        setUsernameMap(new Map());
      }
      return;
    }
    if (!activeLibraryId) {
      setAccountMap(new Map());
      setUsernameMap(new Map());
      return;
    }

    try {
      if (electronAPI) {
        const result =
          libraryMode === 'room'
            ? await electronAPI.loadRoomAccountsData(activeLibraryId)
            : await electronAPI.loadAccountsData(activeLibraryId);
        if (result.success && result.data) {
          const accounts = result.data as PlayerResult[];
          const accountMapping = new Map<string, string>();
          const usernameMapping = new Map<string, string>();
          accounts.forEach(account => {
            const id = String(account.accountId);
            const displayName =
              account.displayName || account.username || id;
            accountMapping.set(id, displayName);
            usernameMapping.set(id, account.username || '');
          });
          setAccountMap(accountMapping);
          setUsernameMap(usernameMapping);
        }
      }
    } catch (error) {
      console.error('Failed to load account data:', error);
      setAccountMap(new Map());
      setUsernameMap(new Map());
    }
  }, [activeLibraryId, electronAPI, libraryMode, selectedEvent]);

  const loadEventData = useCallback(async () => {
    if (libraryMode === 'event') {
      const eventMapping = new Map<string, string>();
      availableEvents.forEach(event => {
        eventMapping.set(event.eventId, event.name);
      });
      if (selectedEvent && electronAPI) {
        try {
          const result = await electronAPI.loadEventAlbumEventsData({
            creatorAccountId: selectedEvent.creatorAccountId,
            eventId: selectedEvent.eventId,
          });
          if (result.success && result.data) {
            const events = result.data as EventDto[];
            events.forEach(ev => {
              if (ev.PlayerEventId) {
                const id = String(ev.PlayerEventId);
                eventMapping.set(id, ev.Name || id);
              }
            });
          }
        } catch (error) {
          console.error('Failed to load event album events data:', error);
        }
      }
      setEventMap(eventMapping);
      return;
    }
    if (!activeLibraryId) {
      setEventMap(new Map());
      return;
    }

    try {
      if (electronAPI) {
        const result =
          libraryMode === 'room'
            ? await electronAPI.loadRoomEventsData(activeLibraryId)
            : await electronAPI.loadEventsData(activeLibraryId);
        if (result.success && result.data) {
          const eventMapping = new Map<string, string>();
          const events = result.data as EventDto[];
          events.forEach(event => {
            if (event.PlayerEventId) {
              const eventId = String(event.PlayerEventId);
              const eventName = event.Name || eventId;
              eventMapping.set(eventId, eventName);
            }
          });
          setEventMap(eventMapping);
        } else {
          setEventMap(new Map());
        }
      }
    } catch (error) {
      console.error('Failed to load event data:', error);
      setEventMap(new Map());
    }
  }, [activeLibraryId, availableEvents, electronAPI, libraryMode, selectedEvent]);

  const loadImageCommentsData = useCallback(async () => {
    if (libraryMode === 'event') {
      if (!selectedEvent) {
        setImageComments([]);
        return;
      }
      try {
        if (electronAPI) {
          const result = await electronAPI.loadEventAlbumImageCommentsData({
            creatorAccountId: selectedEvent.creatorAccountId,
            eventId: selectedEvent.eventId,
          });
          if (result.success && result.data) {
            setImageComments(result.data as ImageCommentDto[]);
          } else {
            setImageComments([]);
          }
        }
      } catch (error) {
        console.error('Failed to load image comments data:', error);
        setImageComments([]);
      }
      return;
    }
    if (!activeLibraryId) {
      setImageComments([]);
      return;
    }

    try {
      if (electronAPI) {
        const result =
          libraryMode === 'room'
            ? await electronAPI.loadRoomImageCommentsData(activeLibraryId)
            : await electronAPI.loadImageCommentsData(activeLibraryId);
        if (result.success && result.data) {
          setImageComments(result.data as ImageCommentDto[]);
        } else {
          setImageComments([]);
        }
      }
    } catch (error) {
      console.error('Failed to load image comments data:', error);
      setImageComments([]);
    }
  }, [activeLibraryId, electronAPI, libraryMode, selectedEvent]);

  const loadPhotos = useCallback(async () => {
    if (!filePath || (!activeLibraryId && libraryMode !== 'event')) {
      setPhotos([]);
      setFeedPhotos([]);
      setProfileHistoryPhotos([]);
      return;
    }

    setLoading(true);
    setLoadError(null);
    try {
      if (electronAPI) {
        if (libraryMode === 'event') {
          if (!selectedEvent) {
            setPhotos([]);
            setFeedPhotos([]);
            setProfileHistoryPhotos([]);
            return;
          }

          const eventPhotosResult = await electronAPI.loadEventAlbumPhotos({
            creatorAccountId: selectedEvent.creatorAccountId,
            eventId: selectedEvent.eventId,
          });
          setPhotos(
            eventPhotosResult.success && eventPhotosResult.data
              ? eventPhotosResult.data
              : []
          );
          setFeedPhotos([]);
          setProfileHistoryPhotos([]);
          onPhotosLoadSuccessRef.current?.();
          return;
        }

        if (libraryMode === 'room') {
          const roomPhotosResult = await electronAPI.loadRoomPhotos(
            activeLibraryId
          );
          setPhotos(
            roomPhotosResult.success && roomPhotosResult.data
              ? roomPhotosResult.data
              : []
          );
          setFeedPhotos([]);
          setProfileHistoryPhotos([]);
          onPhotosLoadSuccessRef.current?.();
          return;
        }

        const [photosResult, feedPhotosResult, profileHistoryResult] =
          await Promise.all([
          electronAPI.loadPhotos(activeLibraryId),
          electronAPI.loadFeedPhotos(activeLibraryId),
          electronAPI.loadProfileHistoryPhotos(activeLibraryId),
        ]);

        if (photosResult.success && photosResult.data) {
          setPhotos(photosResult.data);
        } else {
          setPhotos([]);
        }

        if (feedPhotosResult.success && feedPhotosResult.data) {
          setFeedPhotos(feedPhotosResult.data);
        } else {
          setFeedPhotos([]);
        }
        if (profileHistoryResult.success && profileHistoryResult.data) {
          setProfileHistoryPhotos(profileHistoryResult.data);
        } else {
          setProfileHistoryPhotos([]);
        }
        onPhotosLoadSuccessRef.current?.();
      } else {
        setPhotos([]);
        setFeedPhotos([]);
        setProfileHistoryPhotos([]);
      }
    } catch (error) {
      const msg = `Failed to load photos: ${error instanceof Error ? error.message : 'Unknown error'}. Check that your output folder is accessible.`;
      setLoadError(msg);
      onPhotosLoadErrorRef.current?.(msg);
      setPhotos([]);
      setFeedPhotos([]);
      setProfileHistoryPhotos([]);
    } finally {
      setLoading(false);
    }
  }, [filePath, activeLibraryId, electronAPI, libraryMode, selectedEvent]);

  // Load available accounts on mount and when filePath changes
  useEffect(() => {
    if (filePath) {
      if (libraryMode === 'room') {
        loadAvailableRooms();
      } else if (libraryMode === 'event') {
        loadAvailableEventCreators();
        loadAvailableEvents();
      } else if (libraryMode === 'user') {
        loadAvailableAccounts();
      }
    }
  }, [
    filePath,
    libraryMode,
    loadAvailableAccounts,
    loadAvailableEventCreators,
    loadAvailableEvents,
    loadAvailableRooms,
  ]);

  // Update selectedAccountId when propAccountId changes
  useEffect(() => {
    if (propAccountId !== undefined) {
      setSelectedAccountId(propAccountId);
      setPhotoSource('photos');
    }
  }, [propAccountId]);

  useEffect(() => {
    if (propRoomId !== undefined) {
      setSelectedRoomId(propRoomId);
      setPhotoSource('photos');
    }
  }, [propRoomId]);

  useEffect(() => {
    if (propEventCreatorId !== undefined) {
      setSelectedEventCreatorId(propEventCreatorId);
      setSelectedEvent(null);
      setPhotoSource('photos');
    }
  }, [propEventCreatorId]);

  useEffect(() => {
    if (libraryMode !== 'event' || selectedEvent) {
      return;
    }

    const node = activeScrollRef.current;
    if (!node) {
      return;
    }

    const updateSize = () => {
      setEventAlbumGridSize({
        width: node.clientWidth,
        height: node.clientHeight || 700,
      });
    };
    const handleScroll = () => {
      setEventAlbumScrollTop(node.scrollTop);
      onScrollPositionChange?.(node.scrollTop);
    };

    updateSize();
    handleScroll();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(node);
    node.addEventListener('scroll', handleScroll);
    return () => {
      resizeObserver.disconnect();
      node.removeEventListener('scroll', handleScroll);
    };
  }, [
    activeScrollRef,
    libraryMode,
    onScrollPositionChange,
    selectedEvent,
    availableEvents.length,
  ]);

  useEffect(() => {
    if (filePath && activeLibraryId) {
      loadPhotos();
      loadRoomData();
      loadAccountData();
      loadEventData();
      loadImageCommentsData();
    } else {
      setPhotos([]);
      setFeedPhotos([]);
      setProfileHistoryPhotos([]);
      setRoomMap(new Map());
      setAccountMap(new Map());
      setEventMap(new Map());
      setImageComments([]);
    }
  }, [
    filePath,
    activeLibraryId,
    selectedEvent?.creatorAccountId,
    selectedEvent?.eventId,
    loadPhotos,
    loadRoomData,
    loadAccountData,
    loadEventData,
    loadImageCommentsData,
  ]);

  useEffect(() => {
    if (!activeLibraryId) {
      return;
    }

    if (libraryMode === 'room' || libraryMode === 'event') {
      setPhotoSource('photos');
      return;
    }
    if (photoSource === 'photos' && photos.length > 0) {
      return;
    }
    if (photoSource === 'feed' && feedPhotos.length > 0) {
      return;
    }
    if (photoSource === 'profile-history' && profileHistoryPhotos.length > 0) {
      return;
    }

    if (photos.length > 0) {
      setPhotoSource('photos');
      return;
    }
    if (feedPhotos.length > 0) {
      setPhotoSource('feed');
      return;
    }
    if (profileHistoryPhotos.length > 0) {
      setPhotoSource('profile-history');
    }
  }, [
    activeLibraryId,
    feedPhotos.length,
    libraryMode,
    photoSource,
    photos.length,
    profileHistoryPhotos.length,
  ]);

  // Reload photos + metadata periodically during download so names resolve
  useEffect(() => {
    if (!isDownloading || !activeLibraryId || !filePath) {
      return;
    }

    const interval = setInterval(() => {
      void loadPhotos();
      void loadRoomData();
      void loadAccountData();
      void loadEventData();
      void loadImageCommentsData();
      if (libraryMode === 'event') {
        void loadAvailableEvents();
      }
    }, 5000);

    return () => {
      clearInterval(interval);
    };
  }, [
    isDownloading,
    activeLibraryId,
    filePath,
    loadPhotos,
    loadRoomData,
    loadAccountData,
    loadEventData,
    loadImageCommentsData,
    loadAvailableEvents,
    libraryMode,
  ]);

  useEffect(() => {
    const wasDownloading = wasDownloadingRef.current;
    wasDownloadingRef.current = isDownloading;

    if (wasDownloading && !isDownloading && activeLibraryId && filePath) {
      void loadPhotos();
      void loadRoomData();
      void loadAccountData();
      void loadEventData();
      void loadImageCommentsData();
      if (libraryMode === 'event') {
        void loadAvailableEvents();
      }
    }
  }, [
    isDownloading,
    activeLibraryId,
    filePath,
    loadPhotos,
    loadRoomData,
    loadAccountData,
    loadEventData,
    loadImageCommentsData,
    loadAvailableEvents,
    libraryMode,
  ]);

  const handlePhotoClick = useCallback((photo: Photo) => {
    setSelectedPhoto(photo);
    setIsModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const handleAccountChange = (newAccountId: string) => {
    setSelectedAccountId(newAccountId);
    setPhotoSource('photos');
    if (onAccountChange) {
      onAccountChange(newAccountId);
    }
  };

  const handleRoomChange = (newRoomId: string) => {
    setSelectedRoomId(newRoomId);
    setPhotoSource('photos');
    onRoomChange?.(newRoomId);
  };

  const handleEventCreatorChange = (newCreatorId: string) => {
    setSelectedEventCreatorId(newCreatorId);
    setSelectedEvent(null);
    setAvailableEvents([]);
    setPhotos([]);
    setEventAlbumScrollTop(0);
    onEventCreatorChange?.(newCreatorId);
  };

  const handleEventOpen = (event: AvailableEvent) => {
    if (!event.isDownloaded) {
      return;
    }
    setSelectedEvent(event);
    setSelectedEventCreatorId(event.creatorAccountId);
    onEventCreatorChange?.(event.creatorAccountId);
  };

  const handleBackToEvents = () => {
    setSelectedEvent(null);
    setPhotos([]);
  };

  const formatEventDate = (event: AvailableEvent): string => {
    if (!event.startTime) {
      return 'Date unknown';
    }
    return new Date(event.startTime).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const EVENT_ALBUM_MIN_WIDTH = 260;
  const EVENT_ALBUM_ROW_HEIGHT = 360;
  const EVENT_ALBUM_GAP = 16;
  const eventAlbumColumns = Math.max(
    1,
    Math.floor(
      (eventAlbumGridSize.width + EVENT_ALBUM_GAP) /
        (EVENT_ALBUM_MIN_WIDTH + EVENT_ALBUM_GAP)
    )
  );
  const eventAlbumRows = Math.ceil(availableEvents.length / eventAlbumColumns);
  const eventAlbumStartRow = Math.max(
    0,
    Math.floor(eventAlbumScrollTop / (EVENT_ALBUM_ROW_HEIGHT + EVENT_ALBUM_GAP)) -
      1
  );
  const eventAlbumEndRow = Math.min(
    eventAlbumRows,
    Math.ceil(
      (eventAlbumScrollTop + eventAlbumGridSize.height) /
        (EVENT_ALBUM_ROW_HEIGHT + EVENT_ALBUM_GAP)
    ) + 1
  );
  const visibleEventAlbums = useMemo(
    () =>
      availableEvents.slice(
        eventAlbumStartRow * eventAlbumColumns,
        Math.min(availableEvents.length, eventAlbumEndRow * eventAlbumColumns)
      ),
    [
      availableEvents,
      eventAlbumColumns,
      eventAlbumEndRow,
      eventAlbumStartRow,
    ]
  );
  const eventAlbumPaddingTop =
    eventAlbumStartRow * (EVENT_ALBUM_ROW_HEIGHT + EVENT_ALBUM_GAP);
  const eventAlbumPaddingBottom = Math.max(
    0,
    (eventAlbumRows - eventAlbumEndRow) *
      (EVENT_ALBUM_ROW_HEIGHT + EVENT_ALBUM_GAP)
  );

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      <div
        className={`sticky top-0 z-10 space-y-3 bg-background/95 px-3 py-3 backdrop-blur transition-[transform,opacity,max-height] duration-300 sm:px-4 lg:px-6 ${
          isHeaderVisible
            ? 'max-h-[600px] translate-y-0 opacity-100'
            : 'pointer-events-none max-h-0 -translate-y-full opacity-0'
        }`}
      >
        {showFullControls && (
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            {libraryMode === 'user' && availableAccounts.length > 0 && (
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <AccountSelect
                  availableAccounts={availableAccounts}
                  value={accountId}
                  accountMap={accountMap}
                  usernameMap={usernameMap}
                  onValueChange={handleAccountChange}
                  disabled={!!propAccountId}
                />
                {propAccountId && (
                  <span className="text-sm text-muted-foreground">
                    (Downloading...)
                  </span>
                )}
              </div>
            )}
            {libraryMode === 'room' && availableRooms.length > 0 && (
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <RoomSelect
                  availableRooms={availableRooms}
                  value={roomId}
                  onValueChange={handleRoomChange}
                  disabled={!!propRoomId}
                />
                {propRoomId && (
                  <span className="text-sm text-muted-foreground">
                    (Downloading...)
                  </span>
                )}
              </div>
            )}
            {libraryMode === 'event' && availableEventCreators.length > 0 && (
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Select
                  value={eventCreatorId}
                  onValueChange={handleEventCreatorChange}
                  disabled={!!propEventCreatorId}
                >
                  <SelectTrigger className="w-full sm:w-[280px]">
                    <SelectValue placeholder="Choose event creator" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableEventCreators.map(creator => (
                      <SelectItem
                        key={creator.creatorAccountId}
                        value={creator.creatorAccountId}
                      >
                        {creator.displayLabel} ({creator.downloadedEventCount}/
                        {creator.eventCount})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {propEventCreatorId && (
                  <span className="text-sm text-muted-foreground">
                    (Downloading...)
                  </span>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 md:justify-end">
              {hasPhotoSections && (
                <>
                  <span className="text-sm text-muted-foreground">Viewing</span>
                  {libraryMode === 'room' && hasUserPhotos && (
                    <Button size="sm" variant="default">
                      Room Photos ({photos.length})
                    </Button>
                  )}
                  {libraryMode === 'user' && hasUserPhotos && (
                    <Button
                      size="sm"
                      variant={photoSource === 'photos' ? 'default' : 'outline'}
                      onClick={() => setPhotoSource('photos')}
                    >
                      My Photos ({photos.length})
                    </Button>
                  )}
                  {libraryMode === 'user' && hasFeedPhotos && (
                    <Button
                      size="sm"
                      variant={photoSource === 'feed' ? 'default' : 'outline'}
                      onClick={() => setPhotoSource('feed')}
                    >
                      Feed ({feedPhotos.length})
                    </Button>
                  )}
                  {libraryMode === 'user' && hasProfileHistoryPhotos && (
                    <Button
                      size="sm"
                      variant={
                        photoSource === 'profile-history' ? 'default' : 'outline'
                      }
                      onClick={() => setPhotoSource('profile-history')}
                    >
                      Profile History ({profileHistoryPhotos.length})
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant={showFavoritesOnly ? 'default' : 'outline'}
                    onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                    className={
                      showFavoritesOnly
                        ? 'bg-red-500 text-white hover:bg-red-600'
                        : ''
                    }
                  >
                    <Heart
                      className={`mr-2 h-4 w-4 ${showFavoritesOnly ? 'fill-current' : ''}`}
                    />
                    Favorites
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {(showFullControls || headerMode === 'compact') &&
          !(libraryMode === 'event' && !selectedEvent) && (
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-muted-foreground" />
              <Input
                placeholder="Search photos..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select
              value={groupBy}
              onValueChange={(
                value: 'none' | 'room' | 'user' | 'date' | 'event'
              ) => setGroupBy(value)}
            >
              <SelectTrigger className="w-full sm:w-[180px]">
                <Filter className="mr-2 h-4 w-4" />
                <SelectValue placeholder="Group by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Grouping</SelectItem>
                <SelectItem value="room">Group by Room</SelectItem>
                <SelectItem value="user">Group by User</SelectItem>
                <SelectItem value="date">Group by Date</SelectItem>
                <SelectItem value="event">Group by Event</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={sortBy}
              onValueChange={(
                value:
                  | 'oldest-to-newest'
                  | 'newest-to-oldest'
                  | 'most-cheered'
                  | 'most-comments'
              ) => setSortBy(value)}
            >
              <SelectTrigger className="w-full sm:w-[200px]">
                <ArrowUpDown className="mr-2 h-4 w-4" />
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="oldest-to-newest">Oldest to Newest</SelectItem>
                <SelectItem value="newest-to-oldest">Newest to Oldest</SelectItem>
                <SelectItem value="most-cheered">Most Cheered</SelectItem>
                <SelectItem value="most-comments">Most Comments</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0">
        {libraryMode === 'event' && !selectedEvent ? (
          loadingAccounts ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>Loading events...</p>
            </div>
          ) : availableEvents.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>No event albums found. Download event photos to get started.</p>
            </div>
          ) : (
            <div
              ref={activeScrollRef}
              className="h-full overflow-auto px-3 pb-4 sm:px-4 lg:px-6"
            >
              <div
                style={{
                  paddingTop: eventAlbumPaddingTop,
                  paddingBottom: eventAlbumPaddingBottom,
                }}
              >
                <div
                  className="grid gap-4"
                  style={{
                    gridTemplateColumns: `repeat(${eventAlbumColumns}, minmax(0, 1fr))`,
                  }}
                >
                {visibleEventAlbums.map(event => (
                    <div
                      key={`${event.creatorAccountId}-${event.eventId}`}
                      className={`overflow-hidden rounded-md border bg-card transition ${
                        event.isDownloaded
                          ? 'cursor-pointer hover:shadow-md'
                          : 'border-dashed opacity-65'
                      }`}
                      onClick={() => handleEventOpen(event)}
                    >
                      <div className="aspect-video bg-muted">
                        <EventCoverImage event={event} cdnBase={cdnBase} />
                      </div>
                      <div className="space-y-3 p-4">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {event.name}
                          </p>
                          {event.isDownloaded && event.photoCount > 0 ? (
                            <p className="text-xs text-muted-foreground">
                              Album downloaded
                            </p>
                          ) : !event.isDownloaded ? (
                            <p className="text-xs text-muted-foreground">
                              Photos not downloaded
                            </p>
                          ) : null}
                        </div>
                        <div className="grid grid-cols-1 gap-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" />
                            {formatEventDate(event)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Users className="h-3.5 w-3.5" />
                            {event.attendeeCount} attending
                          </span>
                          <span className="flex items-center gap-1">
                            <ImageIcon className="h-3.5 w-3.5" />
                            {!event.isDownloaded && event.photoCount === 0
                              ? 'Photo count unknown'
                              : event.photoCount > 0
                                ? `${event.downloadedPhotoCount}/${event.photoCount} photos`
                                : '0 photos'}
                          </span>
                        </div>
                        {!event.isDownloaded && (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="w-full"
                            onClick={clickEvent => {
                              clickEvent.stopPropagation();
                              const creator = availableEventCreators.find(
                                c => c.creatorAccountId === event.creatorAccountId
                              );
                              onOpenDownloadPanel?.({
                                kind: 'eventAlbum',
                                creatorAccountId: event.creatorAccountId,
                                eventId: event.eventId,
                                username: creator?.username,
                              });
                            }}
                          >
                            <Download className="mr-2 h-4 w-4" />
                            Download
                          </Button>
                        )}
                      </div>
                    </div>
                ))}
                </div>
              </div>
            </div>
          )
        ) : loadingAccounts ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>Loading accounts...</p>
          </div>
        ) : libraryMode === 'user' && !accountId && availableAccounts.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>No accounts with metadata found. Download photos to get started.</p>
          </div>
        ) : libraryMode === 'room' && !roomId && availableRooms.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>No rooms with metadata found. Download room photos to get started.</p>
          </div>
        ) : loading ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>Loading photos...</p>
          </div>
        ) : loadError ? (
          <div className="mx-auto max-w-md rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
            <p className="text-sm font-medium text-destructive">Could not load photos</p>
            <p className="mt-2 text-sm text-muted-foreground break-words">
              {loadError}
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Button size="sm" onClick={() => void loadPhotos()}>
                Try again
              </Button>
              {onRevealOutputFolder && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onRevealOutputFolder}
                >
                  Open output folder
                </Button>
              )}
              {onOpenActivityMenu && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onOpenActivityMenu}
                >
                  Open activity and settings
                </Button>
              )}
            </div>
          </div>
        ) : activePhotos.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {libraryMode === 'event' && selectedEvent && (
              <Button
                size="sm"
                variant="outline"
                className="mb-4"
                onClick={handleBackToEvents}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to events
              </Button>
            )}
            <p>
              No {activeViewLabel} available for this{' '}
              {libraryMode === 'room'
                ? 'room'
                : libraryMode === 'event'
                  ? 'event'
                  : 'account'}
            </p>
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col gap-3">
            {libraryMode === 'event' && selectedEvent && (
              <div className="px-3 sm:px-4 lg:px-6">
                <Button size="sm" variant="outline" onClick={handleBackToEvents}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to events
                </Button>
              </div>
            )}
            <PhotoGrid
              photos={activePhotos}
              onPhotoClick={handlePhotoClick}
              groupBy={groupBy}
              searchQuery={searchQuery}
              sortBy={sortBy}
              roomMap={roomMap}
              accountMap={accountMap}
              eventMap={eventMap}
              cdnBase={cdnBase}
              onScrollPositionChange={onScrollPositionChange}
              scrollContainerRef={activeScrollRef}
              accountId={accountId}
            />
          </div>
        )}
      </div>

      <PhotoDetailModal
        photo={selectedPhoto}
        open={isModalOpen}
        onClose={handleCloseModal}
        roomMap={roomMap}
        accountMap={accountMap}
        usernameMap={usernameMap}
        eventMap={eventMap}
        cdnBase={cdnBase}
        imageComments={imageComments}
      />
    </div>
  );
};
