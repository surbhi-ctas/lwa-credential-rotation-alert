'use strict';

/**
 * Example: models/amazonCred.model.js (Sequelize / MySQL / Postgres)
 *
 * Each PROJECT can point at a DIFFERENT tableName.
 * Multiple Amazon stores = multiple rows (one per marketplace).
 */

const { DataTypes } = require('sequelize');
const { computeNextRotation, DEFAULTS, createStore } = require('lwa-credential-rotation-alert');

module.exports = (sequelize, tableName = 'amazon_creds') => {
  const AmazonCred = sequelize.define(
    'AmazonCred',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      projectName: { type: DataTypes.STRING, allowNull: false },
      marketplace: { type: DataTypes.STRING, allowNull: false },
      label: { type: DataTypes.STRING },
      sellerId: { type: DataTypes.STRING },
      clientId: { type: DataTypes.STRING, allowNull: false },
      clientSecret: { type: DataTypes.STRING, allowNull: false },
      refreshToken: { type: DataTypes.TEXT, allowNull: false },

      clientSecretRotationIntervalDays: {
        type: DataTypes.INTEGER,
        defaultValue: DEFAULTS.CLIENT_SECRET_ROTATION_DAYS
      },
      lastClientSecretRotatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      nextClientSecretRotationAt: { type: DataTypes.DATE },

      refreshTokenRotationIntervalDays: {
        type: DataTypes.INTEGER,
        defaultValue: DEFAULTS.REFRESH_TOKEN_ROTATION_DAYS
      },
      lastRefreshTokenRotatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      nextRefreshTokenRotationAt: { type: DataTypes.DATE }
    },
    {
      tableName, // ← pass a different table name per project
      timestamps: true,
      indexes: [{ unique: true, fields: ['projectName', 'marketplace'] }]
    }
  );

  AmazonCred.beforeSave((instance) => {
    instance.nextClientSecretRotationAt = computeNextRotation(
      instance.lastClientSecretRotatedAt,
      instance.clientSecretRotationIntervalDays
    );
    instance.nextRefreshTokenRotationAt = computeNextRotation(
      instance.lastRefreshTokenRotatedAt,
      instance.refreshTokenRotationIntervalDays
    );
  });

  const store = createStore({ model: AmazonCred });
  return { AmazonCred, store };
};
