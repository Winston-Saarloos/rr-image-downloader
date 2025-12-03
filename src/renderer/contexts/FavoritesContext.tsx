import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

interface FavoritesContextType {
  favorites: Set<string>;
  loading: boolean;
  toggleFavorite: (photoId: string) => Promise<boolean>;
  isFavorite: (photoId: string) => boolean;
}

const FavoritesContext = createContext<FavoritesContextType | undefined>(undefined);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Load favorites on mount
  useEffect(() => {
    const loadFavorites = async () => {
      try {
        if (window.electronAPI) {
          const result = await window.electronAPI.getFavorites();
          if (result.success && result.data) {
            // Convert array to Set for efficient lookups
            setFavorites(new Set(result.data));
          }
        }
      } catch (error) {
        console.error('Failed to load favorites:', error);
      } finally {
        setLoading(false);
      }
    };

    loadFavorites();
  }, []);

  // Toggle favorite status
  const toggleFavorite = useCallback(async (photoId: string) => {
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.toggleFavorite(photoId);
        if (result.success) {
          // Update local state optimistically
          setFavorites((prev) => {
            const newFavorites = new Set(prev);
            if (result.data) {
              newFavorites.add(photoId);
            } else {
              newFavorites.delete(photoId);
            }
            return newFavorites;
          });
          return result.data; // Returns true if now favorited, false if unfavorited
        }
      }
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    }
    return false;
  }, []);

  // Check if a photo is favorited
  const isFavorite = useCallback(
    (photoId: string): boolean => {
      return favorites.has(photoId);
    },
    [favorites]
  );

  return (
    <FavoritesContext.Provider
      value={{
        favorites,
        loading,
        toggleFavorite,
        isFavorite,
      }}
    >
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites() {
  const context = useContext(FavoritesContext);
  if (context === undefined) {
    throw new Error('useFavorites must be used within a FavoritesProvider');
  }
  return context;
}

