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
  onHeaderInteraction?: () => void;
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
}) => {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [groupBy, setGroupBy] = useState<
    'none' | 'room' | 'user' | 'date' | 'event'
  >('none');
  const [sortBy, setSortBy] = useState<
    'oldest-to-newest' | 'newest-to-oldest' | 'most-popular'
  >('newest-to-oldest');
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
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
  const activeScrollRef = scrollContainerRef ?? internalScrollRef;
  const isHeaderVisible = headerMode !== 'hidden';
  const showFullControls = headerMode === 'full';
  const { favorites } = useFavorites();

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
      if (window.electronAPI) {
        const result = await window.electronAPI.listAvailableAccounts();
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
  }, [selectedAccountId, propAccountId, onAccountChange]);

  const loadRoomData = useCallback(async () => {
    if (!accountId) {
      setRoomMap(new Map());
      return;
    }

    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.loadRoomsData(accountId);
        if (result.success && result.data) {
          const rooms = result.data as RoomDto[];
          const roomMapping = new Map<string, string>();
          rooms.forEach(room => {
            if (room.RoomId) {
              const roomName = room.Name || room.RoomId;
              roomMapping.set(room.RoomId, roomName);
            }
          });
          setRoomMap(roomMapping);
        }
      }
    } catch (error) {
      console.error('Failed to load room data:', error);
      setRoomMap(new Map());
    }
  }, [accountId]);

  const loadAccountData = useCallback(async () => {
    if (!accountId) {
      setAccountMap(new Map());
      return;
    }

    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.loadAccountsData(accountId);
        if (result.success && result.data) {
          const accounts = result.data as PlayerResult[];
          const accountMapping = new Map<string, string>();
          accounts.forEach(account => {
            const displayName =
              account.displayName || account.username || account.accountId;
            accountMapping.set(account.accountId, displayName);
          });
          setAccountMap(accountMapping);
        }
      }
    } catch (error) {
      console.error('Failed to load account data:', error);
      setAccountMap(new Map());
    }
  }, [accountId]);

  const loadEventData = useCallback(async () => {
    if (!accountId) {
      setEventMap(new Map());
      return;
    }

    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.loadEventsData(accountId);
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
  }, [accountId]);

  const loadPhotos = useCallback(async () => {
    if (!filePath || !accountId) {
      setPhotos([]);
      setFeedPhotos([]);
      return;
    }

    setLoading(true);
    try {
      if (window.electronAPI) {
        const [photosResult, feedPhotosResult] = await Promise.all([
          window.electronAPI.loadPhotos(accountId),
          window.electronAPI.loadFeedPhotos(accountId),
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
      } else {
        setPhotos([]);
        setFeedPhotos([]);
      }
    } catch (error) {
      // Failed to load photos
      setPhotos([]);
      setFeedPhotos([]);
    } finally {
      setLoading(false);
    }
  }, [filePath, accountId]);

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

  // Reload photos, room data, and account data periodically during download
  useEffect(() => {
    if (!isDownloading || !accountId || !filePath) {
      return;
    }

    // Reload data every 2 seconds during download
    const interval = setInterval(() => {
      loadPhotos();
      loadRoomData();
      loadAccountData();
      loadEventData();
    }, 2000);

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
    const accountUsername =
      accountMap.get(account.accountId) || account.accountId;

    return accountUsername;
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      <div
        className={`transition-[transform,opacity,max-height] duration-300 bg-background/95 backdrop-blur sticky top-0 z-10 ${
          isHeaderVisible
            ? 'translate-y-0 opacity-100 max-h-[600px]'
            : '-translate-y-full opacity-0 pointer-events-none max-h-0'
        } px-3 sm:px-4 lg:px-6 py-3 space-y-3`}
      >
        {showFullControls && (
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            {availableAccounts.length > 0 && (
              <div className="flex items-center gap-3 min-w-0 flex-1">
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
                  showFavoritesOnly
                    ? 'bg-red-500 hover:bg-red-600 text-white'
                    : ''
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
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
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
                value: 'oldest-to-newest' | 'newest-to-oldest' | 'most-popular'
              ) => setSortBy(value)}
            >
              <SelectTrigger className="w-full sm:w-[200px]">
                <ArrowUpDown className="mr-2 h-4 w-4" />
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="oldest-to-newest">
                  Oldest to Newest
                </SelectItem>
                <SelectItem value="newest-to-oldest">
                  Newest to Oldest
                </SelectItem>
                <SelectItem value="most-popular">Most Popular</SelectItem>
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
            <p>
              No accounts with metadata found. Download photos to get started.
            </p>
          </div>
        ) : loading ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>Loading photos...</p>
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
      />
    </div>
  );
};
