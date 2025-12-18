# Star Dish

A React Native mobile app built with Expo that helps users discover and rate the best dishes at restaurants. Star Dish uses a search-first architecture inspired by Google Maps, allowing users to find restaurants, view top-rated dishes, and submit their own ratings.

## Features

- **Search-First Discovery**: Search for restaurants using Mapbox Search Box with autocomplete
- **Interactive Map**: View restaurants on an interactive map with smooth animations
- **Dish Ratings**: Rate dishes with scores (0-10), photos, prices, and ingredients
- **Personalized Recommendations**: 
  - Recently viewed restaurants
  - Top picks (highest rated with minimum reviews)
  - Best rated dishes
- **User Profiles**: Track your ratings and restaurant history
- **Voting System**: Vote on dishes to help surface the best options
- **Real-time Updates**: See votes and ratings update in real-time
- **Haptic Feedback**: Light haptics on key interactions for better UX
- **Cross-Platform**: Works on iOS, Android, and Web

## Tech Stack

- **Framework**: React Native with Expo (~54.0.29)
- **Navigation**: React Navigation (Bottom Tabs)
- **Maps**: 
  - Native: `react-native-maps` (iOS/Android)
  - Web: `react-map-gl` with Mapbox GL
- **Backend**: Supabase (PostgreSQL, Authentication, Storage, Edge Functions)
- **Search**: Mapbox Search Box API
- **UI Components**: 
  - `@gorhom/bottom-sheet` for bottom sheets
  - Custom floating tab bar
  - Custom UI components (SDButton, SDText, etc.)
- **State Management**: React Context API
- **Location**: `expo-location` and `react-native-geolocation-service`
- **Image Handling**: `expo-image-picker` for dish photos
- **Haptics**: `expo-haptics` for tactile feedback

## Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn
- Expo CLI (`npm install -g expo-cli`)
- Supabase account and project
- Mapbox account and access token

## Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd star-dish
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Create a `.env` file in the root directory (or use Expo's environment variable system):
   ```env
   EXPO_PUBLIC_SUPABASE_URL=your_supabase_project_url
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   EXPO_PUBLIC_MAPBOX_TOKEN=your_mapbox_access_token
   ```

   **Important Notes**:
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY` must be the **Project API key labeled `anon`** (a JWT, often starting with `eyJ...`)
   - Do NOT use a publishable key (`sb_publishable_*`) as it will cause 401 errors with Edge Functions
   - Get your Mapbox token from [Mapbox Access Tokens](https://account.mapbox.com/access-tokens/)

4. **Set up Supabase**
   
   - Create a Supabase project at [supabase.com](https://supabase.com)
   - Run migrations from the `supabase/migrations/` directory:
     ```bash
     supabase db push
     ```
   - Or apply migrations manually in the Supabase SQL Editor
   - Configure Authentication:
     - Enable Email provider
     - (Recommended for dev) Disable email confirmations
   - Set up Storage bucket:
     - Create `dish-photos` bucket (public, 5MB limit, images only)

5. **Deploy Supabase Edge Functions** (optional, for geocoding)
   ```bash
   supabase functions deploy geocode
   ```

## Development

### Start the development server
```bash
npm start
```

### Run on specific platforms
```bash
npm run ios      # iOS simulator
npm run android  # Android emulator
npm run web      # Web browser
```

### Project Structure

```
star-dish/
├── src/
│   ├── components/      # Reusable UI components
│   ├── hooks/          # Custom React hooks
│   ├── lib/            # Utilities (supabase, location, haptics)
│   ├── navigation/     # Navigation components
│   ├── screens/        # Screen components
│   ├── services/       # Business logic services
│   ├── state/          # Context providers
│   ├── theme/          # Design tokens (colors, typography, spacing)
│   ├── types/          # TypeScript type definitions
│   └── utils/          # Helper functions
├── supabase/
│   ├── functions/      # Edge Functions
│   └── migrations/     # Database migrations
├── assets/             # Images and static assets
└── App.tsx             # Root component
```

## Key Features Explained

### Search-First Architecture

Star Dish uses a search-first approach where users search for specific restaurants rather than browsing all nearby places. This:
- Reduces API calls
- Improves performance
- Provides a more focused user experience
- Enables personalized recommendations

### Map Integration

- **Native (iOS/Android)**: Uses `react-native-maps` for native map performance
- **Web**: Uses `react-map-gl` with Mapbox GL for web compatibility
- **Platform Detection**: Automatically loads the correct map implementation

### Dish Ratings System

Users can:
- Submit dish ratings (0-10 scale)
- Add photos, prices, and ingredients
- View top-rated dishes at each restaurant
- Vote on dishes to help surface the best options

### Recommendations

The app provides three types of recommendations:
1. **Recently Viewed**: Restaurants you've recently checked out
2. **Top Picks**: Highest rated restaurants (minimum 3 reviews)
3. **Best Rated**: Restaurants with average score ≥ 7.0 (minimum 2 reviews)

## Performance Optimizations

- **Request Cancellation**: Aborts in-flight requests when user pans/zooms
- **Client-Side Caching**: 75-second TTL cache with LRU eviction
- **Request Deduplication**: Prevents redundant API calls
- **Debounced Queries**: 350ms debounce on viewport changes
- **Memoized Components**: React.memo for markers and lists
- **Lazy Loading**: Code splitting for web map implementation

## Authentication

- **Method**: Email + Password (no magic links)
- **Session Persistence**: Uses AsyncStorage to persist sessions across app reloads
- **No Redirect URLs Required**: Works reliably in Expo Go, LAN, or tunnel

## Database Schema

Key tables:
- `profiles`: User profiles
- `dish_rankings`: User-submitted dish ratings
- `votes`: User votes on dishes
- `user_restaurant_views`: Tracks recently viewed restaurants

All tables use Row Level Security (RLS) for access control.

## Contributing

1. Create a feature branch
2. Make your changes
3. Test on iOS, Android, and Web
4. Submit a pull request

## License

Private project

## Documentation

For detailed implementation decisions and architecture notes, see [DOCUMENTATION.md](./DOCUMENTATION.md).

## Support

For issues or questions, please open an issue in the repository.
