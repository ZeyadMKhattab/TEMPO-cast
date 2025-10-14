const express = require("express");
const NodeCache = require("node-cache");
const path = require("node:path");

const router = express.Router();

// --- GEMS Image Service Integration ---
const GEMS_API_KEY = process.env.OPEN_API_GEMS;
const GEMS_IMAGE_BOUNDS = [
  [-34, 48],
  [58, 168],
];

const gemsImageCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 }); // 1 hour cache
const gemsTimestampCache = new NodeCache({ stdTTL: 600, checkperiod: 120 }); // 10 minute cache for timestamps

const GEMS_LAYERS = {
  o3: {
    baseUrl: "https://nesc.nier.go.kr:38032/api/GK2/L2/O3T/FOR/image",
  },
  hcho: {
    baseUrl: "https://nesc.nier.go.kr:38032/api/GK2/L2/HCHO/FOR/image",
  },
  no2: {
    baseUrl: "https://nesc.nier.go.kr:38032/api/GK2/L2/NO2_Trop/FOR/image",
  },
};

async function fetchLatestGemsTimestamp(baseUrl) {
  const cachedTimestamp = gemsTimestampCache.get(baseUrl);
  if (cachedTimestamp) {
    console.log(`[GEMS] Using cached timestamp: ${cachedTimestamp}`);
    return cachedTimestamp;
  }

  const now = new Date();
  const end = now.toISOString().slice(0, 16).replace(/[-T:]/g, "");
  now.setHours(now.getHours() - 24);
  const start = now.toISOString().slice(0, 16).replace(/[-T:]/g, "");

  const url = `${baseUrl}/getFileDateList.do?sDate=${start}&eDate=${end}&format=json&key=${GEMS_API_KEY}`;
  console.log(`[GEMS] Fetching timestamp from: ${baseUrl}/getFileDateList.do`);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[GEMS] Timestamp API error response:`, text.substring(0, 200));
      throw new Error(`GEMS API returned status: ${response.status}`);
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.list) || data.list.length === 0) {
      console.error(`[GEMS] Invalid data structure:`, JSON.stringify(data).substring(0, 200));
      throw new Error(`GEMS API returned no data.`);
    }

    const timestamps = data.list.map((item) => item.item);
    const latestTimestamp = timestamps.sort().pop();
    gemsTimestampCache.set(baseUrl, latestTimestamp);
    return latestTimestamp;
  } catch (error) {
    console.error(`[GEMS] fetchLatestGemsTimestamp failed:`, error);
    throw error;
  }
}

async function fetchGemsImage(layerName) {
  const layer = GEMS_LAYERS[layerName];
  if (!layer) throw new Error(`Unknown GEMS layer: `);

  const cachedImage = gemsImageCache.get(layerName);
  if (cachedImage) {
    console.log(`[GEMS-${layerName.toUpperCase()}] Using cached image`);
    return cachedImage;
  }

  console.log(`[GEMS-${layerName.toUpperCase()}] Fetching fresh image...`);

  try {
    const timestamp = await fetchLatestGemsTimestamp(layer.baseUrl);
    const imageUrl = `${layer.baseUrl}/getFileItem.do?date=${timestamp}&key=${GEMS_API_KEY}`;
    console.log(`[GEMS-${layerName.toUpperCase()}] Fetching from: ${layer.baseUrl}/getFileItem.do`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const response = await fetch(imageUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) throw new Error(`Download failed with status ${response.status}`);

    const imageBuffer = Buffer.from(await response.arrayBuffer());
    if (imageBuffer.length < 100) throw new Error(`Image too small (${imageBuffer.length} bytes) - likely not a valid image`);

    gemsImageCache.set(layerName, imageBuffer);
    console.log(`[GEMS-${layerName.toUpperCase()}] Image cached successfully`);
    return imageBuffer;
  } catch (error) {
    if (error.name === "AbortError") {
      console.error(`[GEMS-${layerName.toUpperCase()}] Fetch timeout after 25s`);
      throw new Error("GEMS API request timed out");
    }
    console.error(`[GEMS-${layerName.toUpperCase()}] Fetch failed:`, error.message);
    throw error;
  }
}

// GEMS image endpoint - fetch on demand
router.get("/:layer/image", async (req, res) => {
  const layerName = req.params.layer;
  if (!GEMS_LAYERS[layerName]) return res.status(404).json({ error: "Unknown GEMS layer" });

  try {
    const imageBuffer = await fetchGemsImage(layerName);
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=3600");
    res.set("Content-Length", imageBuffer.length);
    res.send(imageBuffer);
  } catch (error) {
    res.status(503).json({
      error: "Failed to fetch GEMS image",
      message: error.message,
      layer: layerName,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

// Debug endpoint to test GEMS API connectivity
router.get("/:layer/debug", async (req, res) => {
  const layerName = req.params.layer;
  const layer = GEMS_LAYERS[layerName];
  if (!layer) return res.status(404).json({ error: "Unknown GEMS layer" });

  const debugInfo = {
    layer: layerName,
    baseUrl: layer.baseUrl,
    apiKey: GEMS_API_KEY ? `${GEMS_API_KEY.substring(0, 10)}...` : "NOT SET",
    cached: gemsImageCache.has(layerName),
    cacheStats: gemsImageCache.getStats(),
    steps: [],
  };

  try {
    debugInfo.steps.push({ step: 1, action: "Fetching timestamp list..." });
    const now = new Date();
    const end = now.toISOString().slice(0, 16).replace(/[-T:]/g, "");
    now.setHours(now.getHours() - 24);
    const start = now.toISOString().slice(0, 16).replace(/[-T:]/g, "");
    const listUrl = `${layer.baseUrl}/getFileDateList.do?sDate=${start}&eDate=${end}&format=json&key=${GEMS_API_KEY}`;
    debugInfo.listUrl = listUrl;

    const listResponse = await fetch(listUrl);
    debugInfo.steps.push({ step: 1, status: listResponse.status, ok: listResponse.ok });
    if (!listResponse.ok) throw new Error(`Timestamp API returned ${listResponse.status}`);

    const listData = await listResponse.json();
    debugInfo.steps.push({ step: 1, result: "success", dataReceived: listData.list?.length || 0 });
    if (!listData.list || listData.list.length === 0) throw new Error("No timestamps available");

    const timestamp = listData.list.map((item) => item.item).sort().pop();
    debugInfo.timestamp = timestamp;
    debugInfo.steps.push({ step: 2, action: "Latest timestamp", value: timestamp });

    const imageUrl = `${layer.baseUrl}/getFileItem.do?date=${timestamp}&key=${GEMS_API_KEY}`;
    debugInfo.imageUrl = imageUrl;
    debugInfo.steps.push({ step: 3, action: "Fetching image..." });

    const imageResponse = await fetch(imageUrl);
    debugInfo.steps.push({
      step: 3,
      status: imageResponse.status,
      ok: imageResponse.ok,
      contentType: imageResponse.headers.get("content-type"),
      contentLength: imageResponse.headers.get("content-length"),
    });

    if (imageResponse.ok) {
      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
      debugInfo.steps.push({ step: 3, result: "success", imageSize: imageBuffer.length });
      debugInfo.success = true;
    } else {
      debugInfo.success = false;
      debugInfo.error = `Image fetch returned ${imageResponse.status}`;
    }
    res.json(debugInfo);
  } catch (error) {
    debugInfo.success = false;
    debugInfo.error = error.message;
    debugInfo.errorStack = process.env.NODE_ENV === "development" ? error.stack : undefined;
    res.status(500).json(debugInfo);
  }
});

// GEMS bounds endpoint
router.get("/:layer/bounds", async (req, res) => {
  const layerName = req.params.layer;
  if (!GEMS_LAYERS[layerName]) return res.status(404).json({ error: "Unknown GEMS layer" });
  res.json({
    bounds: GEMS_IMAGE_BOUNDS,
    layer: layerName,
    cached: gemsImageCache.has(layerName),
  });
});

module.exports = { router, gemsImageCache };