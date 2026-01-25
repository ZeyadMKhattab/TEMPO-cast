const express = require("express");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const path = require("path");

const router = express.Router();
const Subscriber = mongoose.model("Subscriber");

router.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin.html"));
});

router.get("/subscribers", async (req, res) => {
  try {
    const subscribers = await Subscriber.find({})
      .sort({ createdAt: -1 })
      .select("_id email frequency sensitivityLevel active createdAt lastNotified");

    res.json({
      success: true,
      total: subscribers.length,
      active: subscribers.filter((s) => s.active).length,
      subscribers,
    });
  } catch (error) {
    console.error("[Admin] Error listing subscribers:", error);
    res.status(500).json({ error: "Failed to list subscribers." });
  }
});

router.get("/subscribers/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid subscriber ID." });
    }
    const subscriber = await Subscriber.findById(req.params.id);
    if (!subscriber) {
      return res.status(404).json({ error: "Subscriber not found." });
    }
    res.json({ success: true, subscriber });
  } catch (error) {
    console.error("[Admin] Error fetching subscriber:", error);
    res.status(500).json({ error: "Failed to fetch subscriber details." });
  }
});

router.post("/subscribers", async (req, res) => {
  try {
    const { email, ...otherData } = req.body;
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "A valid email is required." });
    }

    const existingSubscriber = await Subscriber.findOne({ email });
    if (existingSubscriber) {
      return res.status(409).json({ error: "A subscriber with this email already exists." });
    }

    const newSubscriber = new Subscriber({ email, ...otherData });
    await newSubscriber.save();

    res.status(201).json({ success: true, subscriber: newSubscriber });
  } catch (error) {
    console.error("[Admin] Error adding subscriber:", error);
    res.status(500).json({ error: "Failed to add subscriber." });
  }
});

router.put("/subscribers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid subscriber ID." });
    }

    const updatedSubscriber = await Subscriber.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!updatedSubscriber) {
      return res.status(404).json({ error: "Subscriber not found." });
    }

    res.json({ success: true, subscriber: updatedSubscriber });
  } catch (error) {
    console.error("[Admin] Error updating subscriber:", error);
    res.status(500).json({ error: "Failed to update subscriber." });
  }
});

router.post("/broadcast", async (req, res) => {
  const { subject, message } = req.body;
  if (!subject || !message) {
    return res.status(400).json({ error: "Subject and message are required." });
  }

  try {
    const subscribers = await Subscriber.find({ active: true }).select("email");
    if (subscribers.length === 0) {
      return res.status(404).json({ error: "No active subscribers to send to." });
    }

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      console.error("[Broadcast] Email service not configured.");
      return res.status(500).json({ error: "Email service is not configured on the server." });
    }

    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || "gmail",
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD },
    });

    const bccEmails = subscribers.map(s => s.email).join(", ");

    await transporter.sendMail({
      from: '"Global TEMPO Admin" <admin@globaltempo.com>',
      to: process.env.EMAIL_USER, // Send one email to yourself
      bcc: bccEmails, // And BCC all subscribers
      subject: subject,
      html: `<div style="font-family: sans-serif; line-height: 1.6;">${message.replace(/\n/g, "<br>")}</div>`,
    });

    res.json({ success: true, message: `Broadcast email sent to ${subscribers.length} subscribers.` });
  } catch (error) {
    console.error("[Admin] Error sending broadcast:", error);
    res.status(500).json({ error: "Failed to send broadcast email." });
  }
});

router.delete("/subscribers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid subscriber ID." });
    }
    const deletedSubscriber = await Subscriber.findByIdAndDelete(id);
    if (!deletedSubscriber) {
      return res.status(404).json({ error: "Subscriber not found." });
    }
    res.json({ success: true, message: "Subscriber deleted successfully." });
  } catch (error) {
    console.error("[Admin] Error deleting subscriber:", error);
    res.status(500).json({ error: "Failed to delete subscriber." });
  }
});

module.exports = router;