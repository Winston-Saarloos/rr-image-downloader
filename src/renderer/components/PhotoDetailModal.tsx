import React from 'react';
import { MapPin, Users, Calendar, Heart } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Chip } from '../../components/ui/chip';
import { Photo } from '../../shared/types';
import { format } from 'date-fns';
import { ExtendedPhoto, usePhotoMetadata } from '../hooks/usePhotoMetadata';
import { useFavorites } from '../hooks/useFavorites';

interface PhotoDetailModalProps {
  photo: Photo | null;
  open: boolean;
  onClose: () => void;
  roomMap?: Map<string, string>;
  accountMap?: Map<string, string>;
}

const PhotoDetailModalComponent: React.FC<PhotoDetailModalProps> = ({
  photo,
  open,
  onClose,
  roomMap = new Map(),
  accountMap = new Map(),
}) => {
  const { getPhotoRoom, getPhotoUsers, getPhotoImageUrl } = usePhotoMetadata(
    roomMap,
    accountMap
  );
  const { isFavorite, toggleFavorite } = useFavorites();

  if (!photo) return null;

  const extended = photo as ExtendedPhoto;
  const room = getPhotoRoom(photo);
  const users = getPhotoUsers(photo);
  const description = extended.Description || '';
  const imageUrl = getPhotoImageUrl(photo);
  const createdAt = photo.CreatedAt ? new Date(photo.CreatedAt) : null;
  const photoId = photo.Id.toString();
  const favorited = isFavorite(photoId);

  const handleFavoriteClick = () => {
    toggleFavorite(photoId);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle>Photo Details</DialogTitle>
              <DialogDescription>
                View full resolution and details
              </DialogDescription>
            </div>
            <div className="mt-4">
              <Button
                variant={favorited ? 'default' : 'outline'}
                size="icon"
                className={
                  favorited ? 'bg-red-500 hover:bg-red-600 text-white' : ''
                }
                onClick={handleFavoriteClick}
                aria-label={
                  favorited ? 'Remove from favorites' : 'Add to favorites'
                }
              >
                <Heart
                  className={`h-5 w-5 ${favorited ? 'fill-current' : ''}`}
                />
              </Button>
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-4">
          {imageUrl && (
            <div className="relative w-full">
              <img
                src={imageUrl}
                alt={`Photo ${photo.Id}`}
                className="w-full h-auto rounded-lg"
              />
            </div>
          )}
          {description && (
            <div>
              <div className="pt-2 border-t">
                <p className="font-medium mb-2">Description:</p>
                <p className="text-muted-foreground">{description}</p>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Room:</span>
              <span>{room}</span>
            </div>

            {users.length > 0 && (
              <div className="flex items-start gap-2">
                <Users className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div>
                  <span className="font-medium">Tagged Users: </span>
                  {users.map(user => {
                    return (
                      <Chip className="mr-1" key={user}>
                        @{user}
                      </Chip>
                    );
                  })}
                </div>
              </div>
            )}

            {createdAt && (
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Date Taken: </span>
                <span>{format(createdAt, 'MMMM d, yyyy h:mm a')}</span>
              </div>
            )}

            {description && (
              <div className="pt-2 border-t">
                <p className="font-medium mb-2">Description:</p>
                <p className="text-muted-foreground">{description}</p>
              </div>
            )}

            <div className="pt-2 border-t text-sm text-muted-foreground">
              <p>Photo ID: {photo.Id}</p>
              {photo.ImageName && <p>Image: {photo.ImageName}</p>}
              <p>
                URL:
                <button
                  className="text-blue-500 hover:text-blue-600 underline ml-1 cursor-pointer"
                  onClick={() => {
                    const url = `https://rec.net/image/${photo.Id}`;
                    if (window.electronAPI) {
                      window.electronAPI.openExternal(url);
                    }
                  }}
                >
                  https://rec.net/image/{photo.Id}
                </button>
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const PhotoDetailModal = React.memo(PhotoDetailModalComponent);
PhotoDetailModal.displayName = 'PhotoDetailModal';
