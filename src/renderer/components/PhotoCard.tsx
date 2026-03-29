import React from 'react';
import {
  MapPin,
  Users,
  Calendar,
  Heart,
  Ticket,
  MessageCircle,
  ThumbsUp,
} from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Photo } from '../../shared/types';
import { useFavorites } from '../hooks/useFavorites';

export interface PhotoCardProps {
  photo: Photo;
  onClick: (photo: Photo) => void;
  room: string;
  users: string[];
  imageUrl: string;
  formattedDate?: string;
  eventName?: string;
  eventId?: string;
  hideRoom?: boolean;
}

export const PhotoCard: React.FC<PhotoCardProps> = React.memo(
  ({
    photo,
    onClick,
    room,
    users,
    imageUrl,
    formattedDate,
    eventName,
    eventId,
    hideRoom = false,
  }) => {
    const handleClick = React.useCallback(
      () => onClick(photo),
      [onClick, photo]
    );
    const { isFavorite, toggleFavorite } = useFavorites();
    const photoId = photo.Id.toString();
    const favorited = isFavorite(photoId);
    const commentCount =
      typeof photo.CommentCount === 'number' ? photo.CommentCount : 0;
    const cheerCount =
      typeof photo.CheerCount === 'number' ? photo.CheerCount : 0;

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
          <div className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-xs font-medium text-white">
            <MessageCircle className="h-3.5 w-3.5" />
            <span>{commentCount}</span>
          </div>
          <div className="pointer-events-none absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-xs font-medium text-white">
            <span>{cheerCount}</span>
            <ThumbsUp className="h-3.5 w-3.5" />
          </div>
        </div>
        <CardContent className="p-4 space-y-2">
          {!hideRoom && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4" />
              <span className="truncate">{room}</span>
            </div>
          )}
          {(eventName || eventId) && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Ticket className="h-4 w-4" />
              <span className="truncate">
                {eventName || `Event ${eventId}`}
              </span>
            </div>
          )}
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
