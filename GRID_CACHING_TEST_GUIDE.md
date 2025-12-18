# Adaptive Grid-Based Caching - Testing Guide

## Overview

This guide explains how to test the adaptive grid-based caching system to verify:
1. Adaptive grids work at different zoom levels
2. Cache sharing between users in the same grid cell
3. Buffer expansion ensures edge users see nearby pins
4. Performance improvements from caching

## Test Setup

### 1. Enable Debug Logging

Debug logging is automatically enabled in development mode (`__DEV__`). You'll see logs like:

```
[GRID] Cache key created: { input: {...}, grid: {...}, output: {...} }
[GRID] fetchRestaurantsInViewport: { viewport: {...}, cacheKey: "..." }
[GRID] Edge Function cache check: { viewport: {...}, gridKey: "...", bufferRadius: ... }
```

### 2. Clear Cache Before Testing

**Client-side cache:**
- Close and restart the app (clears memory cache)
- Or clear AsyncStorage manually in dev tools

**Server-side cache:**
- Restart the Edge Function (clears in-memory cache)
- Or wait 24 hours for cache to expire

## Test Scenarios

### Test 1: Zoom Level Grid Adaptation

**Purpose:** Verify different zoom levels use appropriate grid sizes.

**Steps:**
1. Open the app at a known location (e.g., Zapopan, Jalisco)
2. Check console logs for grid key format
3. Test at different zoom levels:

**Expected Results:**

| Zoom Level | Grid Size | Grid Key Format | Visible Area |
|------------|-----------|----------------|--------------|
| 10 (city) | 20km | `20.700:-103.400:z10` | ~40km × 40km |
| 13 (neighborhood) | 5km | `20.725:-103.450:z13` | ~5km × 5km |
| 16 (street) | 1km | `20.724:-103.447:z16` | ~1km × 1km |

**Verification:**
- Check console logs show correct `keyZoom` (10, 13, or 16)
- Check `gridSize` matches expected value
- Verify pins cover entire visible area at zoom 10 (not just center)

### Test 2: Cache Sharing Between Users

**Purpose:** Verify users in the same grid cell share cache.

**Steps:**
1. **User A (First Request):**
   - Open app at location (20.724, -103.447) at zoom 13
   - Check console: `[GRID] Edge Function: CACHE MISS`
   - Note the API call time (3-6 seconds)
   - Note the grid key (e.g., `20.725:-103.450:z13`)

2. **User B (Same Grid Cell):**
   - Open app at nearby location (20.726, -103.451) at zoom 13
   - Should hit same grid cell: `20.725:-103.450:z13`
   - Check console: `[GRID] Edge Function: CACHE HIT`
   - Response should be instant (< 50ms)

**Expected Results:**
- User B sees `CACHE HIT` in logs
- User B gets data instantly (no API call)
- Both users see same restaurants (from cache)

### Test 3: Buffer Expansion for Edge Users

**Purpose:** Verify edge users see nearby pins due to buffer expansion.

**Steps:**
1. Position at grid boundary:
   - Grid cell center: (20.725, -103.450)
   - Position user at edge: (20.727, -103.448) - near grid boundary
   
2. Check console logs:
   - Note `bufferRadius` value (should be ~3.9km for 5km grid)
   - Note expanded query viewport bounds

3. Verify pins appear:
   - Pins should appear even if user is at grid edge
   - Pins slightly outside viewport should be visible (buffer working)

**Expected Results:**
- `bufferRadius` is 40% larger than grid size
- Query viewport is larger than user's viewport
- Pins visible even at grid boundaries

### Test 4: Zoom 10 Full Coverage

**Purpose:** Verify zoom 10 (city view) shows full coverage, not just center.

**Steps:**
1. Zoom out to level 10 (city view)
2. Check console: Grid key should be `z10` with 20km grid
3. Verify pins appear across entire visible area
4. Pan the map - pins should remain visible

**Expected Results:**
- Grid key shows `z10`
- Pins cover entire ~40km × 40km visible area
- No empty borders or "small populated square"

### Test 5: Client-Side Persistent Cache

**Purpose:** Verify client-side cache persists across app restarts.

**Steps:**
1. **First Launch:**
   - Open app, wait for restaurants to load
   - Check console: `[PERF] fetchRestaurantsInViewport: ...`
   - Note API call time

2. **Close and Restart App:**
   - Close app completely
   - Reopen app at same location
   - Check console: `[PERF] fetchRestaurantsInViewport: PERSISTENT CACHE HIT`

**Expected Results:**
- Second launch shows `PERSISTENT CACHE HIT`
- Response time < 50ms (instant)
- No API call on second launch

### Test 6: Grid Key Consistency

**Purpose:** Verify client and server use same grid keys.

**Steps:**
1. Check client logs: `[GRID] fetchRestaurantsInViewport: { cacheKey: "..." }`
2. Check server logs: `[GRID] Edge Function cache check: { gridKey: "..." }`
3. Compare the grid keys

**Expected Results:**
- Client grid key matches server grid key
- Format: `lat:lng:z{zoom}` (e.g., `20.725:-103.450:z13`)

## Performance Metrics to Monitor

### Cache Hit Rate
- **Target:** > 80% for popular areas
- **Measure:** Count `CACHE HIT` vs `CACHE MISS` in logs

### Response Times
- **Cache Hit:** < 50ms (instant)
- **Cache Miss:** 3-6 seconds (API call)
- **Persistent Cache:** < 50ms (instant)

### API Call Reduction
- **Before:** Every user request → API call
- **After:** First user in grid → API call, others → cache hit
- **Expected:** 80-90% reduction in API calls

## Debugging Tips

### Check Grid Key Generation
```typescript
// In console, you can manually test:
import { createGridCacheKey, calculateZoomFromViewport } from './src/utils/grid';

const viewport = {
  northEastLat: 20.75,
  southWestLat: 20.70,
  northEastLng: -103.43,
  southWestLng: -103.45,
};

const zoom = calculateZoomFromViewport(viewport);
const centerLat = (20.75 + 20.70) / 2;
const centerLng = (-103.43 + -103.45) / 2;

const { key, bufferRadius } = createGridCacheKey(centerLat, centerLng, zoom);
console.log('Grid key:', key, 'Buffer:', bufferRadius, 'm');
```

### Verify Buffer Expansion
Check that query viewport is larger than user viewport:
- User viewport: Check `[GRID] fetchRestaurantsInViewport` logs
- Query viewport: Check Edge Function logs (expanded bounds)
- Buffer should add ~40% to each side

### Common Issues

**Issue:** Pins only in center at zoom 10
- **Cause:** Grid size too small for zoom level
- **Fix:** Verify grid key shows `z10` (20km grid)

**Issue:** Users don't share cache
- **Cause:** Grid keys don't match
- **Fix:** Check both users are in same grid cell (same grid key)

**Issue:** Edge users don't see nearby pins
- **Cause:** Buffer not applied correctly
- **Fix:** Check `bufferRadius` value and expanded viewport bounds

## Automated Testing (Future)

For automated testing, consider:
1. Unit tests for `createGridCacheKey()` with different zoom levels
2. Integration tests for cache sharing between requests
3. Performance tests to measure cache hit rates
4. E2E tests to verify pins appear at all zoom levels

## Success Criteria

✅ **Zoom 10:** Full city coverage, no empty borders  
✅ **Zoom 13-15:** Neighborhood coverage, appropriate grid size  
✅ **Zoom 16+:** Street-level precision, small grid cells  
✅ **Cache Sharing:** Users in same grid cell share cache  
✅ **Edge Coverage:** Buffer ensures nearby pins visible  
✅ **Performance:** Cache hits are instant (< 50ms)  
✅ **Consistency:** Client and server use same grid keys  
