import React, { useMemo } from 'react';
import { MapPin, Users, Calendar } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/card';
import { Photo } from '../../shared/types';
import { format } from 'date-fns';
import { ExtendedPhoto, usePhotoMetadata } from '../hooks/usePhotoMetadata';

interface PhotoGridProps {
  photos: Photo[];
  onPhotoClick: (photo: Photo) => void;
  groupBy?: 'none' | 'room' | 'user' | 'date';
  searchQuery?: string;
  roomMap?: Map<string, string>;
  accountMap?: Map<string, string>;
}

const PhotoGridComponent: React.FC<PhotoGridProps> = ({
  photos,
  onPhotoClick,
  groupBy = 'none',
  searchQuery = '',
  roomMap = new Map(),
  accountMap = new Map(),
}) => {
  const { getPhotoRoom, getPhotoUsers, getPhotoImageUrl } = usePhotoMetadata(
    roomMap,
    accountMap
  );

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

  const renderGroup = (groupName: string, groupPhotos: Photo[]) => (
    <div key={groupName}>
      {groupBy !== 'none' && (
        <h2 className="text-xl font-semibold mb-4">{groupName}</h2>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {groupPhotos.map((photo) => {
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

  return (
    <div className="space-y-8">
      {Object.entries(groupedPhotos).map(([groupName, groupPhotos]) =>
        renderGroup(groupName, groupPhotos)
      )}
      {filteredPhotos.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p>No photos found</p>
        </div>
      )}
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
    const handleClick = React.useCallback(() => onClick(photo), [onClick, photo]);

    return (
      <Card
        className="overflow-hidden cursor-pointer hover:shadow-lg transition-shadow"
        onClick={handleClick}
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
