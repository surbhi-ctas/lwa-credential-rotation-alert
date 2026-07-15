'use strict';

/**
 * Example: models/AmazonCred.js (Mongoose)
 *
 * Each PROJECT can use a DIFFERENT model / collection name.
 * One project can store MANY Amazon marketplaces (US, UK, IN, ...)
 * as separate rows — the monitor checks all of them.
 */

const mongoose = require('mongoose');
const { computeNextRotation, DEFAULTS, createStore } = require('lwa-credential-rotation-alert');

// Use YOUR collection name — change "amazon_creds" per project if needed
const AmazonCredSchema = new mongoose.Schema(
  {
    projectName: { type: String, required: true },
    marketplace: { type: String, required: true }, // US, UK, DE, IN, AE, JP, ...
    label: { type: String },
    sellerId: { type: String },
    clientId: { type: String, required: true },
    clientSecret: { type: String, required: true },
    refreshToken: { type: String, required: true },

    // --- rotation tracking (add these fields to your existing table) ---
    clientSecretRotationIntervalDays: {
      type: Number,
      default: DEFAULTS.CLIENT_SECRET_ROTATION_DAYS
    },
    lastClientSecretRotatedAt: { type: Date, default: Date.now },
    nextClientSecretRotationAt: { type: Date },

    refreshTokenRotationIntervalDays: {
      type: Number,
      default: DEFAULTS.REFRESH_TOKEN_ROTATION_DAYS
    },
    lastRefreshTokenRotatedAt: { type: Date, default: Date.now },
    nextRefreshTokenRotationAt: { type: Date },

    meta: { type: mongoose.Schema.Types.Mixed }
  },
  { collection: 'amazon_creds', timestamps: true } // ← different table name per project
);

AmazonCredSchema.pre('save', function (next) {
  this.nextClientSecretRotationAt = computeNextRotation(
    this.lastClientSecretRotatedAt,
    this.clientSecretRotationIntervalDays
  );
  this.nextRefreshTokenRotationAt = computeNextRotation(
    this.lastRefreshTokenRotatedAt,
    this.refreshTokenRotationIntervalDays
  );
  next();
});

AmazonCredSchema.index({ projectName: 1, marketplace: 1 }, { unique: true });

const AmazonCred = mongoose.model('AmazonCred', AmazonCredSchema);

/**
 * Prefer createStore — works with any model/collection name.
 * If your columns differ, pass `fields: { marketplace: 'region', ... }`.
 */
const store = createStore({ model: AmazonCred });

module.exports = { AmazonCred, store };
