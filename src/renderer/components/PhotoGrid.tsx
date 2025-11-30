import React, { useMemo, useCallback } from 'react';
import { MapPin, Users, Calendar } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/card';
import { Photo } from '../../shared/types';
import { format } from 'date-fns';

interface PhotoGridProps {
  photos: Photo[];
  onPhotoClick: (photo: Photo) => void;
  groupBy?: 'none' | 'room' | 'user' | 'date';
  searchQuery?: string;
  roomMap?: Map<string, string>;
  accountMap?: Map<string, string>;
}

export const PhotoGrid: React.FC<PhotoGridProps> = ({
  photos,
  onPhotoClick,
  groupBy = 'none',
  searchQuery = '',
  roomMap = new Map(),
  accountMap = new Map(),
}) => {
  interface ExtendedPhoto extends Photo {
    RoomId?: number | string | null;
    roomId?: number | string | null;
    Room?: string;
    RoomName?: string;
    Users?: string[];
    TaggedUsers?: string[];
    TaggedPlayerIds?: number[];
    Description?: string;
  }

  const getPhotoRoom = useCallback((photo: Photo): string => {
    const extended = photo as ExtendedPhoto;
    
    const rawRoomId =
      extended.RoomId ??
      extended.roomId ??
      (typeof extended.Room === 'string' || typeof extended.Room === 'number'
        ? extended.Room
        : undefined);
    if (rawRoomId === null) {
      return 'null';
    }
    const roomId =
      rawRoomId !== undefined && rawRoomId !== ''
        ? rawRoomId
        : undefined;
    
    if (roomId !== undefined) {
      const roomIdStr = String(roomId);
      const mappedRoomName =
        roomMap.get(roomIdStr) ||
        roomMap.get(String(Number(roomIdStr))) ||
        (typeof extended.RoomName === 'string' ? extended.RoomName : undefined);

      if (mappedRoomName) {
        return mappedRoomName;
      }

      // While metadata is still downloading, show the ID until we can swap to the name
      return roomIdStr;
    }
    
    return extended.RoomName || 'Unknown Room';
  }, [roomMap]);

  const getPhotoUsers = useCallback((photo: Photo): string[] => {
    const extended = photo as ExtendedPhoto;
    // TaggedPlayerIds is the field name in the photo metadata
    const userIds = extended.TaggedPlayerIds || extended.Users || extended.TaggedUsers || [];
    
    if (!Array.isArray(userIds)) {
      return [];
    }
    
    // Map user IDs to names if available
    return userIds.map((userId) => {
      const userName = accountMap.get(String(userId));
      return userName || String(userId);
    });
  }, [accountMap]);

  const getPhotoDate = (photo: Photo): Date | null => {
    if (photo.CreatedAt) {
      return new Date(photo.CreatedAt);
    }
    return null;
  };

  const filteredPhotos = useMemo(() => {
    if (!searchQuery.trim()) return photos;

    const query = searchQuery.toLowerCase();
    return photos.filter((photo) => {
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
  }, [photos, searchQuery, getPhotoRoom, getPhotoUsers]);

  const groupedPhotos = useMemo(() => {
    if (groupBy === 'none') {
      return { 'All Photos': filteredPhotos };
    }

    const groups: Record<string, Photo[]> = {};

    filteredPhotos.forEach((photo) => {
      let key: string;

      if (groupBy === 'room') {
        key = getPhotoRoom(photo);
      } else if (groupBy === 'user') {
        const users = getPhotoUsers(photo);
        key = users.length > 0 ? users.join(', ') : 'Untagged';
      } else if (groupBy === 'date') {
        const date = getPhotoDate(photo);
        if (date) {
          key = format(date, 'yyyy-MM-dd');
        } else {
          key = 'Unknown Date';
        }
      } else {
        key = 'All Photos';
      }

      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(photo);
    });

    return groups;
  }, [filteredPhotos, groupBy, getPhotoRoom, getPhotoUsers]);

  const getPhotoImageUrl = (photo: Photo): string => {
    // Prioritize local file over CDN for offline viewing
    if (photo.localFilePath) {
      // Use custom local:// protocol for serving files securely in Electron
      // Encode the path to handle special characters
      const encodedPath = encodeURIComponent(photo.localFilePath);
      return `local://${encodedPath}`;
    }
    // Fallback to CDN if no local file (shouldn't happen after our filtering)
    if (photo.ImageName) {
      return `https://img.rec.net/${photo.ImageName}`;
    }
    return '';
  };

  return (
    <div className="space-y-8">
      {Object.entries(groupedPhotos).map(([groupName, groupPhotos]) => (
        <div key={groupName}>
          {groupBy !== 'none' && (
            <h2 className="text-xl font-semibold mb-4">{groupName}</h2>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {groupPhotos.map((photo) => {
              const room = getPhotoRoom(photo);
              const users = getPhotoUsers(photo);
              const imageUrl = getPhotoImageUrl(photo);

              return (
                <Card
                  key={photo.Id}
                  className="overflow-hidden cursor-pointer hover:shadow-lg transition-shadow"
                  onClick={() => onPhotoClick(photo)}
                >
                  <div className="aspect-square relative overflow-hidden bg-muted">
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
                  </div>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MapPin className="h-4 w-4" />
                      <span className="truncate">{room}</span>
                    </div>
                    {users.length > 0 && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Users className="h-4 w-4" />
                        <span className="truncate">{users.join(', ')}</span>
                      </div>
                    )}
                    {photo.CreatedAt && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        <span>{format(new Date(photo.CreatedAt), 'MMM d, yyyy')}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ))}
      {filteredPhotos.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p>No photos found</p>
        </div>
      )}
    </div>
  );
};

