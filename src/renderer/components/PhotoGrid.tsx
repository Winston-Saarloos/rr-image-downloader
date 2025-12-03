import React, {
  useMemo,
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from 'react';
import { MapPin, Users, Calendar, Heart } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Photo } from '../../shared/types';
import { format } from 'date-fns';
import { ExtendedPhoto, usePhotoMetadata } from '../hooks/usePhotoMetadata';
import { useFavorites } from '../hooks/useFavorites';

interface PhotoGridProps {
  photos: Photo[];
  onPhotoClick: (photo: Photo) => void;
  groupBy?: 'none' | 'room' | 'user' | 'date';
  searchQuery?: string;
  sortBy?: 'oldest-to-newest' | 'newest-to-oldest' | 'most-popular';
  roomMap?: Map<string, string>;
  accountMap?: Map<string, string>;
  scrollContainerRef?: React.RefObject<HTMLDivElement>;
  onScrollPositionChange?: (scrollTop: number) => void;
  className?: string;
}

const PhotoGridComponent: React.FC<PhotoGridProps> = ({
  photos,
  onPhotoClick,
  groupBy = 'none',
  searchQuery = '',
  sortBy = 'newest-to-oldest',
  roomMap = new Map(),
  accountMap = new Map(),
  scrollContainerRef: scrollContainerRefProp,
  onScrollPositionChange,
  className = '',
}) => {
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const { getPhotoRoom, getPhotoUsers, getPhotoImageUrl } = usePhotoMetadata(
    roomMap,
    accountMap
  );
  const internalScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = scrollContainerRefProp ?? internalScrollRef;
  const [containerSize, setContainerSize] = useState({ width: 0, height: 700 });
  const [scrollTop, setScrollTop] = useState(0);
  const rafRef = useRef<number | null>(null);

  // Helper function to get cheers count from a photo
  const getCheersCount = useCallback((photo: Photo): number => {
    const extended = photo as ExtendedPhoto;
    // Try common field names for cheers
    const cheers =
      extended.Cheers ||
      extended.cheers ||
      extended.CheerCount ||
      extended.cheerCount ||
      extended.CheersCount ||
      extended.cheersCount ||
      0;
    return typeof cheers === 'number' ? cheers : 0;
  }, []);

  // Sort photos based on sortBy option
  const sortedPhotos = useMemo(() => {
    const photosCopy = [...photos];

    switch (sortBy) {
      case 'oldest-to-newest':
        return photosCopy.sort((a, b) => {
          const dateA = a.CreatedAt ? new Date(a.CreatedAt).getTime() : 0;
          const dateB = b.CreatedAt ? new Date(b.CreatedAt).getTime() : 0;
          return dateA - dateB;
        });
      case 'newest-to-oldest':
        return photosCopy.sort((a, b) => {
          const dateA = a.CreatedAt ? new Date(a.CreatedAt).getTime() : 0;
          const dateB = b.CreatedAt ? new Date(b.CreatedAt).getTime() : 0;
          return dateB - dateA;
        });
      case 'most-popular':
        return photosCopy.sort((a, b) => {
          const cheersA = getCheersCount(a);
          const cheersB = getCheersCount(b);
          return cheersB - cheersA;
        });
      default:
        return photosCopy;
    }
  }, [photos, sortBy, getCheersCount]);

  const filteredPhotos = useMemo(() => {
    if (!deferredSearchQuery.trim()) return sortedPhotos;

    const query = deferredSearchQuery.toLowerCase();
    return sortedPhotos.filter(photo => {
      const extended = photo as ExtendedPhoto;
      const room = getPhotoRoom(photo).toLowerCase();
      const users = getPhotoUsers(photo).join(' ').toLowerCase();
      const description = (extended.Description || '').toLowerCase();
      return (
        room.includes(query) ||
        users.includes(query) ||
        description.includes(query)
      );
    });
  }, [sortedPhotos, deferredSearchQuery, getPhotoRoom, getPhotoUsers]);

  const groupedPhotos = useMemo(() => {
    if (groupBy === 'none') {
      return null;
    }

    const groups: Record<string, Photo[]> = {};

    filteredPhotos.forEach(photo => {
      const key =
        groupBy === 'room'
          ? getPhotoRoom(photo)
          : groupBy === 'user'
            ? (() => {
                const users = getPhotoUsers(photo);
                return users.length > 0 ? users.join(', ') : 'Untagged';
              })()
            : groupBy === 'date'
              ? (() => {
                  if (photo.CreatedAt) {
                    return format(new Date(photo.CreatedAt), 'yyyy-MM-dd');
                  }
                  return 'Unknown Date';
                })()
              : 'All Photos';

      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(photo);
    });

    return groups;
  }, [filteredPhotos, groupBy, getPhotoRoom, getPhotoUsers]);

  // Track container size for responsive virtualization
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    const updateSize = () => {
      setContainerSize({
        width: node.clientWidth,
        height: node.clientHeight,
      });
    };

    updateSize();

    const resizeObserver = new ResizeObserver(() => {
      updateSize();
    });

    resizeObserver.observe(node);
    return () => {
      resizeObserver.disconnect();
    };
  }, [scrollRef]);

  // Track scroll position with rAF to avoid thrashing renders
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    const handleScroll = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => {
        setScrollTop(node.scrollTop);
        if (onScrollPositionChange) {
          onScrollPositionChange(node.scrollTop);
        }
      });
    };

    node.addEventListener('scroll', handleScroll);
    return () => {
      node.removeEventListener('scroll', handleScroll);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [onScrollPositionChange, scrollRef]);

  const MIN_COLUMN_WIDTH = 240;
  // Card height calculation for 16:9 aspect ratio:
  // Image (16:9 at 240px width): 240 * 9/16 = 135px
  // CardContent padding: 32px (p-4 = 16px top + 16px bottom)
  // Metadata lines: ~80px (room + users + date with spacing)
  // Card border/shadow: ~2px
  // Total: ~250px (rounded up for safety)
  const ROW_HEIGHT = 250; // approximate card height with 16:9 image and metadata text
  const OVERSCAN_ROWS = 2;

  const columns = useMemo(
    () => Math.max(1, Math.floor(containerSize.width / MIN_COLUMN_WIDTH)),
    [containerSize.width]
  );
  const totalRows = Math.ceil(filteredPhotos.length / columns);
  const startRow = Math.max(
    0,
    Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS
  );
  const endRow = Math.min(
    totalRows,
    Math.ceil((scrollTop + containerSize.height) / ROW_HEIGHT) + OVERSCAN_ROWS
  );
  const startIndex = startRow * columns;
  const endIndex = Math.min(filteredPhotos.length, endRow * columns);
  const virtualPhotos = filteredPhotos.slice(startIndex, endIndex);
  const paddingTop = startRow * ROW_HEIGHT;
  const paddingBottom = Math.max(0, (totalRows - endRow) * ROW_HEIGHT);

  const renderVirtualizedGrid = () => (
    <div className={`flex h-full flex-col space-y-4 ${className}`}>
      <div ref={scrollRef} className="h-full overflow-auto">
        <div
          style={{
            paddingTop,
            paddingBottom,
            display: 'grid',
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gap: '1rem',
          }}
        >
          {virtualPhotos.map((photo, index) => {
            const room = getPhotoRoom(photo);
            const users = getPhotoUsers(photo);
            const imageUrl = getPhotoImageUrl(photo);
            const formattedDate = photo.CreatedAt
              ? format(new Date(photo.CreatedAt), 'MMM d, yyyy')
              : undefined;

            return (
              <PhotoCard
                key={`${photo.Id}-${startIndex + index}`}
                photo={photo}
                onClick={onPhotoClick}
                room={room}
                users={users}
                imageUrl={imageUrl}
                formattedDate={formattedDate}
              />
            );
          })}
        </div>
      </div>
      {filteredPhotos.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p>No photos found</p>
        </div>
      )}
    </div>
  );

  const renderGroup = (groupName: string, groupPhotos: Photo[]) => (
    <div key={groupName}>
      {groupBy !== 'none' && (
        <h2 className="text-xl font-semibold mb-4">{groupName}</h2>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {groupPhotos.map(photo => {
          const room = getPhotoRoom(photo);
          const users = getPhotoUsers(photo);
          const imageUrl = getPhotoImageUrl(photo);
          const formattedDate = photo.CreatedAt
            ? format(new Date(photo.CreatedAt), 'MMM d, yyyy')
            : undefined;

          return (
            <PhotoCard
              key={photo.Id}
              photo={photo}
              onClick={onPhotoClick}
              room={room}
              users={users}
              imageUrl={imageUrl}
              formattedDate={formattedDate}
            />
          );
        })}
      </div>
    </div>
  );

  if (groupBy === 'none') {
    return renderVirtualizedGrid();
  }

  return (
    <div className={`flex h-full flex-col ${className}`}>
      <div ref={scrollRef} className="h-full overflow-auto space-y-8">
        {groupedPhotos &&
          Object.entries(groupedPhotos).map(([groupName, groupPhotos]) =>
            renderGroup(groupName, groupPhotos)
          )}
        {filteredPhotos.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p>No photos found</p>
          </div>
        )}
      </div>
    </div>
  );
};

interface PhotoCardProps {
  photo: Photo;
  onClick: (photo: Photo) => void;
  room: string;
  users: string[];
  imageUrl: string;
  formattedDate?: string;
}

const PhotoCard: React.FC<PhotoCardProps> = React.memo(
  ({ photo, onClick, room, users, imageUrl, formattedDate }) => {
    const handleClick = React.useCallback(
      () => onClick(photo),
      [onClick, photo]
    );
    const { isFavorite, toggleFavorite } = useFavorites();
    const photoId = photo.Id.toString();
    const favorited = isFavorite(photoId);

    const handleFavoriteClick = React.useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent card click
        toggleFavorite(photoId);
      },
      [toggleFavorite, photoId]
    );

    return (
      <Card
        className="overflow-hidden cursor-pointer hover:shadow-lg transition-shadow"
        onClick={handleClick}
      >
        <div className="aspect-video relative overflow-hidden bg-muted group">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={`Photo ${photo.Id}`}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
              No Image
            </div>
          )}
          <Button
            variant="secondary"
            size="icon"
            className={`absolute top-2 right-2 h-8 w-8 rounded-full shadow-lg transition-all ${
              favorited
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-background/80 hover:bg-background text-muted-foreground opacity-0 group-hover:opacity-100'
            }`}
            onClick={handleFavoriteClick}
            aria-label={
              favorited ? 'Remove from favorites' : 'Add to favorites'
            }
          >
            <Heart className={`h-4 w-4 ${favorited ? 'fill-current' : ''}`} />
          </Button>
        </div>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4" />
            <span className="truncate">{room}</span>
          </div>
          {users.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
              <Users className="h-4 w-4 flex-shrink-0" />
              <span className="truncate min-w-0">{users.join(', ')}</span>
            </div>
          )}
          {formattedDate && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span>{formattedDate}</span>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }
);

PhotoCard.displayName = 'PhotoCard';

export const PhotoGrid = React.memo(PhotoGridComponent);
PhotoGrid.displayName = 'PhotoGrid';
