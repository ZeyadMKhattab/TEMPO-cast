const nodemailer = require("nodemailer");

/**
 * Returns the AQI category details based on the AQI value.
 * @param {number} aqi - The Air Quality Index value.
 * @returns {{level: string, color: string, emoji: string}}
 */
function getAQICategoryForNotification(aqi) {
  if (aqi >= 301) return { level: "Hazardous", color: "#7e0023", emoji: "☠️" };
  if (aqi >= 201) return { level: "Very Unhealthy", color: "#8f3f97", emoji: "⚠️" };
  if (aqi >= 151) return { level: "Unhealthy", color: "#ff0000", emoji: "⚠️" };
  if (aqi >= 101) return { level: "Unhealthy for Sensitive Groups", color: "#ff7e00", emoji: "⚡" };
  if (aqi >= 51) return { level: "Moderate", color: "#ffff00", emoji: "ℹ️" };
  return { level: "Good", color: "#00e400", emoji: "✅" };
}

/**
 * Generates personalized health advice based on user profile, AQI, and pollutant components.
 * @param {object} healthProfile - The subscriber's health profile.
 * @param {number} aqi - The current Air Quality Index.
 * @param {object} components - The pollutant components.
 * @returns {string[]} An array of advice strings.
 */
function getPersonalizedHealthAdvice(healthProfile, aqi, components) {
  const advice = [];
  if (!healthProfile) return advice;

  const conditions = healthProfile.conditions || [];

  if (conditions.includes("asthma") || conditions.includes("copd")) {
    if (aqi >= 101) {
      advice.push("⚠️ IMPORTANT: Stay indoors and avoid all outdoor activity");
      advice.push("💊 Keep your rescue inhaler accessible");
    } else if (aqi >= 51) {
      advice.push("⚠️ Limit outdoor activities and watch for symptoms");
    }
  }
  if (conditions.includes("heart")) {
    if (aqi >= 101) advice.push("❤️ Avoid strenuous activities - increased cardiovascular risk");
  }
  if (healthProfile.ageGroup === "child" && aqi >= 101) advice.push("👶 Keep children indoors - their lungs are still developing");
  if (healthProfile.ageGroup === "senior" && aqi >= 101) advice.push("👴 Seniors: Stay indoors and monitor health closely");
  if (healthProfile.pregnant && aqi >= 101) advice.push("🤰 Pregnant: Avoid outdoor exposure to protect your baby");
  if (healthProfile.outdoorWorker && aqi >= 101) advice.push("👷 Work outdoors? Wear N95 mask and take frequent breaks");
  if (healthProfile.athlete) {
    if (aqi >= 101) advice.push("🏃 Cancel outdoor exercise - move workout indoors");
    else if (aqi >= 51) advice.push("🏃 Reduce exercise intensity outdoors");
  }
  if (components.pm2_5 > 55.5) {
    advice.push("😷 Wear N95/KN95 mask if going outside");
    advice.push("🏠 Use air purifier indoors");
  }
  // O3 ppb conversion: (μg/m³) / 1.96
  if (components.o3 / 1.96 > 125) advice.push("☀️ Avoid outdoor activities during peak sun hours (10am-4pm)");
  if (aqi >= 151) {
    advice.push("🚪 Close windows and doors");
    advice.push("💧 Stay well hydrated");
    advice.push("📞 Contact doctor if experiencing symptoms");
  }
  return advice;
}

/**
 * Sends an air quality notification email to a subscriber.
 * @param {object} subscriber - The subscriber object.
 * @param {number} aqi - The current AQI.
 * @param {object} aqiCategory - The AQI category object from getAQICategoryForNotification.
 * @param {string[]} healthAdvice - An array of personalized health advice strings.
 * @returns {Promise<boolean>} True if the email was sent successfully, false otherwise.
 */
async function sendEmailNotification(subscriber, aqi, aqiCategory, healthAdvice) {
  const emailHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: white; padding: 30px; border: 1px solid #e5e7eb; }
        .aqi-badge { display: inline-block; padding: 15px 30px; background: ${aqiCategory.color}; color: black; font-size: 24px; font-weight: bold; border-radius: 8px; margin: 20px 0; }
        .advice { background: #f9fafb; padding: 15px; border-left: 4px solid ${aqiCategory.color}; margin: 15px 0; }
        .advice ul { margin: 10px 0; padding-left: 20px; }
        .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        .button { display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 6px; margin: 15px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>${aqiCategory.emoji} Air Quality Alert</h1>
          <p>Personalized notification for ${subscriber.locations?.home || "your location"}</p>
        </div>
        <div class="content">
          <h2>Current Air Quality: AQI ${aqi}</h2>
          <div class="aqi-badge" style="background-color: ${aqiCategory.color}; color: ${aqi > 150 ? "white" : "black"};">${aqiCategory.level}</div>
          <div class="advice">
            <h3>Your Personalized Health Recommendations:</h3>
            <ul>${healthAdvice.map((advice) => `<li>${advice}</li>`).join("")}</ul>
          </div>
          <p><strong>What does this mean for you?</strong></p>
          <p>Based on your health profile (${(subscriber.healthProfile?.conditions || []).join(", ") || "no specific conditions"}${subscriber.healthProfile?.ageGroup ? `, ${subscriber.healthProfile.ageGroup}` : ""}), current air quality conditions may affect your health.</p>
          <a href="https://globaltempo.netlify.app/app?lat=${subscriber.locations?.home || ""}" class="button">View Detailed Forecast →</a>
          <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
          <p style="font-size: 14px; color: #6b7280;">
            <strong>Stay Updated:</strong> We'll continue monitoring air quality in your area and send you updates based on your preferences (${subscriber.frequency} notifications).
          </p>
        </div>
        <div class="footer">
          <p>Global TEMPO Air Quality Monitoring</p>
          <p>Powered by NASA TEMPO Satellite Data</p>
          <p><a href="https://globaltempo.netlify.app/unsubscribe/${subscriber._id}" style="color: #6b7280;">Unsubscribe</a></p>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      console.error("[Email] Error: EMAIL_USER and EMAIL_PASSWORD must be set in .env file.");
      return false;
    }
    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || "gmail",
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD },
    });
    await transporter.sendMail({
      from: '"Global TEMPO Alerts" <alerts@globaltempo.com>',
      to: subscriber.email,
      subject: `${aqiCategory.emoji} Air Quality Alert - AQI ${aqi}`,
      html: emailHTML,
    });
    console.log(`[Email] Notification sent successfully to ${subscriber.email}`);
    return true;
  } catch (error) {
    console.error(`[Email] Failed to send notification to ${subscriber.email}:`, error);
    return false;
  }
}

module.exports = {
  getAQICategoryForNotification,
  getPersonalizedHealthAdvice,
  sendEmailNotification,
};