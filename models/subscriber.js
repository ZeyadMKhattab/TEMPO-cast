const mongoose = require("mongoose");

const HealthProfileSchema = new mongoose.Schema(
  {
    ageGroup: {
      type: String,
      enum: ["unspecified", "child", "adult", "senior"],
      default: "unspecified",
    },
    conditions: [
      {
        type: String,
        enum: ["asthma", "copd", "heart", "allergies", "other"],
      },
    ],
    pregnant: { type: Boolean, default: false },
    outdoorWorker: { type: Boolean, default: false },
    athlete: { type: Boolean, default: false },
  },
  { _id: false } 
);

const LocationSchema = new mongoose.Schema(
  {
    home: { type: String, trim: true }, 
    work: { type: String, trim: true },
  },
  { _id: false }
);

const NotificationMethodsSchema = new mongoose.Schema(
  {
    email: { type: Boolean, default: true },
    sms: { type: Boolean, default: false },
  },
  { _id: false }
);

const SubscriberSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, index: true },
    phone: { type: String, trim: true },
    notificationMethods: { type: NotificationMethodsSchema, default: () => ({}) },
    frequency: {
      type: String,
      enum: ["realtime", "hourly", "daily", "weekly"],
      default: "daily",
    },
    healthProfile: { type: HealthProfileSchema, default: () => ({}) },
    threshold: {
      type: String,
      enum: ["sensitive", "standard", "high"],
      default: "standard",
    },
    locations: { type: LocationSchema, default: () => ({}) },
    active: { type: Boolean, default: true, index: true },
    unsubscribedAt: Date,
    sensitivityLevel: {
      type: String,
      enum: ["low", "moderate", "high"],
    },
    lastNotified: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model("Subscriber", SubscriberSchema);