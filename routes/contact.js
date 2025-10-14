const express = require("express");
const nodemailer = require("nodemailer");
const { body, validationResult } = require("express-validator");

const router = express.Router();

router.post("/", async (req, res) => {
  const { name, email, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: "All fields are required." });
  }

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
    console.error("[Contact Form] Error: EMAIL_USER and EMAIL_PASSWORD must be set in .env file.");
    return res.status(500).json({ error: "Server is not configured for sending emails." });
  }

  const transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  const mailOptions = {
    from: `"${name}" <${process.env.EMAIL_USER}>`, // Use a verified sender email
    to: process.env.CONTACT_EMAIL || process.env.EMAIL_USER,
    subject: `New Contact Form Message from ${name}`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2>New Message from Global TEMPO Contact Form</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
        <hr>
        <h3>Message:</h3>
        <p style="background: #f4f4f4; padding: 15px; border-radius: 5px;">${message.replace(/\n/g, "<br>")}</p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: "Message sent successfully!" });
  } catch (error) {
    console.error("[Contact Form] Error sending email:", error);
    res.status(500).json({ error: "Failed to send message." });
  }
});

module.exports = router;