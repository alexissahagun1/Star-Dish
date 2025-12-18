import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, TextInput, Pressable, FlatList, ActivityIndicator, Keyboard, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useDebounce } from '../hooks/useDebounce';
import { searchAutocomplete, retrieveFeature, type SearchAutocompleteResult } from '../services/mapboxSearchService';
import { sessionTokenManager } from '../services/sessionTokenManager';
import { lightHaptic } from '../lib/haptics';
import { SDText } from './ui';
import { theme } from '../theme';
import type { MapboxSuggestion, MapboxFeature } from '../types/database';

export interface SearchHeaderProps {
  placeholder?: string;
  onSelect: (feature: MapboxFeature) => void;
  proximity?: { latitude: number; longitude: number };
  initialValue?: string;
  autoFocus?: boolean;
}

export function SearchHeader({
  placeholder = 'What restaurant are you at?',
  onSelect,
  proximity,
  initialValue = '',
  autoFocus = false,
}: SearchHeaderProps) {
  const [query, setQuery] = useState(initialValue);
  const [suggestions, setSuggestions] = useState<SearchAutocompleteResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<TextInput>(null);
  const debouncedQuery = useDebounce(query, 300);

  // Search for suggestions when query changes
  useEffect(() => {
    const search = async () => {
      if (!debouncedQuery || debouncedQuery.trim().length < 2) {
        setSuggestions([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        // Get session token from shared manager (only creates one if needed for API call)
        const token = sessionTokenManager.getToken();
        
        const { results, sessionToken } = await searchAutocomplete(
          debouncedQuery,
          {
            proximity,
            limit: 10,
          },
          token
        );
        
        // Update the shared session token manager with the returned token
        // This ensures we use the same token for retrieve() calls
        sessionTokenManager.updateToken(sessionToken);
        setSuggestions(results);
      } catch (error) {
        if (__DEV__) {
          console.error('[SearchHeader] Autocomplete error:', error);
        }
        setSuggestions([]);
      } finally {
        setIsLoading(false);
      }
    };

    void search();
  }, [debouncedQuery, proximity]);

  // Reset selected index when suggestions change
  useEffect(() => {
    setSelectedIndex(-1);
  }, [suggestions]);

  const handleSelect = useCallback(
    async (result: SearchAutocompleteResult) => {
      await lightHaptic();
      Keyboard.dismiss();
      setIsFocused(false);
      setSuggestions([]);
      setQuery(result.suggestion.name);

      try {
        setIsLoading(true);
        // Get session token from shared manager for retrieve() call
        const token = sessionTokenManager.hasToken() ? sessionTokenManager.getToken() : undefined;
        // Pass the original SearchBoxSuggestion and session token to retrieve() for proper session tracking
        const feature = await retrieveFeature(result.original, token);
        if (feature) {
          onSelect(feature);
        }
        // Clear session token after successful retrieve (one session per selection)
        sessionTokenManager.clearToken();
      } catch (error) {
        if (__DEV__) {
          console.error('[SearchHeader] Retrieve error:', error);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [onSelect]
  );

  const handleClear = useCallback(async () => {
    await lightHaptic();
    setQuery('');
    setSuggestions([]);
    setIsFocused(false);
    inputRef.current?.blur();
  }, []);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
  }, []);

  const handleBlur = useCallback(() => {
    // Delay blur to allow selection to register
    setTimeout(() => {
      setIsFocused(false);
    }, 200);
  }, []);

  const showSuggestions = isFocused && (suggestions.length > 0 || isLoading);

  return (
    <View style={styles.container}>
      <View style={[styles.searchRow, isFocused && styles.searchRowFocused]}>
        <Ionicons name="search-outline" size={20} color={isFocused ? theme.colors.brand : theme.colors.textMuted} />
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={setQuery}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textMuted}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          onFocus={handleFocus}
          onBlur={handleBlur}
          style={styles.searchInput}
          autoFocus={autoFocus}
        />
        {query.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={handleClear}
            style={({ pressed }) => [styles.clearBtn, { opacity: pressed ? 0.75 : 1 }]}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color={theme.colors.brand} />
            ) : (
              <Ionicons name="close-circle" size={22} color={theme.colors.textMuted} />
            )}
          </Pressable>
        )}
      </View>

      {showSuggestions && (
        <View style={styles.suggestionsContainer}>
            {isLoading && suggestions.length === 0 ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={theme.colors.brand} />
                <SDText color="textMuted" variant="caption" style={styles.loadingText}>
                  Searching...
                </SDText>
              </View>
            ) : suggestions.length > 0 ? (
              <FlatList
                data={suggestions}
                keyExtractor={(item) => item.suggestion.mapbox_id}
                style={styles.suggestionsList}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item, index }) => {
                  const suggestion = item.suggestion;
                  // Extract neighborhood from context
                  const neighborhood = suggestion.context?.find((ctx) => ctx.id === 'neighborhood' || ctx.id === 'place');
                  const neighborhoodText = neighborhood?.text || '';

                  return (
                    <Animated.View entering={FadeInDown.delay(index * 30).duration(200)}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Select ${suggestion.name}`}
                        onPress={() => void handleSelect(item)}
                        style={({ pressed }) => [
                          styles.suggestionRow,
                          pressed && styles.suggestionRowPressed,
                        ]}
                      >
                        <View style={styles.suggestionIcon}>
                          <Ionicons name="restaurant-outline" size={20} color={theme.colors.brand} />
                        </View>
                        <View style={styles.suggestionBody}>
                          <SDText weight="semibold" numberOfLines={1}>
                            {suggestion.name}
                          </SDText>
                          {neighborhoodText && (
                            <SDText color="textMuted" variant="caption" numberOfLines={1}>
                              {neighborhoodText}
                            </SDText>
                          )}
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                      </Pressable>
                    </Animated.View>
                  );
                }}
              />
            ) : null}
          </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    zIndex: Platform.OS === 'web' ? 1000 : 1000,
    width: '100%',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    borderRadius: theme.radii.xl,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    backgroundColor: Platform.OS === 'web' ? 'rgba(255, 255, 255, 0.98)' : theme.colors.surface,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    minHeight: 56,
    ...(Platform.OS === 'web' && {
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
      willChange: 'border-color, box-shadow',
    }),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  searchRowFocused: {
    borderColor: theme.colors.brand,
    borderWidth: 2.5,
    ...(Platform.OS === 'web' && {
      boxShadow: '0 6px 20px rgba(255, 106, 61, 0.3)',
      transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
    }),
    shadowColor: theme.colors.brand,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
  searchInput: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 16,
    lineHeight: 24,
    paddingVertical: 0,
    ...(Platform.OS === 'web' && {
      outlineStyle: 'none',
    }),
  },
  loadingIndicator: {
    marginLeft: theme.spacing.xs,
  },
  clearBtn: {
    padding: theme.spacing.xs,
    marginLeft: theme.spacing.xs,
    cursor: Platform.OS === 'web' ? 'pointer' : 'default',
    borderRadius: theme.radii.pill,
  },
  suggestionsContainer: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: theme.spacing.md,
    backgroundColor: Platform.OS === 'web' ? 'rgba(255, 255, 255, 0.98)' : theme.colors.surface,
    borderRadius: theme.radii.xl,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    maxHeight: 400,
    overflow: 'hidden',
    zIndex: Platform.OS === 'web' ? 1001 : 1001,
    ...(Platform.OS === 'web'
      ? {
          boxShadow: '0 16px 40px rgba(0, 0, 0, 0.18), 0 6px 16px rgba(0, 0, 0, 0.12)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
        }
      : {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 12 },
          shadowOpacity: 0.2,
          shadowRadius: 24,
          elevation: 16,
        }),
  },
  suggestionsList: {
    maxHeight: 400,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
    minHeight: 64,
    ...(Platform.OS === 'web' && {
      cursor: 'pointer',
      transition: 'background-color 0.15s ease',
    }),
  },
  suggestionRowPressed: {
    backgroundColor: Platform.OS === 'web' ? 'rgba(255, 106, 61, 0.08)' : 'rgba(255, 106, 61, 0.05)',
    opacity: Platform.OS === 'web' ? 1 : 0.85,
  },
  suggestionIcon: {
    width: 40,
    height: 40,
    borderRadius: theme.radii.md,
    backgroundColor: Platform.OS === 'web' ? 'rgba(255, 106, 61, 0.12)' : theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionBody: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  loadingText: {
    marginLeft: theme.spacing.xs,
  },
});
