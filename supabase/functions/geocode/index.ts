const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// This file runs on Supabase Edge Functions (Deno runtime). Some editors/linters don't include Deno types,
// so we declare the minimal surface we use to avoid TypeScript errors during local linting.
declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get: (key: string) => string | undefined;
  };
};

type ViewportBounds = {
  northEastLat: number;
  northEastLng: number;
  southWestLat: number;
  southWestLng: number;
};

type GeocodeRequestBody = {
  q: string;
};

// Best-effort in-memory cache (per Edge Function instance).
const cache = new Map<string, { expiresAt: number; payload: unknown }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=600",
    },
  });
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function normalizeBbox(bounds: [number, number, number, number]): ViewportBounds {
  // Mapbox bbox: [minLng, minLat, maxLng, maxLat]
  const minLng = clamp(bounds[0], -180, 180);
  const maxLng = clamp(bounds[2], -180, 180);
  const minLat = clamp(bounds[1], -90, 90);
  const maxLat = clamp(bounds[3], -90, 90);

  return {
    southWestLat: Math.min(minLat, maxLat),
    northEastLat: Math.max(minLat, maxLat),
    southWestLng: Math.min(minLng, maxLng),
    northEastLng: Math.max(minLng, maxLng),
  };
}

async function fetchMapbox(query: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    // Get Mapbox token from environment variable
    const mapboxToken = Deno.env.get("MAPBOX_TOKEN") || Deno.env.get("EXPO_PUBLIC_MAPBOX_TOKEN");
    if (!mapboxToken) {
      throw new Error("MAPBOX_TOKEN environment variable is not set");
    }

    // Mapbox Geocoding API forward endpoint: https://api.mapbox.com/geocoding/v5/{endpoint}/{search_text}.json
    const encodedQuery = encodeURIComponent(query.trim());
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodedQuery}.json?access_token=${mapboxToken}&language=es&types=place,locality&limit=1`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Mapbox geocode error ${res.status}: ${text.slice(0, 200)}`);
    }

    return (await res.json()) as unknown;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const name = e instanceof Error ? (e as { name?: string }).name : undefined;
    if (name === "AbortError" || msg.toLowerCase().includes("aborted") || msg.toLowerCase().includes("abort")) {
      throw new Error("Geocoding timed out. Please try again.");
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = (await req.json()) as Partial<GeocodeRequestBody>;
    const q = typeof body.q === "string" ? body.q.trim() : "";
    if (!q) return json({ error: "Missing q" }, 400);

    const cacheKey = q.toLowerCase().slice(0, 120);
    const cached = cache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return json({ data: cached.payload, cached: true });
    }

    const raw = await fetchMapbox(q);
    const data = raw as { features?: Array<Record<string, unknown>> };
    
    if (!data.features || data.features.length === 0) {
      return json({ error: "No results" }, 200);
    }

    const feature = data.features[0];
    const displayName = typeof feature.place_name === "string" 
      ? feature.place_name 
      : (typeof feature.text === "string" ? feature.text : q);
    
    // Mapbox bbox format: [minLng, minLat, maxLng, maxLat]
    const bboxRaw = feature.bbox;
    let bbox: ViewportBounds | null = null;
    
    if (Array.isArray(bboxRaw) && bboxRaw.length === 4) {
      const [minLng, minLat, maxLng, maxLat] = bboxRaw.map((n) => Number(n));
      if ([minLng, minLat, maxLng, maxLat].every((n) => Number.isFinite(n))) {
        bbox = {
          southWestLat: minLat,
          northEastLat: maxLat,
          southWestLng: minLng,
          northEastLng: maxLng,
        };
      }
    }

    // Fallback: If no bbox, try to create one from geometry coordinates
    if (!bbox) {
      const geometry = feature.geometry as { coordinates?: [number, number] } | undefined;
      if (geometry?.coordinates && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) {
        const [lng, lat] = geometry.coordinates;
        // Create a small bounding box around the point
        const delta = 0.1;
        bbox = {
          southWestLat: lat - delta,
          northEastLat: lat + delta,
          southWestLng: lng - delta,
          northEastLng: lng + delta,
        };
      }
    }

    if (!bbox) return json({ error: "No bounding box available" }, 200);

    const payload = { bbox, displayName };
    cache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, payload });

    return json({ data: payload, cached: false });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return json({ error: message }, 200);
  }
});




