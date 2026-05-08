import React, { useEffect, useMemo, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { AvailableEvent } from '../../shared/types';

interface EventCoverImageProps {
  event: AvailableEvent;
  cdnBase?: string;
  className?: string;
  iconClassName?: string;
  allowRemoteFallback?: boolean;
}

export const EventCoverImage: React.FC<EventCoverImageProps> = ({
  event,
  className = 'h-full w-full object-cover',
  iconClassName = 'h-8 w-8',
}) => {
  const sources = useMemo(() => {
    const nextSources: string[] = [];

    if (event.localImagePath) {
      nextSources.push(`local://${encodeURIComponent(event.localImagePath)}`);
    }

    return nextSources;
  }, [event.localImagePath]);

  const [sourceIndex, setSourceIndex] = useState(0);

  useEffect(() => {
    setSourceIndex(0);
  }, [sources]);

  const source = sources[sourceIndex];

  if (!source) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <ImageIcon className={iconClassName} />
      </div>
    );
  }

  return (
    <img
      src={source}
      alt=""
      className={className}
      loading="lazy"
      onError={() => setSourceIndex(index => index + 1)}
    />
  );
};
