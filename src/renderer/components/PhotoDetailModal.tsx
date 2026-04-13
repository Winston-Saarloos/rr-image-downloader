import React, { useMemo } from 'react';
import {
  MapPin,
  Users,
  User,
  Calendar,
  Heart,
  FolderOpen,
  Ticket,
  MessageCircle,
  ThumbsUp,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Button } from '../components/ui/button';
import { Chip } from '../components/ui/chip';
import { ImageCommentDto, Photo } from '../../shared/types';
import { format, isValid, parseISO } from 'date-fns';
import { DEFAULT_CDN_BASE } from '../../shared/cdnUrl';
import { usePhotoMetadata } from '../hooks/usePhotoMetadata';
import { useFavorites } from '../hooks/useFavorites';

interface PhotoDetailModalProps {
  photo: Photo | null;
  open: boolean;
  onClose: () => void;
  roomMap?: Map<string, string>;
  accountMap?: Map<string, string>;
  usernameMap?: Map<string, string>;
  eventMap?: Map<string, string>;
  cdnBase?: string;
  imageComments?: ImageCommentDto[];
}

type OptionalElectronAPI = {
  openPathInExplorer?: (
    targetPath: string
  ) => Promise<{ success: boolean; error?: string }>;
  openExternal?: (url: string) => Promise<void>;
};

const PhotoDetailModalComponent: React.FC<PhotoDetailModalProps> = ({
  photo,
  open,
  onClose,
  roomMap = new Map(),
  accountMap = new Map(),
  usernameMap = new Map(),
  eventMap = new Map(),
  cdnBase = DEFAULT_CDN_BASE,
  imageComments = [],
}) => {
  const { getPhotoRoom, getPhotoTaggedUsers, getPhotoImageUrl, getPhotoEvent } =
    usePhotoMetadata(roomMap, accountMap, eventMap, cdnBase, usernameMap);
  const { isFavorite, toggleFavorite } = useFavorites();
  const electronAPI = (window as Window & { electronAPI?: OptionalElectronAPI })
    .electronAPI;

  const photoComments = useMemo(() => {
    if (!photo) {
      return [];
    }
    const id = String(photo.Id);
    const parseTime = (raw: string): number => {
      if (!raw) {
        return 0;
      }
      const fromIso = parseISO(raw);
      if (isValid(fromIso)) {
        return fromIso.getTime();
      }
      const fallback = new Date(raw);
      return isValid(fallback) ? fallback.getTime() : 0;
    };
    return imageComments
      .filter(c => c.SavedImageId === id)
      .sort((a, b) => parseTime(a.CreatedAt) - parseTime(b.CreatedAt));
  }, [imageComments, photo]);

  if (!photo) return null;

  const extended = photo as Photo & { Description?: string };
  const room = getPhotoRoom(photo);
  const taggedUsers = getPhotoTaggedUsers(photo);
  const description = extended.Description || '';
  const imageUrl = getPhotoImageUrl(photo);
  const createdAt = photo.CreatedAt ? new Date(photo.CreatedAt) : null;
  const commentCount =
    typeof photo.CommentCount === 'number' ? photo.CommentCount : 0;
  const cheerCount =
    typeof photo.CheerCount === 'number' ? photo.CheerCount : 0;
  const photoId = photo.Id.toString();
  const favorited = isFavorite(photoId);
  const eventInfo = getPhotoEvent(photo);
  const localFilePath = photo.localFilePath?.trim() || '';

  const handleFavoriteClick = () => {
    toggleFavorite(photoId);
  };

  const handleViewFullResolution = async () => {
    if (!localFilePath || !electronAPI?.openPathInExplorer) {
      return;
    }
    await electronAPI.openPathInExplorer(localFilePath);
  };

  const formatCommentDate = (raw: string): string => {
    if (!raw) {
      return '';
    }
    const fromIso = parseISO(raw);
    if (isValid(fromIso)) {
      return format(fromIso, 'MMMM d, yyyy h:mm a');
    }
    const fallback = new Date(raw);
    if (isValid(fallback)) {
      return format(fallback, 'MMMM d, yyyy h:mm a');
    }
    return raw;
  };

  const showCommentsSection = commentCount > 0 || photoComments.length > 0;

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

            <div className="flex items-center gap-2">
              <Ticket className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Event:</span>
              <span>
                {eventInfo.name ||
                  (eventInfo.id ? `Event ${eventInfo.id}` : 'No event data')}
              </span>
            </div>

            {taggedUsers.length > 0 && (
              <div className="flex items-start gap-2">
                <Users className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div>
                  <span className="font-medium">Tagged Users: </span>
                  {taggedUsers.map(({ id, displayName, username }, index) => (
                    <Chip
                      variant="secondary"
                      className="mr-1 inline-flex flex-col items-start gap-0.5 py-1"
                      key={`${id}-${index}`}
                    >
                      <span>{displayName}</span>
                      {username ? (
                        <span className="text-muted-foreground font-normal">
                          @{username}
                        </span>
                      ) : null}
                    </Chip>
                  ))}
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

            <div className="flex items-center gap-4">
              {photoComments.length === 0 && (
                <div className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Comments:</span>
                  <span>{commentCount}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <ThumbsUp className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Cheers:</span>
                <span>{cheerCount}</span>
              </div>
            </div>

            {showCommentsSection && (
              <div className="pt-2 border-t">
                <div className="flex items-center gap-2 mb-2">
                  <MessageCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-medium">Comments</span>
                  <span className="text-sm text-muted-foreground">
                    {photoComments.length > 0
                      ? `${photoComments.length}${
                          commentCount > photoComments.length
                            ? ` of ${commentCount}`
                            : ''
                        }`
                      : commentCount > 0
                        ? `${commentCount} on RecNet`
                        : ''}
                  </span>
                </div>
                {photoComments.length > 0 ? (
                  <div
                    className="max-h-[min(40vh,20rem)] overflow-y-auto rounded-lg border border-border/80 bg-background px-2 py-1"
                    role="region"
                    aria-label="Image comments"
                  >
                    <ul className="divide-y divide-border/60">
                      {photoComments.map(comment => {
                        const authorName =
                          accountMap.get(comment.PlayerId) ||
                          (comment.PlayerId ? comment.PlayerId : 'Unknown');
                        const username = usernameMap.get(comment.PlayerId);
                        const dateLabel = formatCommentDate(comment.CreatedAt);
                        return (
                          <li
                            key={comment.SavedImageCommentId}
                            className="flex gap-3 py-3 first:pt-2 last:pb-2"
                          >
                            <div
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                              aria-hidden
                            >
                              <User className="h-5 w-5" strokeWidth={1.75} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 leading-tight">
                                <span className="text-sm font-semibold">
                                  {authorName}
                                </span>
                                {username ? (
                                  <span className="text-xs font-normal text-muted-foreground">
                                    @{username}
                                  </span>
                                ) : null}
                                {dateLabel ? (
                                  <>
                                    <span
                                      className="text-muted-foreground/70"
                                      aria-hidden
                                    >
                                      ·
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {dateLabel}
                                    </span>
                                  </>
                                ) : null}
                              </div>
                              <p className="mt-1 text-sm leading-relaxed text-foreground whitespace-pre-wrap break-words">
                                {comment.Comment}
                              </p>
                              {comment.CheerCount > 0 ? (
                                <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <ThumbsUp className="h-3.5 w-3.5 shrink-0 opacity-80" />
                                  <span className="tabular-nums">
                                    {comment.CheerCount}
                                  </span>
                                </div>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No saved comments for this image
                  </p>
                )}
              </div>
            )}

            {localFilePath && (
              <div className="flex items-start gap-2">
                <FolderOpen className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="min-w-0">
                  <span className="font-medium">Saved on disk: </span>
                  <button
                    className="text-blue-500 hover:text-blue-600 underline ml-1 cursor-pointer"
                    onClick={handleViewFullResolution}
                    type="button"
                  >
                    View full resolution
                  </button>
                  <p className="text-xs text-muted-foreground mt-1 break-all">
                    {localFilePath}
                  </p>
                </div>
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
                    if (electronAPI) {
                      void electronAPI.openExternal?.(url);
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
