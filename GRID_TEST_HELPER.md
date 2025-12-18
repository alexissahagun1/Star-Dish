# Quick Grid Testing Helper

## Browser Console Testing

You can test the grid system directly in the browser console (web version) or React Native debugger:

### Test Grid Key Generation

```javascript
// Import the grid utility (web version)
// Or use the functions directly from the module

// Test different zoom levels
const testCases = [
  { lat: 20.724, lng: -103.447, zoom: 10, expectedGrid: '20.700:-103.400:z10' },
  { lat: 20.724, lng: -103.447, zoom: 13, expectedGrid: '20.725:-103.450:z13' },
  { lat: 20.724, lng: -103.447, zoom: 16, expectedGrid: '20.724:-103.447:z16' },
];

testCases.forEach(({ lat, lng, zoom, expectedGrid }) => {
  // This would need to be imported, but shows the test logic
  console.log(`Zoom ${zoom}: Expected grid key: ${expectedGrid}`);
});
```

## Manual Test Checklist

### ✅ Test 1: Zoom Level Adaptation
- [ ] Open app at zoom 10, check console shows `z10` grid key
- [ ] Zoom to 13, check console shows `z13` grid key  
- [ ] Zoom to 16, check console shows `z16` grid key
- [ ] Verify grid sizes match: 20km, 5km, 1km respectively

### ✅ Test 2: Cache Sharing
- [ ] User A: Open at (20.724, -103.447), zoom 13
- [ ] Check console: `CACHE MISS` (first request)
- [ ] User B: Open at (20.726, -103.451), zoom 13 (same grid cell)
- [ ] Check console: `CACHE HIT` (should be instant)

### ✅ Test 3: Buffer Expansion
- [ ] Position at grid edge
- [ ] Check console: `bufferRadius` value
- [ ] Verify pins appear even at edge
- [ ] Check query viewport is larger than user viewport

### ✅ Test 4: Zoom 10 Coverage
- [ ] Zoom out to level 10
- [ ] Verify pins cover entire visible area
- [ ] No empty borders or small populated square

### ✅ Test 5: Persistent Cache
- [ ] First launch: Note API call time
- [ ] Close app completely
- [ ] Reopen at same location
- [ ] Check: `PERSISTENT CACHE HIT` in logs
- [ ] Response should be instant (< 50ms)

## Expected Console Output

### First Request (Cache Miss)
```
[GRID] Cache key created: {
  input: { lat: "20.7240", lng: "-103.4470", zoom: 13 },
  grid: { gridLat: "20.725", gridLng: "-103.450", gridSize: "0.050", keyZoom: 13 },
  output: { key: "20.725:-103.450:z13", bufferRadius: 3885 }
}
[GRID] fetchRestaurantsInViewport: { viewport: {...}, cacheKey: "20.725:-103.450:z13" }
[GRID] Edge Function: CACHE MISS for key: 20.725:-103.450:z13, fetching with buffer: 3885m
[PERF] invokeOverpass: Network fetch took 3000ms...
```

### Second Request (Cache Hit)
```
[GRID] fetchRestaurantsInViewport: { viewport: {...}, cacheKey: "20.725:-103.450:z13" }
[GRID] Edge Function: CACHE HIT for key: 20.725:-103.450:z13
[PERF] fetchRestaurantsInViewport: MEMORY CACHE HIT in 0.50ms (total: 0.52ms)
```

## Troubleshooting

**No grid logs appearing?**
- Check `__DEV__` is true
- Check console filter isn't hiding logs

**Grid keys don't match?**
- Verify zoom calculation is correct
- Check coordinate rounding matches (3 decimals)

**Cache not sharing?**
- Verify both users are in same grid cell
- Check grid key format matches exactly
- Ensure same zoom level bucket (z10, z13, or z16)
