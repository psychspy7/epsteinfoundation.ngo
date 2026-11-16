require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const sqlite3 = require('sqlite3').verbose();
const Razorpay = require('razorpay');

const app = express();
const PORT = process.env.PORT || 3000;
const DONATIONS_ENABLED = process.env.DONATIONS_ENABLED === 'true';
const FOUNDATION_STATUS = process.env.FOUNDATION_STATUS || 'PROPOSAL_STAGE';

// Security & JSON middleware
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN || '*',
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// SQLite Database Setup (Transparent Inquiries & Donation Records)
const dbPath = path.join(__dirname, 'epstein_foundation.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database connection failed:', err.message);
  } else {
    console.log('Connected to SQLite database at', dbPath);
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS inquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      contact TEXT NOT NULL,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS donations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_no TEXT UNIQUE NOT NULL,
      donor_name TEXT NOT NULL,
      donor_email TEXT NOT NULL,
      donor_phone TEXT,
      donor_pan TEXT,
      program_area TEXT NOT NULL,
      frequency TEXT NOT NULL,
      amount_inr INTEGER NOT NULL,
      razorpay_order_id TEXT,
      razorpay_payment_id TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Razorpay Instance (initialized only when keys are configured)
let razorpayClient = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpayClient = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

// 1. Health & Public Config Endpoint
app.get('/api/status', (req, res) => {
  res.json({
    organization: 'EPSTEIN FOUNDATION',
    tagline: 'For Children.',
    foundationStatus: FOUNDATION_STATUS,
    donationsEnabled: DONATIONS_ENABLED,
    razorpayConfigured: Boolean(razorpayClient),
    razorpayKeyId: DONATIONS_ENABLED && process.env.RAZORPAY_KEY_ID ? process.env.RAZORPAY_KEY_ID : null,
  });
});

// 2. Volunteer & Community Inquiry Endpoint
app.post('/api/inquiries', (req, res) => {
  const { fullName, contact, category, message } = req.body || {};
  if (!fullName || !contact || !message) {
    return res.status(400).json({ error: 'Name, contact details, and message are required.' });
  }

  const sql = `INSERT INTO inquiries (full_name, contact, category, message) VALUES (?, ?, ?, ?)`;
  db.run(
    sql,
    [String(fullName).trim(), String(contact).trim(), String(category || 'General Inquiry').trim(), String(message).trim()],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Unable to save inquiry.' });
      }
      res.status(201).json({
        id: this.lastID,
        status: 'RECEIVED',
        message: 'Thank you. Your inquiry has been recorded.',
      });
    }
  );
});

// 3. Create Donation Order (Razorpay)
app.post('/api/donations/create-order', async (req, res) => {
  if (!DONATIONS_ENABLED) {
    return res.status(403).json({
      error: 'Online donations are currently disabled while Epstein Foundation is in the proposal and Section 8 incorporation-planning stage.',
      foundationStatus: FOUNDATION_STATUS,
    });
  }

  if (!razorpayClient) {
    return res.status(503).json({
      error: 'Payment gateway credentials are not configured on the server.',
    });
  }

  const { donorName, donorEmail, donorPhone, donorPan, programArea, frequency, amountInr } = req.body || {};
  const amount = parseInt(amountInr, 10);

  if (!donorName || !donorEmail || !Number.isFinite(amount) || amount < 100) {
    return res.status(400).json({ error: 'Valid donor name, email, and minimum amount of INR 100 are required.' });
  }

  const receiptNo = `EF-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

  try {
    const order = await razorpayClient.orders.create({
      amount: amount * 100, // paise
      currency: 'INR',
      receipt: receiptNo,
      notes: {
        program_area: programArea || 'General Child Welfare',
        frequency: frequency || 'One-Time',
      },
    });

    db.run(
      `INSERT INTO donations (receipt_no, donor_name, donor_email, donor_phone, donor_pan, program_area, frequency, amount_inr, razorpay_order_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CREATED')`,
      [
        receiptNo,
        String(donorName).trim(),
        String(donorEmail).trim(),
        donorPhone ? String(donorPhone).trim() : null,
        donorPan ? String(donorPan).trim().toUpperCase() : null,
        String(programArea || 'General Child Welfare').trim(),
        String(frequency || 'One-Time').trim(),
        amount,
        order.id,
      ],
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to record donation order.' });
        }
        res.status(201).json({
          orderId: order.id,
          receiptNo,
          amount: order.amount,
          currency: order.currency,
          keyId: process.env.RAZORPAY_KEY_ID,
        });
      }
    );
  } catch (err) {
    console.error('Razorpay order creation error:', err);
    res.status(500).json({ error: 'Unable to initiate payment order.' });
  }
});

// 4. Verify Razorpay Payment Signature (HMAC-SHA256)
app.post('/api/donations/verify', (req, res) => {
  if (!DONATIONS_ENABLED || !process.env.RAZORPAY_KEY_SECRET) {
    return res.status(403).json({ error: 'Donations are disabled or payment secret is missing.' });
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment verification fields.' });
  }

  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    db.run(`UPDATE donations SET status = 'FAILED' WHERE razorpay_order_id = ?`, [razorpay_order_id]);
    return res.status(400).json({ error: 'Invalid payment signature.' });
  }

  db.run(
    `UPDATE donations SET status = 'VERIFIED', razorpay_payment_id = ? WHERE razorpay_order_id = ?`,
    [razorpay_payment_id, razorpay_order_id],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to update verified donation.' });
      }
      db.get(
        `SELECT receipt_no, donor_name, program_area, frequency, amount_inr, status, created_at FROM donations WHERE razorpay_order_id = ?`,
        [razorpay_order_id],
        (getErr, row) => {
          if (getErr || !row) {
            return res.status(500).json({ error: 'Donation verified but receipt lookup failed.' });
          }
          res.json({ verified: true, receipt: row });
        }
      );
    }
  );
});

// 5. Transparent Public Ledger Summary (Aggregate Only - No PII)
app.get('/api/donations/ledger', (req, res) => {
  db.all(
    `SELECT program_area, COUNT(*) as count, COALESCE(SUM(amount_inr), 0) as total_inr
     FROM donations WHERE status = 'VERIFIED' GROUP BY program_area`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Unable to fetch ledger summary.' });
      }
      res.json({
        foundationStatus: FOUNDATION_STATUS,
        donationsEnabled: DONATIONS_ENABLED,
        programs: rows || [],
      });
    }
  );
});

// Fallback to index.html for SPA routes (e.g. /donate)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`EPSTEIN FOUNDATION server running on http://localhost:${PORT} (Status: ${FOUNDATION_STATUS})`);
});
