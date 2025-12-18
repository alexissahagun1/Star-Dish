# Star Dish - Decisions & Implementation Notes

This file captures key decisions and reasoning for the Star Dish MVP. It is updated as work progresses.

## Naming & Identifiers

- App name: **Star Dish**
- Expo slug: **star-dish**
- iOS bundle identifier: **com.stardish.app**
- Android package: **com.stardish.app**

## Environment

Create a local env file (Expo public vars) using `ENV.example`:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_MAPBOX_TOKEN` (required for web map)

Notes:
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` must be the **Project API key labeled `anon`** (a JWT, often starting with `eyJ...`).
- If you use a **publishable** key (`sb_publishable_*`), Supabase Edge Functions will return **401 Invalid JWT**.
- `EXPO_PUBLIC_MAPBOX_TOKEN` is required for the web version of the map. Get your token from [Mapbox](https://account.mapbox.com/access-tokens/).

## Auth (Email + Password)

### Decision

- We use **email + password** for sign up / sign in (no magic links, no anonymous sessions).
- This avoids deep-link redirect configuration and works reliably in Expo Go, LAN, or tunnel.

### Required Supabase settings

In Supabase Dashboard → **Authentication**:

- **Providers** → Email: **Enabled**
- (Recommended for easiest dev) **Email confirmations**: **Disabled**
  - If confirmations are enabled, `signUp()` will create the account but users must confirm via email before they can sign in.

Notes:
- **Redirect URLs are not required** for email/password auth.
- We still persist sessions locally on device using AsyncStorage so users stay signed in across reloads.

## UX Quality Bar

- Map-first, low chrome, native-feeling gestures.
- Bottom sheet preview (Uber-style) implemented with `@gorhom/bottom-sheet`.
- Perceived performance: debounced map queries, **request cancellation**, **client-side caching/de-dupe**, skeleton loading blocks, optimistic vote UI.
- Light haptics on high-value interactions (marker select + vote toggles).

## Design (Light mode)

### Decision

- We are optimizing for a **clean light-mode UI** first (dark mode later).
- Bottom navigation uses a **floating pill tab bar** (custom tab bar component) inspired by the provided reference.
- Home is a **feed-style screen** with a greeting (`Hello Alexis`), a promo banner image, category pills, and a “Popular this week” image carousel.
- Map overlays (city label, chips, search pill) use **white translucent pills** for legibility over the map.
- Marker callouts are disabled (no `title`/`description`), so selection details appear only in the **bottom sheet**.

## Data & Security (Supabase)

- PostgreSQL with RLS enabled and policies used for access control.
- Voting logic is implemented as an RPC for atomicity and correctness under concurrency.
- Public can read restaurants/platillos and call `get_star_dish`.
- Full dish rankings are restricted to authenticated users.

## Implementation Status (this session)

- Map screen: `src/screens/MapScreen.tsx` with debounced viewport fetching and bottom-sheet marker preview.
- Memoized markers: `src/components/StarDishMarker.tsx` using `React.memo`.
- Voting: RPC-backed toggle via `toggle_platillo_vote` + client wrapper in `src/services/voteService.ts`.
- Realtime demo: `src/hooks/usePlatilloVotes.ts` subscribes to `votes` changes for a `platillo_id` and refreshes counts.

## Navigation (Bottom Tabs)

### Decision

We added **industry-standard bottom tab navigation** so the home experience isn’t “just a map”.

### Update (Home / Explore)

We removed the separate **Explore** screen and moved search + discovery controls directly onto the **Map** screen (Google Maps-style).

### Why

- **Predictable UX**: Map, Profile, Settings are top-level destinations and should be one-tap reachable.
- **Scales cleanly**: avoids stacking floating buttons on the map as the app grows.

### Implementation

- `App.tsx` now renders `NavigationContainer` + `RootTabs` instead of rendering `MapScreen` directly.
- Tabs live in `src/navigation/RootTabs.tsx`:
  - `Map` → `MapScreen`
  - `Profile` → `ProfileScreen`
  - `Settings` → `SettingsScreen`

### Web note

`react-native-maps` is native-only; Expo Web bundling fails if it’s imported on web. We provide a small platform file:

- `src/screens/MapScreen.web.tsx` → shows a friendly “Map not available on web” screen so `expo start --web` works.

If the web bundler still tries to import the native map screen, `RootTabs` uses a `Platform.OS === 'web'` conditional `require()` to ensure web always loads `MapScreen.web.tsx` without pulling in `react-native-maps`.

## Home + Search (Discover → Map)

### Decision

Search must feel **instant** and be robust; we avoid network geocoding on the critical path. The location label is **auto-detected from GPS** (no city prompt in the happy path).

### Implementation

- `src/screens/HomeScreen.tsx`
  - Gets location via `getUserLocationBestEffort()`
  - Reverse-geocodes to a city/region label via `expo-location`
  - Search bar sets `{ query, viewport }` in `SearchContext` and navigates to the Map tab for results

### Home/Search → Map plumbing

To make Home → Map feel instantaneous and reliable, we added two tiny shared mechanisms:

- `src/state/MapFocusContext.tsx` exposes `focusRestaurant({ id, name, lat, lng })`
- `MapScreen` listens for the latest focus request and animates the camera + opens the preview
- `src/state/SearchContext.tsx` stores the active search `{ query, viewport }` so Map can fetch filtered results and center the camera

## Map results: Map/List toggle + bottom-sheet list

### Decision

When arriving from Home search, the Map screen supports a **Map/List toggle**, where **List** is a bottom sheet over the map (Airbnb-like).

### Implementation

- `src/screens/MapScreen.tsx` and `src/screens/MapScreen.web.tsx`
  - Reads `SearchContext` and switches fetch behavior:
    - Normal browsing: `fetchRestaurantsInViewport(viewport)`
    - Search mode: `searchRestaurantsInArea(viewport, query)`
  - **Reverse geocoding**: Uses Mapbox Geocoding API to display city labels from coordinates (web version uses `reverseGeocode()` from `mapboxSearchService`).
  - **Performance**:
    - Map is **uncontrolled** during user gestures (no `region={...}`), which reduces rerenders/jank while panning.
    - Viewport updates are **debounced** and also **thresholded** (ignore tiny duplicate region events).
    - In-flight Overpass requests are **aborted** when the user pans/zooms again (“cancel while panning”).
    - Marker elements are memoized to avoid rebuilding pin elements when only viewport state changes.
  - Adds a bottom-center toggle `Map` / `List`
  - In `List` mode, renders a `BottomSheetFlatList` of restaurants; tapping an item focuses the map and opens the preview

## Settings (Haptics)

### Decision

Haptics are user-controllable (accessibility & preference).

### Implementation

- `src/state/SettingsContext.tsx` stores `hapticsEnabled`
- `src/lib/haptics.ts` respects the setting (no haptics when disabled)
- `src/screens/SettingsScreen.tsx` provides the toggle

## Map POI Source (Mapbox Search Box)

### Decision

We use **Mapbox Search Box** with `@mapbox/search-js-core` for better POI coverage in Mexico and session-based pricing. The implementation provides a custom autocomplete search component with Spanish language support.

### Why this approach

- **Better POI coverage**: Mapbox has superior restaurant data coverage in Mexico compared to OSM.
- **Session-based pricing**: 10,000 free sessions/month, billing per successful selection (not per keystroke).
- **Spanish language support**: Results in Spanish (e.g., "Ciudad de México" instead of "Mexico City") match user expectations.
- **Proximity biasing**: Uses user location to prioritize nearby results.
- **Self-healing data**: Automatically upgrades old records to Mapbox IDs for faster future lookups.

### Implementation

- **Service**: `src/services/mapboxSearchService.ts`
  - Initializes `MapboxSearch` with access token from `EXPO_PUBLIC_MAPBOX_TOKEN`.
  - `searchAutocomplete(query, options)`: Returns restaurant suggestions filtered to POI types in Mexico (`types: ['poi']`, `country: ['mx']`, `language: 'es'`).
  - `retrieveFeature(mapboxId)`: Retrieves full feature details including coordinates.
  - `reverseGeocode(lat, lng)`: Reverse geocodes coordinates to city/address labels using Mapbox Geocoding API.
  - `forwardGeocode(query)`: Forward geocodes city names to bounding boxes using Mapbox Geocoding API.
  - Uses proximity biasing from user location for better relevance.

- **Component**: `src/components/SearchHeader.tsx`
  - Custom autocomplete search bar with debounced input (300ms).
  - Displays suggestions list with restaurant name and neighborhood.
  - Handles selection: retrieves feature coordinates and triggers callback.
  - Loading states, empty states, and error handling.

- **Database**: `supabase/migrations/010_add_mapbox_id.sql`
  - Adds `mapbox_id` column to `dish_rankings` table (nullable, indexed).
  - Enables hybrid matching: exact match by `mapbox_id`, fallback to coordinate proximity.

- **Matching Strategy** (`src/services/mapService.ts`):
  1. **Primary**: Query `dish_rankings` by `mapbox_id` (exact match, instant).
  2. **Fallback with Self-Healing**: Query by coordinate proximity (within ~50m):
     - Finds matching `dish_rankings` records where `mapbox_id IS NULL`.
     - **Automatically updates** those records with the new `mapbox_id`.
     - Future searches for the same restaurant use exact match (faster).
  3. Functions:
     - `findRestaurantByMapboxId(mapboxId)`: Exact match lookup.
     - `findRestaurantByCoordinates(lat, lng, mapboxId, radius)`: Proximity matching with self-healing.
     - `updateDishRankingsWithMapboxId(osmIds, mapboxId)`: Updates old records.

- **Integration**:
  - `MapScreen.tsx` and `MapScreen.web.tsx`: Replaced TextInput search with `SearchHeader` component.
  - `HomeScreen.tsx`: Replaced search input with `SearchHeader` component.
  - `onMapboxSearchSelect`: Handles Mapbox feature selection, matches with Supabase, animates map, displays results.

### Legacy Support

- Functions (`searchRestaurantsInArea`, `fetchRestaurantsInViewport`) remain for backward compatibility and recommendation fetching.
- Old `dish_rankings` records have `mapbox_id = null` and are gradually upgraded via the self-healing mechanism.

### Environment

- `EXPO_PUBLIC_MAPBOX_TOKEN` is required for Mapbox Search functionality.
- Get your token from [Mapbox](https://account.mapbox.com/access-tokens/).

## Map POI Source (OpenStreetMap via Overpass) - Legacy

### Decision

**DEPRECATED**: Overpass API search has been replaced by Mapbox Search Box. This section is kept for reference.

We previously used **OpenStreetMap** queried via the **Overpass API**, called through a **Supabase Edge Function proxy**.

### Why this approach

- **$0 per-request API bill**: Overpass/OSM data is free (subject to public-instance fair-use limits).
- **Simple client**: the app keeps the same `fetchRestaurantsInViewport(viewport)` interface.
- **Safer + more reliable**: the Edge Function can add timeouts, basic caching, and evolve without an app update.

### Implementation

- **Edge Function**: `supabase/functions/overpass/`
  - Accepts a viewport bbox and amenity filters.
  - Supports optional `nameQuery` for efficient city-wide search.
  - Queries `amenity=restaurant|cafe|fast_food|bar|pub` and requires a `name`.
  - Uses `out center` so ways/relations have a single coordinate.
  - When `nameQuery` is present, it uses a bounded “city-scale” viewport and a **tokenized, loose name match** (more forgiving than exact-phrase search).
  - Returns a normalized list shaped like `RestaurantWithRanking[]` (with `top_dish_net_score: 0`) plus optional metadata when present in OSM tags:
    - `establishment_type` (amenity), `cuisine`, `opening_hours`, `phone`, `website`
    - structured `addr:*` parts (street, city, postcode, etc.)
  - `verify_jwt = false` for MVP so it can be called with the anon key.
- **Client**: `src/services/mapService.ts`
  - Uses a **direct fetch** to `.../functions/v1/overpass` when env vars are available so we can pass an `AbortSignal`.
  - Falls back to `supabase.functions.invoke('overpass', ...)` if env vars aren’t available (dev/test resilience).
  - Adds a small **client-side TTL cache + in-flight request de-dupe** to make panning and repeated searches feel instant.
  - Exposes `searchRestaurantsInArea(viewport, nameQuery)` for Map/Home search.
  - Returns `[]` on error to keep the map usable.

## Geocoding (City → Bounding box)

### Decision

We added a small Edge Function to resolve “current city” text into a bounding box, so Search can stay city-wide without a heavier backend.

### Implementation

- `supabase/functions/geocode/`
  - Uses Mapbox Geocoding API for forward geocoding (city name → bounding box)
  - Requires `MAPBOX_TOKEN` or `EXPO_PUBLIC_MAPBOX_TOKEN` environment variable
  - Proxies Mapbox search with short in-memory caching
  - Returns `{ bbox, displayName }` shaped for the app (`ViewportBounds`)
  - `verify_jwt = false` for MVP so it can be called with the anon key

### Map search UX

- `MapScreen` and `HomeScreen` use **Mapbox Search Box** (`SearchHeader` component) with autocomplete suggestions.
- When a text search is submitted, the search bar shows an inline **loading spinner**, and the app **automatically switches to List mode** and **pulls up the bottom sheet** (animated) to show a skeleton while results load, then the results list.
- An inline **X button** cancels the active search (clears `SearchContext`) and immediately restores the normal “all pins in viewport” mode.
- The Map header shows the **current city label** and a row of **cuisine/category chips** (fast food, seafood, italian, japanese, mexican, etc.) that instantly filter visible pins.

### Deploy / setup

- Ensure app env vars are set:
  - `EXPO_PUBLIC_SUPABASE_URL`
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- Deploy the edge function:
  - `supabase functions deploy geocode`

## Bug Fixes (Map & List toggle)

### Issues Identified (Round 1)

1. **List button not opening sheet**: Pressing "List" only set `viewMode` state, but didn't trigger the sheet to open/snap to the list position.
2. **Map button behavior**: Pressing "Map" didn't properly handle whether to show restaurant details or close the sheet.
3. **Location effect race condition**: The location effect had `isSearchMode` in its dependencies, causing it to re-run every time search mode changed, leading to unpredictable centering behavior.
4. **Sheet snap effect not reliable**: The effect to auto-open the sheet in list mode only triggered when `sheetIndex === -1`, missing cases where the sheet was already open.

### Fixes Applied (Round 1)

1. **List button**: Now explicitly calls `openSheetTo(1)` immediately when pressed.
2. **Map button**: Now either opens the sheet to restaurant detail (index 0) if a restaurant is selected, or closes the sheet entirely if none is selected.
3. **Location effect**: Changed to run only once on mount (empty `[]` dependencies) using a ref (`hasCenteredOnUserRef`) to track if we've already centered the map.
4. **Sheet snap effect**: Changed to use a `prevViewModeRef` to detect when we actually transition TO list mode, rather than checking the current sheet state.
5. **Haptic feedback**: Added `lightHaptic()` to both Map and List toggle buttons for better tactile feedback.

### Issues Identified (Round 2 - Map/Pins/List Deep Dive)

1. **Dead code in category filter**: `const base = id === 'all' ? allRestaurants : allRestaurants;` always returned the same value.
2. **Fetch errors silently swallowed**: Non-abort errors left `isLoading=true` forever, causing the UI to show skeleton indefinitely.
3. **"Open details" button unreliable**: Used `setSheetIndex(1)` directly instead of `openSheetTo(1)`, bypassing the imperative snap.
4. **Missing dependency in effect**: `openSheetTo` was missing from the effect dependency array for the fallback sheet-open logic.
5. **Unused state**: `isSearchingThisArea` was set but never read anywhere.
6. **Missing haptic feedback**: Category chips, filter chips, list rows, and tab bar had no haptic feedback.

### Fixes Applied (Round 2)

1. **Removed dead ternary**: Now filters `allRestaurants` directly using `selectedCuisineId`.
2. **Error handling**: Non-abort fetch errors now log to console in dev and still clear loading state.
3. **"Open details" button**: Now uses `openSheetTo(1)` for reliable sheet snapping.
4. **Added missing dependency**: `openSheetTo` added to the fallback effect's dependency array.
5. **Removed unused state**: Deleted `isSearchingThisArea` state and its setter calls.
6. **Added haptic feedback**:
   - Category chips in map header
   - Filter chips in filter sheet
   - List row presses (`onListPick`)
   - Tab bar navigation (`FloatingTabBar`)

## Dish Rankings (User-submitted ratings)

### Decision

Users can submit dish ratings for any restaurant shown on the map. Ratings are stored in Supabase and associated with the OSM restaurant ID (not a foreign key, since restaurants come from OpenStreetMap).

### Data Model

**Table: `dish_rankings`** (`supabase/migrations/005_dish_rankings.sql`)

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `user_id` | uuid | References `profiles(id)` |
| `osm_id` | text | OSM node/way ID (no FK) |
| `restaurant_name` | text | Denormalized for display |
| `dish_name` | text | Required |
| `price_cents` | int | Optional (stored in cents) |
| `ingredients` | text | Optional (comma-separated) |
| `score` | int | 0–10, required |
| `image_url` | text | Optional |
| `created_at` / `updated_at` | timestamptz | Auto-managed |

**RLS Policies:**
- **Select**: Public (anon + authenticated)
- **Insert**: Authenticated, owner-only (`auth.uid() = user_id`)
- **Update/Delete**: Authenticated, owner-only

### Implementation

- **Types**: `src/types/database.ts` → `DishRanking`, `DishRankingInput`
- **Service**: `src/services/dishRankingService.ts`
  - `submitDishRanking(input)` – inserts a new rating, requires auth
  - `getDishRankingsForRestaurant(osmId)` – fetches all ratings for a restaurant
- **Storage**: `src/services/storageService.ts`
  - `uploadDishPhoto(imageUri)` – uploads image to Supabase Storage, returns public URL
  - Images stored in `dish-photos` bucket, organized by user ID
  - Public bucket with RLS policies (authenticated upload, public read)
- **UI**: `src/screens/MapScreen.tsx`
  - "Rate a Dish" button in restaurant preview (bottom sheet)
  - Auth check: if not signed in, shows alert prompting sign-in
  - Dedicated full-height bottom sheet (92%) with proper keyboard handling
  - Fields: dish name, price, ingredients, score (0–10 picker), photo upload
  - Uses `BottomSheetTextInput` for proper keyboard-aware scrolling
  - Photo picker via `expo-image-picker` with preview and remove button
  - On submit: uploads image to storage (if provided), then inserts ranking with public URL
  - Error handling: if image upload fails, user can choose to submit without photo

### UX Flow

1. User taps a restaurant pin → bottom sheet opens with preview
2. User taps "Rate a Dish" button
3. If not authenticated → alert prompts sign-in
4. If authenticated → full-height rating sheet slides up
5. User fills in dish name (required), optional fields, selects score, optionally uploads photo
6. User taps "Submit Rating" → image uploads to Supabase Storage (if provided) → row inserted in `dish_rankings` with public image URL
7. Success alert → sheet closes and form resets

### Storage Setup

- **Bucket**: `dish-photos` (public, 5MB limit, images only)
- **Migration**: `supabase/migrations/006_storage_bucket.sql`
- **RLS Policies**:
  - Authenticated users can upload
  - Users can update/delete their own uploads (enforced by folder structure: `{user_id}/{filename}`)
  - Public read access

## Map Panning Loading Indicator & Performance Optimizations

### Decision

Added a subtle loading indicator when fetching new data while panning the map, and optimized the fetch logic to avoid redundant network calls and UI flicker.

### Implementation

- **New state**: `isFetchingData` tracks when an active viewport data fetch is in progress
- **Loading indicator**: A "Loading..." pill with spinner appears above the FAB (locate button) during data fetches
- **Smart skip logic**: Before setting `isFetchingData=true`, we check if the viewport key matches the last fetched viewport; if so, we skip showing the loader (cache hit expected, no flicker)
- **Ref tracking**: `lastFetchedViewportRef` stores the stable viewport key of the last successful fetch

### Performance optimizations

1. **Viewport key deduplication**: Each viewport is converted to a stable string key (rounded to 4 decimals). Repeated fetches for the same viewport skip the loading indicator.
2. **Request cancellation**: In-flight requests are aborted immediately when the user pans/zooms again, keeping the map responsive.
3. **Debounce threshold**: 350ms debounce on viewport changes prevents excessive API calls during continuous panning.
4. **Region change thresholding**: The `onRegionChangeComplete` callback ignores tiny movements (<0.0012 degrees or <6-8% span change) to avoid state churn.
5. **Client-side cache (mapService)**: 75-second TTL cache with LRU eviction (60 entries max) ensures revisited areas are instant.
6. **In-flight de-dupe (mapService)**: Concurrent requests for the same viewport share a single promise.
7. **Memoized markers**: `markerElements` is memoized so pin elements aren't rebuilt when only unrelated state changes.

## Bug Fixes (Map Panning & Category Selection)

### Issues Identified

1. **Sheet not closing when category changes**: When the user changed cuisine category in map mode with a restaurant selected, the sheet remained open showing "Pick a restaurant" instead of closing cleanly.
2. **`Property 'id' doesn't exist` error**: During rapid panning or when data was malformed, accessing `.id` on undefined entries could crash the app.
3. **Race condition with panning + category changes**: The loading state wasn't properly synchronized when categories were changed while data was being fetched.
4. **Marker memoization not handling null cases**: The `React.memo` comparison function could throw if restaurant data was unexpectedly null.

### Fixes Applied

1. **Sheet closes on category change (map mode)**:
   - Added `prevSelectedCuisineIdRef` to track actual category changes (avoiding false triggers).
   - The effect now checks if the category actually changed before taking action.
   - In map mode with sheet open, the sheet now closes imperatively (`sheetRef.current?.close()`).
   - In list mode, the sheet stays open to show filtered results.

2. **Defensive filtering throughout**:
   - `restaurants` memo: Added guard `if (!r || typeof r !== 'object' || typeof r.id !== 'string') return false` to skip malformed entries.
   - `markerElements` memo: Added `.filter()` before `.map()` to ensure only valid restaurants with `id`, `lat`, `lng` are rendered.
   - FlatList `keyExtractor`: Now uses fallback `r?.id ?? \`fallback-${index}\`` to prevent crashes.
   - FlatList `renderItem`: Added null guard that returns `null` for malformed items.

3. **StarDishMarker memoization hardened**:
   - The `React.memo` comparison function now checks `if (!prev.restaurant || !next.restaurant) return false` to force re-render on unexpected nulls.

### Technical Details

The category change effect now has proper dependencies:
```javascript
useEffect(() => {
  if (prevSelectedCuisineIdRef.current === selectedCuisineId) return;
  prevSelectedCuisineIdRef.current = selectedCuisineId;
  // Clear selection and close sheet in map mode
  setSelectedRestaurantId(null);
  setSelectedRestaurantNameHint(null);
  if (viewMode === 'map' && sheetIndex !== -1) {
    setSheetIndex(-1);
    sheetRef.current?.close();
  }
}, [selectedCuisineId, sheetIndex, viewMode]);
```

The ref-based change detection ensures the effect only acts when the category actually changes, not when other dependencies change.

## Search-First Architecture & Recommendations

### Decision

Star Dish uses a **search-first architecture** inspired by Google Maps. Users search for specific restaurants they're at or planning to visit, rather than browsing all nearby places. The app emphasizes search with supporting features: recently viewed restaurants, top picks, and best-rated sections.

### Why this approach

- **Focused user intent**: Users typically know which restaurant they're at or want to visit, not browsing randomly.
- **Reduced API calls**: Only fetch data when user searches, not on every pan/zoom.
- **Better performance**: No automatic viewport fetching means faster initial load and smoother interactions.
- **Personalized experience**: Recommendations based on user history and ratings.

### User Flow

1. **User opens app** → Empty map with search prompt OR recently viewed restaurants
2. **User searches** → "What restaurant are you at?" → Search results appear: pins on map + list panel
3. **User selects restaurant** → Map flies to location (animated, 400ms) → Bottom sheet opens with restaurant details → Top dishes displayed
4. **User can view recommendations** → Recently viewed, top picks, best rated sections

### Implementation

- **No viewport-based fetching**: Map shows no pins by default (or only recommendations).
- **Search is primary**: Users must search to see restaurants on the map.
- **Recommendations**: Recently viewed, top picks, and best-rated sections guide users.
- **Hybrid view**: Map + always-visible list panel (Airbnb-style) showing search results or recommendations.
- **Smooth animations**: Map fly-to (400ms), sheet transitions, pin animations with haptic feedback.

### Database Schema

**Table: `user_restaurant_views`** (`supabase/migrations/009_user_restaurant_history.sql`)

Tracks user's recently viewed restaurants for personalized recommendations.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `user_id` | uuid | References `profiles(id)` |
| `osm_id` | text | OSM node/way ID |
| `restaurant_name` | text | Denormalized for display |
| `viewed_at` | timestamptz | Last view timestamp |
| `view_count` | int | Number of times viewed |

**Functions:**
- `upsert_restaurant_view(user_id, osm_id, restaurant_name)` - Tracks restaurant view
- `get_recently_viewed_restaurants(user_id, limit)` - Gets user's recently viewed
- `get_top_picks(limit)` - Gets highest rated restaurants (min 3 reviews)
- `get_best_rated(limit)` - Gets best rated restaurants (avg score >= 7.0, min 2 reviews)

### Services

- **`src/services/recommendationService.ts`**
  - `trackRestaurantView(osmId, restaurantName)` - Tracks when user views a restaurant
  - `getRecentlyViewedRestaurants(limit)` - Gets user's recently viewed
  - `getTopPicks(limit)` - Gets top picks
  - `getBestRated(limit)` - Gets best rated
  - `fetchRestaurantsForRecommendations(recommendations, viewport)` - Fetches full restaurant data for recommendations

### Components

- **`src/components/RecommendationsList.tsx`** - Displays recently viewed, top picks, and best rated sections
- **`src/components/SearchResultsList.tsx`** - Displays search results with animations

### Caching Strategy

- **Client-side cache**: 25 entries max, 10min TTL (minimal, just for recent searches)
- **Server-side cache**: 7-day TTL (POI data changes infrequently)
- **No AsyncStorage**: Removed persistent cache for simplicity and performance
- **Request deduplication**: In-flight requests are deduplicated to prevent redundant calls

### Animations & Haptics

- **Map fly-to**: 400ms smooth animation when selecting restaurant
- **Pin appearance**: Fade-in animation for pins
- **Sheet transitions**: Native bottom sheet animation
- **List items**: Staggered fade-in for search results (50ms delay between items)
- **Haptic feedback**: Light haptic on search submit, restaurant select, sheet interactions, recommendation taps

