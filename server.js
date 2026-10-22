const express = require("express");
const axios = require("axios");
const NodeCache = require("node-cache");
const serverless = require("serverless-http");
const mongoose = require("mongoose");
const dns = require("node:dns");
require("dotenv").config();
const compression = require("compression");
const basicAuth = require("express-basic-auth");
const path = require("path");
const rateLimit = require("express-rate-limit");
const cron = require("node-cron");

const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 }); // 5 minute cache

require("./models/subscriber");
const gemsRoutes = require("./routes/gems");
const notificationRoutes = require("./routes/notifications");
const adminRoutes = require("./routes/admin");
const contactRoute = require("./routes/contact");
const {
  getAQICategoryForNotification,
  getPersonalizedHealthAdvice,
  sendEmailNotification,
} = require("./utils/notifications");
const app = express();

const PORT = process.env.PORT || 3000;
const IS_SERVERLESS =
  process.env.NETLIFY === "true" ||
  Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
let connectionPromise;

const configuredMongoDnsServers =
  process.env.MONGODB_DNS_SERVERS || process.env.MONGODB_DNS_SERVER;

if (!IS_SERVERLESS && configuredMongoDnsServers) {
  const dnsServers = configuredMongoDnsServers
    .split(",")
    .map((server) => server.trim())
    .filter(Boolean);
  if (dnsServers.length > 0) {
    dns.setServers(dnsServers);
    console.log(`Using configured DNS servers for MongoDB: ${dnsServers.join(", ")}`);
  }
}

const openWeatherApi = axios.create({
  baseURL: "http://api.openweathermap.org/data/2.5",
  params: {
    appid: process.env.OPENWEATHER_API_KEY,
  },
});

app.set("trust proxy", 1);

const connectToDB = () => {
  if (mongoose.connection.readyState === 1) {
    return Promise.resolve();
  }
  if (connectionPromise && mongoose.connection.readyState === 2) {
    return connectionPromise;
  }

  const mongoUri =
    process.env.MONGODB_URI ||
    (IS_SERVERLESS ? null : "mongodb://localhost:27017/tempo");
  if (!mongoUri) {
    return Promise.reject(
      new Error("MONGODB_URI must be configured for Netlify deployments."),
    );
  }

  console.log("Attempting to connect to MongoDB...");
  connectionPromise = mongoose
    .connect(mongoUri, {
      serverApi: {
        version: "1",
        strict: true,
        deprecationErrors: true,
      },
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      tlsAllowInvalidCertificates: false,
    })
    .then(() => {
      console.log("✅ MongoDB connected successfully.");
    })
    .catch((error) => {
      connectionPromise = null;
      throw error;
    });

  return connectionPromise;
};

if (!IS_SERVERLESS) {
  connectToDB().catch((error) => {
    console.error(
      "❌ MongoDB connection error; database-backed routes will return 503:",
      error,
    );
  });
}

const requireDatabase = async (_req, res, next) => {
  try {
    await connectToDB();
    next();
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    res.status(503).json({ error: "Database is currently unavailable." });
  }
};

const adminUsers = {
  [process.env.ADMIN_USER || "admin"]:
    process.env.ADMIN_PASSWORD || "supersecretpassword",
};

const adminAuth = basicAuth({
  users: adminUsers,
  challenge: true,
  realm: "AdminArea",
});

app.use(compression());

app.use(express.json());
const router = express.Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests from this IP, please try again later.",
});

if (process.env.NODE_ENV === "production") {
  router.use(limiter);
}

router.use("/gems", gemsRoutes.router);
router.use("/notifications", requireDatabase, notificationRoutes());
router.use("/contact", contactRoute);
app.use("/admin", adminAuth, requireDatabase, adminRoutes); // Secure all admin routes
app.use("/api", router);

app.use(express.static("public", { maxAge: "1h", etag: true }));

app.get("/favicon.ico", (req, res) => res.status(204).send());

const getCacheKey = (lat, lon, endpoint) => `${endpoint}_${lat}_${lon}`;

const cacheMiddleware = (endpoint) => {
  return (req, res, next) => {
    const { lat, lon } = req.query;
    if (!lat || !lon) return next();

    const cacheKey = getCacheKey(lat, lon, endpoint);
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
      console.log(`Cache hit for ${endpoint}: ${cacheKey}`);
      return res.json(cachedData);
    }

    const originalJson = res.json;

    res.json = function (data) {
      cache.set(cacheKey, data);
      console.log(`Cached data for ${endpoint}: ${cacheKey}`);
      originalJson.call(this, data);
    };

    next();
  };
};

router.get("/complete", cacheMiddleware("complete"), async (req, res) => {
  const { lat, lon, days } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ error: "Missing lat/lon" });
  }

  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);

  try {
    const daysBack = Math.min(parseInt(days) || 7, 30);
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - daysBack * 24 * 60 * 60;

    // Check if location is in satellite coverage areas
    const isInTempoCoverage =
      lonNum >= -130 && lonNum <= -60 && latNum >= 20 && latNum <= 60;
    const isInGemsCoverage =
      lonNum >= 48 && lonNum <= 168 && latNum >= -34 && latNum <= 58;

    // Prepare satellite data requests
    const satelliteRequests = [];
    if (isInTempoCoverage) {
      satelliteRequests.push(fetchTempoDataForLocation(lonNum, latNum));
    }
    if (isInGemsCoverage) {
      satelliteRequests.push(fetchGemsDataForLocation(lonNum, latNum));
    }

    const [
      currentRes,
      forecastRes,
      weatherRes,
      historicalRes,
      airQualityRes,
      ...satelliteResults
    ] = await Promise.allSettled([
      openWeatherApi.get(`/air_pollution`, {
        params: { lat, lon },
        timeout: 5000,
      }),
      openWeatherApi.get(`/air_pollution/forecast`, {
        params: { lat, lon },
        timeout: 8000,
      }),
      openWeatherApi.get(`/weather`, {
        params: { lat, lon, units: "metric" },
        timeout: 5000,
      }),
      openWeatherApi.get(`/air_pollution/history`, {
        params: { lat, lon, start: startTime, end: endTime },
        timeout: 10000,
      }),
      axios
        .get(`https://api.openaq.org/v3/locations`, {
          headers: { "X-API-Key": process.env.OPENAQ_API_KEY },
          params: { coordinates: `${lat},${lon}`, radius: 25000, limit: 1 },
          timeout: 8000,
        })
        .catch(() => null), // Non-blocking failure
      ...satelliteRequests,
    ]);

    // Check essential requests
    const essentialFailed = [currentRes, weatherRes].some(
      (result) => result.status === "rejected",
    );
    if (essentialFailed) {
      throw new Error("Failed to fetch essential data");
    }

    // Get air quality data (non-blocking)
    let airQualityData = null;
    if (airQualityRes.status === "fulfilled" && airQualityRes.value) {
      airQualityData = airQualityRes.value.data.results?.[0] || null;
    }

    // Process satellite data
    const satelliteData = {};
    satelliteResults.forEach((result, index) => {
      if (result.status === "fulfilled" && result.value) {
        const data = result.value;
        if (data.source === "tempo") {
          satelliteData.tempo = data;
        } else if (data.source === "gems") {
          satelliteData.gems = data;
        }
      }
    });

    // Combine current pollution with weather
    const combinedCurrent = {
      ...currentRes.value.data,
      weather: weatherRes.value.data,
    };

    // Enhance with satellite data if available
    if (satelliteData.tempo || satelliteData.gems) {
      combinedCurrent.satelliteData = satelliteData;
      combinedCurrent.dataSource = satelliteData.tempo
        ? "TEMPO + Ground"
        : satelliteData.gems
          ? "GEMS + Ground"
          : "Ground-based";
    } else {
      combinedCurrent.dataSource = "Ground-based";
    }

    res.json({
      location: weatherRes.value.data.name,
      current: combinedCurrent,
      forecast:
        forecastRes.status === "fulfilled"
          ? {
              coord: forecastRes.value.data.coord,
              list: forecastRes.value.data.list,
            }
          : null,
      historical:
        historicalRes.status === "fulfilled"
          ? {
              coord: historicalRes.value.data.coord,
              list: historicalRes.value.data.list,
              period: { start: startTime, end: endTime, days: daysBack },
            }
          : null,
      airQuality: airQualityData,
      satelliteCoverage: {
        tempo: isInTempoCoverage,
        gems: isInGemsCoverage,
        satelliteData: Object.keys(satelliteData).length > 0,
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error("Complete API Error:", err.message);
    res.status(500).json({ error: "Failed to fetch complete data" });
  }
});

// Function to get GEMS data for a specific location
async function fetchGemsDataForLocation(lon, lat) {
  try {
    return {
      source: "gems",
      coverage: true,
      note: "GEMS satellite data available via map visualization layers",
      layers: {
        no2: "/api/gems/no2/image",
        o3: "/api/gems/o3/image",
        hcho: "/api/gems/hcho/image",
      },
      lastUpdated: new Date().toISOString(),
    };
  } catch (error) {
    console.error("GEMS data fetch error:", error);
    return null;
  }
}

// Function to get TEMPO data for a specific location
async function fetchTempoDataForLocation(lon, lat) {
  try {
    // TEMPO provides Esri image services
    // We'll indicate that TEMPO data is available via map layers
    return {
      source: "tempo",
      coverage: true,
      note: "TEMPO satellite data available via map visualization layers",
      layers: {
        no2: "https://gis.earthdata.nasa.gov/image/rest/services/C3685896708-LARC_CLOUD/TEMPO_NO2_L3_V04_HOURLY_TROPOSPHERIC_VERTICAL_COLUMN/ImageServer",
        o3: "https://gis.earthdata.nasa.gov/image/rest/services/C3685896625-LARC_CLOUD/TEMPO_O3TOT_L3_V04_HOURLY_OZONE_COLUMN_AMOUNT/ImageServer",
        hcho: "https://gis.earthdata.nasa.gov/image/rest/services/C3685897141-LARC_CLOUD/TEMPO_HCHO_L3_V04_HOURLY_VERTICAL_COLUMN/ImageServer",
      },
      lastUpdated: new Date().toISOString(),
    };
  } catch (error) {
    console.error("TEMPO data fetch error:", error);
    return null;
  }
}
router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    cache: {
      keys: cache.keys().length,
      stats: cache.getStats(),
    },
    gems: {
      cachedLayers: gemsRoutes.gemsImageCache.keys(),
      cacheStats: gemsRoutes.gemsImageCache.getStats(),
    },
  });
});

router.get("/cache-stats", (req, res) => {
  res.json({
    weather: cache.getStats(),
    gems: gemsRoutes.gemsImageCache.getStats(),
  });
});

const AQI_BREAKPOINTS = {
  pm2_5: [
    { cLow: 0.0, cHigh: 12.0, iLow: 0, iHigh: 50 },
    { cLow: 12.1, cHigh: 35.4, iLow: 51, iHigh: 100 },
    { cLow: 35.5, cHigh: 55.4, iLow: 101, iHigh: 150 },
    { cLow: 55.5, cHigh: 150.4, iLow: 151, iHigh: 200 },
    { cLow: 150.5, cHigh: 250.4, iLow: 201, iHigh: 300 },
    { cLow: 250.5, cHigh: 350.4, iLow: 301, iHigh: 400 },
    { cLow: 350.5, cHigh: 500.4, iLow: 401, iHigh: 500 },
  ],
  pm10: [
    { cLow: 0, cHigh: 54, iLow: 0, iHigh: 50 },
    { cLow: 55, cHigh: 154, iLow: 51, iHigh: 100 },
    { cLow: 155, cHigh: 254, iLow: 101, iHigh: 150 },
    { cLow: 255, cHigh: 354, iLow: 151, iHigh: 200 },
    { cLow: 355, cHigh: 424, iLow: 201, iHigh: 300 },
    { cLow: 425, cHigh: 504, iLow: 301, iHigh: 400 },
    { cLow: 505, cHigh: 604, iLow: 401, iHigh: 500 },
  ],
  o3_8hr: [
    { cLow: 0, cHigh: 54, iLow: 0, iHigh: 50 },
    { cLow: 55, cHigh: 70, iLow: 51, iHigh: 100 },
    { cLow: 71, cHigh: 85, iLow: 101, iHigh: 150 },
    { cLow: 86, cHigh: 105, iLow: 151, iHigh: 200 },
    { cLow: 106, cHigh: 200, iLow: 201, iHigh: 300 },
  ],
  o3_1hr: [
    { cLow: 125, cHigh: 164, iLow: 101, iHigh: 150 },
    { cLow: 165, cHigh: 204, iLow: 151, iHigh: 200 },
    { cLow: 205, cHigh: 404, iLow: 201, iHigh: 300 },
    { cLow: 405, cHigh: 504, iLow: 301, iHigh: 400 },
    { cLow: 505, cHigh: 604, iLow: 401, iHigh: 500 },
  ],
  co: [
    { cLow: 0.0, cHigh: 4.4, iLow: 0, iHigh: 50 },
    { cLow: 4.5, cHigh: 9.4, iLow: 51, iHigh: 100 },
    { cLow: 9.5, cHigh: 12.4, iLow: 101, iHigh: 150 },
    { cLow: 12.5, cHigh: 15.4, iLow: 151, iHigh: 200 },
    { cLow: 15.5, cHigh: 30.4, iLow: 201, iHigh: 300 },
    { cLow: 30.5, cHigh: 40.4, iLow: 301, iHigh: 400 },
    { cLow: 40.5, cHigh: 50.4, iLow: 401, iHigh: 500 },
  ],
  so2: [
    { cLow: 0, cHigh: 35, iLow: 0, iHigh: 50 },
    { cLow: 36, cHigh: 75, iLow: 51, iHigh: 100 },
    { cLow: 76, cHigh: 185, iLow: 101, iHigh: 150 },
    { cLow: 186, cHigh: 304, iLow: 151, iHigh: 200 },
    { cLow: 305, cHigh: 604, iLow: 201, iHigh: 300 },
    { cLow: 605, cHigh: 804, iLow: 301, iHigh: 400 },
    { cLow: 805, cHigh: 1004, iLow: 401, iHigh: 500 },
  ],
  no2: [
    { cLow: 0, cHigh: 53, iLow: 0, iHigh: 50 },
    { cLow: 54, cHigh: 100, iLow: 51, iHigh: 100 },
    { cLow: 101, cHigh: 360, iLow: 101, iHigh: 150 },
    { cLow: 361, cHigh: 649, iLow: 151, iHigh: 200 },
    { cLow: 650, cHigh: 1249, iLow: 201, iHigh: 300 },
    { cLow: 1250, cHigh: 1649, iLow: 301, iHigh: 400 },
    { cLow: 1650, cHigh: 2049, iLow: 401, iHigh: 500 },
  ],
};

const POLLUTANT_CONVERSION_FACTORS = {
  o3: 1.96, // μg/m³ to ppb
  co: 1145, // μg/m³ to ppm
  so2: 2.62, // μg/m³ to ppb
  no2: 1.88, // μg/m³ to ppb
};

function calculateIndividualAQI(concentration, pollutant) {
  if (concentration < 0) return 0;

  const breakpoints = AQI_BREAKPOINTS[pollutant];
  if (!breakpoints) return 0;

  let breakpoint = breakpoints.find(
    (bp) => concentration >= bp.cLow && concentration <= bp.cHigh,
  );

  if (!breakpoint) {
    if (concentration > breakpoints[breakpoints.length - 1].cHigh) {
      breakpoint = breakpoints[breakpoints.length - 1];
    } else {
      return 0;
    }
  }

  const aqi =
    ((breakpoint.iHigh - breakpoint.iLow) /
      (breakpoint.cHigh - breakpoint.cLow)) *
      (concentration - breakpoint.cLow) +
    breakpoint.iLow;

  return Math.round(aqi);
}

function calculateOverallAQI(components) {
  const individualAQIs = {};

  // PM2.5 (μg/m³) - direct use
  if (components.pm2_5) {
    individualAQIs.pm2_5 = calculateIndividualAQI(components.pm2_5, "pm2_5");
  }

  // PM10 (μg/m³) - direct use
  if (components.pm10) {
    individualAQIs.pm10 = calculateIndividualAQI(components.pm10, "pm10");
  }

  // O3 (μg/m³) - convert to ppb (μg/m³ / 1.96 ≈ ppb for O3)
  if (components.o3) {
    const o3_ppb = components.o3 / POLLUTANT_CONVERSION_FACTORS.o3;
    individualAQIs.o3 = calculateIndividualAQI(o3_ppb, "o3_8hr");
  }

  // CO (μg/m³) - convert to ppm (μg/m³ / 1145 ≈ ppm for CO)
  if (components.co) {
    const co_ppm = components.co / POLLUTANT_CONVERSION_FACTORS.co;
    individualAQIs.co = calculateIndividualAQI(co_ppm, "co");
  }

  // SO2 (μg/m³) - convert to ppb (μg/m³ / 2.62 ≈ ppb for SO2)
  if (components.so2) {
    const so2_ppb = components.so2 / POLLUTANT_CONVERSION_FACTORS.so2;
    individualAQIs.so2 = calculateIndividualAQI(so2_ppb, "so2");
  }

  // NO2 (μg/m³) - convert to ppb (μg/m³ / 1.88 ≈ ppb for NO2)
  if (components.no2) {
    const no2_ppb = components.no2 / POLLUTANT_CONVERSION_FACTORS.no2;
    individualAQIs.no2 = calculateIndividualAQI(no2_ppb, "no2");
  }

  const aqiValues = Object.values(individualAQIs).filter((val) => val > 0);
  return { overall: aqiValues.length > 0 ? Math.max(...aqiValues) : 0 };
}

// Check air quality and send notifications (scheduled job)
async function checkAndNotifySubscribers() {
  const Subscriber = mongoose.model("Subscriber");
  const subscribers = await Subscriber.find({ active: true });
  console.log(
    `[Notifications] Checking AQ for ${subscribers.length} active subscribers`,
  );
  if (subscribers.length === 0) return;

  const BATCH_SIZE = 50; // Process 50 subscribers in parallel to avoid API rate limits
  for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
    const batch = subscribers.slice(i, i + BATCH_SIZE);
    console.log(`[Notifications] Processing batch ${i / BATCH_SIZE + 1}...`);

    const promises = batch.map(async (subscriber) => {
      try {
        const coords = parseLocationCoordinates(subscriber.locations.home);
        if (!coords) {
          console.log(
            `[Notifications] Skipping ${subscriber.email}: invalid coordinates.`,
          );
          return;
        }

        const aqResponse = await axios.get(
          `http://api.openweathermap.org/data/2.5/air_pollution`,
          {
            params: {
              lat: coords.lat,
              lon: coords.lon,
              appid: process.env.OPENWEATHER_API_KEY,
            },
            timeout: 5000,
          },
        );

        const pollution = aqResponse.data.list[0];
        const components = pollution.components;
        const aqi = calculateOverallAQI(components).overall;

        if (shouldNotify(subscriber, aqi)) {
          await sendNotification(subscriber, aqi, components);
          subscriber.lastNotified = new Date();
          await subscriber.save();
        }
      } catch (error) {
        console.error(
          `[Notifications] Error processing AQ for ${subscriber.email}:`,
          error.message,
        );
      }
    });

    // Execute all promises in the batch in parallel
    await Promise.allSettled(promises);

    // Optional: Add a small delay between batches if needed to respect strict rate limits
    if (i + BATCH_SIZE < subscribers.length) {
      console.log("[Notifications] Waiting before next batch...");
      await new Promise((resolve) => setTimeout(resolve, 2000)); // 2-second delay
    }
  }
  console.log("[Notifications] Finished checking all subscribers.");
}

function shouldNotify(subscriber, currentAQI) {
  const thresholds = {
    sensitive: 51, // Corresponds to AQI > 50
    standard: 101, // Corresponds to AQI > 100
    high: 151, // Corresponds to AQI > 150
  };

  const threshold = thresholds[subscriber.threshold] || thresholds.standard;

  if (currentAQI < threshold) return false;

  if (!subscriber.lastNotified) return true;

  const lastNotifiedTime = new Date(subscriber.lastNotified).getTime();
  const now = Date.now();
  const hoursSinceLastNotification =
    (now - lastNotifiedTime) / (1000 * 60 * 60);

  const frequencyHours = {
    realtime: 1,
    hourly: 1,
    daily: 24,
    weekly: 168,
  };

  const requiredHours = frequencyHours[subscriber.frequency] || 24;

  return hoursSinceLastNotification >= requiredHours;
}

function parseLocationCoordinates(location) {
  if (!location) return null;

  const coordMatch = location.match(/(-?\d+\.?\d*),\s*(-?\d+\.?\d*)/);
  if (coordMatch) {
    return {
      lat: parseFloat(coordMatch[1]),
      lon: parseFloat(coordMatch[2]),
    };
  }

  return null;
}

// Send notification to subscriber
async function sendNotification(subscriber, aqi, components) {
  const aqiCategory = getAQICategoryForNotification(aqi);
  const healthAdvice = getPersonalizedHealthAdvice(
    subscriber.healthProfile,
    aqi,
    components,
  );

  console.log(
    `[Notifications] Sending alert to ${subscriber.email} - AQI: ${aqi}`,
  );

  // Only send email notifications
  await sendEmailNotification(subscriber, aqi, aqiCategory, healthAdvice);

  // The subscriber.notificationMethods.email check is now implicit
}

if (!IS_SERVERLESS) {
  cron.schedule(
    "0 * * * *",
    () => {
      console.log("[Notifications] Running scheduled check...");
      checkAndNotifySubscribers().catch(console.error);
    },
    {
      scheduled: true,
      timezone: "UTC",
    },
  );
}

app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

module.exports.checkAndNotifySubscribers = checkAndNotifySubscribers;
module.exports.calculateOverallAQI = calculateOverallAQI;
module.exports.connectToDB = connectToDB;

module.exports.handler = serverless(app);

if (!IS_SERVERLESS) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}
