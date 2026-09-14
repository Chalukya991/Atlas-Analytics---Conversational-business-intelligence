const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { User, Organization } = require('../models');
const { BadRequestError, UnauthorizedError, NotFoundError } = require('../utils/errors');
const { revokeToken } = require('../middleware/auth');

const BCRYPT_ROUNDS = 12;

function issueToken(user) {
  return jwt.sign(
    { id: user.id, orgId: user.organization_id || null, jti: crypto.randomUUID() },
    config.secretKey,
    { expiresIn: config.tokenTtl, algorithm: 'HS256' },
  );
}

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, organizationId: user.organization_id || null };
}

function assertPasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new BadRequestError('Password must be at least 8 characters.');
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new BadRequestError('Password must include at least one letter and one number.');
  }
}

exports.register = async (email, password, name) => {
  assertPasswordStrength(password);
  const existingUser = await User.findByEmail(email);
  if (existingUser) throw new BadRequestError('An account with this email already exists.');

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const org = await Organization.create(`${name}'s Workspace`);
  const user = await User.create({ email, passwordHash, name, organizationId: org.id });
  const full = { ...user, organization_id: org.id };
  return { user: publicUser(full), token: issueToken(full) };
};

exports.login = async (email, password) => {
  const user = await User.findByEmail(email);
  // Constant-ish time: always run a compare so timing does not reveal accounts.
  const hash = user ? user.password_hash : '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid';
  const isMatch = await bcrypt.compare(password || '', hash);
  if (!user || !isMatch) throw new UnauthorizedError('Invalid email or password.');
  return { user: publicUser(user), token: issueToken(user) };
};

exports.me = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw new NotFoundError('User not found');
  return publicUser(user);
};

exports.logout = async (decoded) => {
  await revokeToken(decoded);
};

exports.changePassword = async (userId, currentPassword, newPassword) => {
  assertPasswordStrength(newPassword);
  const user = await User.findByIdWithHash(userId);
  if (!user) throw new NotFoundError('User not found');
  const ok = await bcrypt.compare(currentPassword || '', user.password_hash);
  if (!ok) throw new UnauthorizedError('Current password is incorrect.');
  await User.updatePassword(userId, await bcrypt.hash(newPassword, BCRYPT_ROUNDS));
};
