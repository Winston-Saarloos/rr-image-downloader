import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import { Search, Filter, ArrowUpDown, Heart } from 'lucide-react';
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
  EventDto,
  RoomDto,
  PlayerResult,
} from '../../shared/types';
import { DEFAULT_CDN_BASE } from '../../shared/cdnUrl';
import { PhotoGrid } from './PhotoGrid';
import { PhotoDetailModal } from './PhotoDetailModal';
import { useFavorites } from '../hooks/useFavorites';

interface PhotoViewerProps {
  filePath: string;
  accountId?: string;
  isDownloading?: boolean;
  onAccountChange?: (accountId: string | undefined) => void;
  onScrollPositionChange?: (scrollTop: number) => void;
  scrollContainerRef?: React.RefObject<HTMLDivElement>;
  headerMode?: 'full' | 'compact' | 'hidden';
  onOpenActivityMenu?: () => void;
  onRevealOutputFolder?: () => void;
  onPhotosLoadError?: (message: string) => void;
  onPhotosLoadSuccess?: () => void;
  cdnBase?: string;
}

type PhotoSource = 'photos' | 'feed';

export const PhotoViewer: React.FC<PhotoViewerProps> = ({
  filePath,
  accountId: propAccountId,
  isDownloading = false,
  onAccountChange,
  onScrollPositionChange,
  scrollContainerRef,
  headerMode = 'full',
  onOpenActivityMenu,
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
  const [selectedAccountId, setSelectedAccountId] = useState<
    string | undefined
  >(propAccountId);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [roomMap, setRoomMap] = useState<Map<string, string>>(new Map());
  const [accountMap, setAccountMap] = useState<Map<string, string>>(new Map());
  const [eventMap, setEventMap] = useState<Map<string, string>>(new Map());
  const [feedPhotos, setFeedPhotos] = useState<Photo[]>([]);
  const [photoSource, setPhotoSource] = useState<PhotoSource>('photos');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
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
  const basePhotos = photoSource === 'feed' ? feedPhotos : photos;

  // Filter photos based on favorites filter
  const activePhotos = useMemo(() => {
    if (!showFavoritesOnly) return basePhotos;
    return basePhotos.filter(photo => favorites.has(photo.Id.toString()));
  }, [basePhotos, showFavoritesOnly, favorites]);

  const activeViewLabel = photoSource === 'feed' ? 'feed photos' : 'photos';

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

  const loadRoomData = useCallback(async () => {
    if (!accountId) {
      setRoomMap(new Map());
      return;
    }

    try {
      if (electronAPI) {
        const result = await electronAPI.loadRoomsData(accountId);
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
  }, [accountId, electronAPI]);

  const loadAccountData = useCallback(async () => {
    if (!accountId) {
      setAccountMap(new Map());
      return;
    }

    try {
      if (electronAPI) {
        const result = await electronAPI.loadAccountsData(accountId);
        if (result.success && result.data) {
          const accounts = result.data as PlayerResult[];
          const accountMapping = new Map<string, string>();
          accounts.forEach(account => {
            const accountId = String(account.accountId);
            const displayName =
              account.displayName || account.username || accountId;
            accountMapping.set(accountId, displayName);
          });
          setAccountMap(accountMapping);
        }
      }
    } catch (error) {
      console.error('Failed to load account data:', error);
      setAccountMap(new Map());
    }
  }, [accountId, electronAPI]);

  const loadEventData = useCallback(async () => {
    if (!accountId) {
      setEventMap(new Map());
      return;
    }

    try {
      if (electronAPI) {
        const result = await electronAPI.loadEventsData(accountId);
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
  }, [accountId, electronAPI]);

  const loadPhotos = useCallback(async () => {
    if (!filePath || !accountId) {
      setPhotos([]);
      setFeedPhotos([]);
      return;
    }

    setLoading(true);
    setLoadError(null);
    try {
      if (electronAPI) {
        const [photosResult, feedPhotosResult] = await Promise.all([
          electronAPI.loadPhotos(accountId),
          electronAPI.loadFeedPhotos(accountId),
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
        onPhotosLoadSuccessRef.current?.();
      } else {
        setPhotos([]);
        setFeedPhotos([]);
      }
    } catch (error) {
      const msg = `Failed to load photos: ${error instanceof Error ? error.message : 'Unknown error'}. Check that your output folder is accessible.`;
      setLoadError(msg);
      onPhotosLoadErrorRef.current?.(msg);
      setPhotos([]);
      setFeedPhotos([]);
    } finally {
      setLoading(false);
    }
  }, [filePath, accountId, electronAPI]);

  // Load available accounts on mount and when filePath changes
  useEffect(() => {
    if (filePath) {
      loadAvailableAccounts();
    }
  }, [filePath, loadAvailableAccounts]);

  // Update selectedAccountId when propAccountId changes
  useEffect(() => {
    if (propAccountId !== undefined) {
      setSelectedAccountId(propAccountId);
      setPhotoSource('photos');
    }
  }, [propAccountId]);

  useEffect(() => {
    if (filePath && accountId) {
      loadPhotos();
      loadRoomData();
      loadAccountData();
      loadEventData();
    } else {
      setPhotos([]);
      setFeedPhotos([]);
      setRoomMap(new Map());
      setAccountMap(new Map());
      setEventMap(new Map());
    }
  }, [
    filePath,
    accountId,
    loadPhotos,
    loadRoomData,
    loadAccountData,
    loadEventData,
  ]);

  // Reload photos + metadata periodically during download so names resolve
  useEffect(() => {
    if (!isDownloading || !accountId || !filePath) {
      return;
    }

    const interval = setInterval(() => {
      void loadPhotos();
      void loadRoomData();
      void loadAccountData();
      void loadEventData();
    }, 5000);

    return () => {
      clearInterval(interval);
    };
  }, [
    isDownloading,
    accountId,
    filePath,
    loadPhotos,
    loadRoomData,
    loadAccountData,
    loadEventData,
  ]);

  useEffect(() => {
    const wasDownloading = wasDownloadingRef.current;
    wasDownloadingRef.current = isDownloading;

    if (wasDownloading && !isDownloading && accountId && filePath) {
      void loadPhotos();
      void loadRoomData();
      void loadAccountData();
      void loadEventData();
    }
  }, [
    isDownloading,
    accountId,
    filePath,
    loadPhotos,
    loadRoomData,
    loadAccountData,
    loadEventData,
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

  const getAccountDisplayName = (account: AvailableAccount): string => {
    return (
      account.displayLabel ||
      accountMap.get(account.accountId) ||
      account.accountId
    );
  };

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
            {availableAccounts.length > 0 && (
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Select
                  value={accountId || ''}
                  onValueChange={handleAccountChange}
                  disabled={!!propAccountId}
                >
                  <SelectTrigger className="w-full sm:w-[250px]">
                    <SelectValue placeholder="Select an account" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableAccounts.map(account => (
                      <SelectItem
                        key={account.accountId}
                        value={account.accountId}
                      >
                        {getAccountDisplayName(account)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {propAccountId && (
                  <span className="text-sm text-muted-foreground">
                    (Downloading...)
                  </span>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 md:justify-end">
              <span className="text-sm text-muted-foreground">Viewing</span>
              <Button
                size="sm"
                variant={photoSource === 'photos' ? 'default' : 'outline'}
                onClick={() => setPhotoSource('photos')}
              >
                My Photos ({photos.length})
              </Button>
              <Button
                size="sm"
                variant={photoSource === 'feed' ? 'default' : 'outline'}
                onClick={() => setPhotoSource('feed')}
              >
                Feed ({feedPhotos.length})
              </Button>
              <Button
                size="sm"
                variant={showFavoritesOnly ? 'default' : 'outline'}
                onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                className={
                  showFavoritesOnly ? 'bg-red-500 text-white hover:bg-red-600' : ''
                }
              >
                <Heart
                  className={`mr-2 h-4 w-4 ${showFavoritesOnly ? 'fill-current' : ''}`}
                />
                Favorites
              </Button>
            </div>
          </div>
        )}

        {(showFullControls || headerMode === 'compact') && (
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
        {loadingAccounts ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>Loading accounts...</p>
          </div>
        ) : !accountId && availableAccounts.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>No accounts with metadata found. Download photos to get started.</p>
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
            <p>No {activeViewLabel} available for this account.</p>
          </div>
        ) : (
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
        )}
      </div>

      <PhotoDetailModal
        photo={selectedPhoto}
        open={isModalOpen}
        onClose={handleCloseModal}
        roomMap={roomMap}
        accountMap={accountMap}
        eventMap={eventMap}
        cdnBase={cdnBase}
      />
    </div>
  );
};
