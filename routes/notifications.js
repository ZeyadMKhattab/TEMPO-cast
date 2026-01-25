const express = require("express");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const {
  getAQICategoryForNotification,
  getPersonalizedHealthAdvice,
  sendEmailNotification,
} = require("../utils/notifications");

module.exports = () => {
  const router = express.Router();
  const Subscriber = mongoose.model("Subscriber");

  // Helper function to calculate sensitivity level
  function calculateSensitivityLevel(healthProfile) {
    if (!healthProfile) return "low";
    let score = 0;
    if (
      healthProfile.ageGroup &&
      (healthProfile.ageGroup === "child" || healthProfile.ageGroup === "senior")
    )
      score += 2;
    if (Array.isArray(healthProfile.conditions)) {
      const highRiskConditions = ["asthma", "copd", "heart"];
      healthProfile.conditions.forEach((condition) => {
        score += highRiskConditions.includes(condition) ? 3 : 1;
      });
    }
    if (healthProfile.pregnant) score += 2;
    if (healthProfile.outdoorWorker) score += 1;
    if (healthProfile.athlete) score += 1;
    if (score >= 5) return "high";
    if (score >= 2) return "moderate";
    return "low";
  }

  async function sendWelcomeEmail(subscriber) {
    const emailHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: white; padding: 30px; border: 1px solid #e5e7eb; }
        .advice { background: #f9fafb; padding: 15px; border-left: 4px solid #667eea; margin: 15px 0; }
        .advice ul { margin: 10px 0; padding-left: 20px; }
        .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        .button { display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 6px; margin: 15px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🎉 Welcome to Global TEMPO Alerts!</h1>
          <p>You're now subscribed to personalized air quality notifications.</p>
        </div>
        <div class="content">
          <h2>Hello ${subscriber.email},</h2>
          <p>Thank you for subscribing! We're excited to help you stay informed about the air you breathe.</p>
          <div class="advice">
            <h3>What to expect:</h3>
            <ul>
              <li>Alerts when the air quality in your monitored locations reaches the threshold you set.</li>
              <li>Notifications according to your chosen frequency (${subscriber.frequency}).</li>
              <li>Personalized health tips based on your profile.</li>
            </ul>
          </div>
          <a href="https://globaltempo.netlify.app/app" class="button">Explore the App</a>
          <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
          <p style="font-size: 14px; color: #6b7280;">You can manage your preferences at any time.</p>
        </div>
        <div class="footer">
          <p>Global TEMPO Air Quality Monitoring</p>
          <p><a href="https://globaltempo.netlify.app/unsubscribe/${subscriber._id}" style="color: #6b7280;">Unsubscribe</a></p>
        </div>
      </div>
    </body>
    </html>
  `;

    try {
      if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
        console.error(
          "[Email] Welcome Email Error: EMAIL_USER and EMAIL_PASSWORD must be set."
        );
        return;
      }
      const transporter = nodemailer.createTransport({
        service: process.env.EMAIL_SERVICE || "gmail",
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD },
      });
      await transporter.sendMail({
        from: '"Global TEMPO Alerts" <alerts@globaltempo.com>',
        to: subscriber.email,
        subject: "🎉 Welcome to Global TEMPO Air Quality Alerts!",
        html: emailHTML,
      });
      console.log(
        `[Email] Welcome email sent successfully to ${subscriber.email}`
      );
    } catch (error) {
      console.error(
        `[Email] Failed to send welcome email to ${subscriber.email}:`,
        error
      );
    }
  }

  router.post("/subscribe", async (req, res) => {
    try {
      const {
        email,
        phone,
        notificationMethods,
        frequency,
        healthProfile,
        threshold,
        locations,
      } = req.body;
      if (!email || !email.includes("@"))
        return res.status(400).json({ error: "Valid email is required" });

      let subscriber = await Subscriber.findOne({ email });
      const isNewSubscriber = !subscriber;

      if (subscriber) {
        subscriber.set({
          phone,
          notificationMethods,
          frequency,
          healthProfile,
          threshold,
          locations,
          active: true,
        });
      } else {
        subscriber = new Subscriber({
          email,
          phone,
          notificationMethods,
          frequency,
          healthProfile,
          threshold,
          locations,
        });
      }

      if (subscriber.healthProfile) {
        subscriber.sensitivityLevel = calculateSensitivityLevel(
          subscriber.healthProfile
        );
      }

      await subscriber.save();

      if (isNewSubscriber) {
        await sendWelcomeEmail(subscriber);
      }

      res.json({
        success: true,
        subscriberId: subscriber._id,
        message: "Successfully subscribed to air quality notifications",
        subscriber: {
          email: subscriber.email,
          frequency: subscriber.frequency,
          sensitivityLevel: subscriber.sensitivityLevel,
        },
      });
    } catch (error) {
      console.error("[Notifications] Subscription error:", error);
      res.status(500).json({ error: "Failed to subscribe to notifications" });
    }
  });

  router.put("/update/:subscriberId", async (req, res) => {
    try {
      const { subscriberId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(subscriberId))
        return res.status(404).json({ error: "Subscriber not found" });

      const subscriber = await Subscriber.findById(subscriberId);
      if (!subscriber)
        return res.status(404).json({ error: "Subscriber not found" });

      const allowedUpdates = [
        "notificationMethods",
        "frequency",
        "healthProfile",
        "threshold",
        "locations",
        "phone",
      ];
      allowedUpdates.forEach((field) => {
        if (req.body[field] !== undefined) subscriber[field] = req.body[field];
      });

      subscriber.sensitivityLevel = calculateSensitivityLevel(
        subscriber.healthProfile
      );
      await subscriber.save();

      res.json({
        success: true,
        message: "Preferences updated successfully",
        subscriber: {
          email: subscriber.email,
          frequency: subscriber.frequency,
          sensitivityLevel: subscriber.sensitivityLevel,
        },
      });
    } catch (error) {
      if (error.code === 11000)
        return res
          .status(409)
          .json({ error: "This email address is already subscribed." });
      console.error("[Notifications] Update error:", error);
      res.status(500).json({ error: "Failed to update preferences" });
    }
  });

  router.delete("/unsubscribe/:subscriberId", async (req, res) => {
    try {
      const { subscriberId } = req.params;
      const subscriber = await Subscriber.findByIdAndUpdate(
        subscriberId,
        { active: false, unsubscribedAt: new Date() },
        { new: true }
      );
      if (!subscriber)
        return res.status(404).json({ error: "Subscriber not found" });
      res.json({
        success: true,
        message: "Successfully unsubscribed from notifications",
      });
    } catch (error) {
      console.error("[Notifications] Unsubscribe error:", error);
      res.status(500).json({ error: "Failed to unsubscribe" });
    }
  });

  router.post("/resubscribe/:subscriberId", async (req, res) => {
    try {
      const { subscriberId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(subscriberId))
        return res.status(400).json({ error: "Invalid subscriber ID format" });

      const subscriber = await Subscriber.findByIdAndUpdate(
        subscriberId,
        { active: true },
        { new: true }
      );
      if (!subscriber)
        return res.status(404).json({ error: "Subscriber not found" });

      res.json({
        success: true,
        message: "Successfully resubscribed to notifications",
        subscriberId: subscriber._id,
      });
    } catch (error) {
      console.error("[Notifications] Resubscribe error:", error);
      res.status(500).json({ error: "Failed to resubscribe" });
    }
  });

  router.get("/preferences/:subscriberId", async (req, res) => {
    try {
      const { subscriberId } = req.params;
      const subscriber = await Subscriber.findById(subscriberId);
      if (!subscriber || !subscriber.active)
        return res.status(404).json({ error: "Subscriber not found" });
      res.json({ success: true, subscriber });
    } catch (error) {
      console.error("[Notifications] Get preferences error:", error);
      res.status(500).json({ error: "Failed to retrieve preferences" });
    }
  });

  // Manual trigger endpoint for testing
  router.post("/test", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email)
        return res
          .status(400)
          .json({ error: "Email is required in the request body" });

      const subscriber = {
        email: email,
        locations: { home: "Test Location" },
        healthProfile: {
          conditions: ["asthma"],
          ageGroup: "adult",
          pregnant: false,
          outdoorWorker: true,
          athlete: false,
        },
      };
      const testAQI = 125;
      const testComponents = {
        pm2_5: 45,
        pm10: 80,
        o3: 200,
        no2: 60,
        so2: 30,
        co: 500,
      };

      const aqiCategory = getAQICategoryForNotification(testAQI);
      const healthAdvice = getPersonalizedHealthAdvice(
        subscriber.healthProfile,
        testAQI,
        testComponents
      );

      const emailSent = await sendEmailNotification(
        subscriber,
        testAQI,
        aqiCategory,
        healthAdvice
      );
      if (!emailSent) throw new Error("sendEmailNotification returned false.");

      res.json({
        success: true,
        message: "Test notification sent",
        details: {
          aqi: testAQI,
          category: aqiCategory.level,
          adviceCount: healthAdvice.length,
        },
      });
    } catch (error) {
      console.error("[Notifications] Test error:", error);
      res.status(500).json({ error: "Failed to send test notification" });
    }
  });

  return router;
};