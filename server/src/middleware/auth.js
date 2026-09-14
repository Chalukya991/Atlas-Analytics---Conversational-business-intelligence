const jwt = require('jsonwebtoken');
const config = require('../config');
const { UnauthorizedError } = require('../utils/errors');
const { getRedis } = require('../utils/redis');
const logger = require('../utils/logger');

const DENYLIST_PREFIX = 'auth:revoked:';

async function isRevoked(jti) {
  if (!jti) return false;
  try {
    return (await getRedis().exists(DENYLIST_PREFIX + jti)) === 1;
  } catch (err) {
    // Fail closed only if Redis is completely down for a long time; here we
    // log and allow so a Redis blip does not log everyone out.
    logger.warn({ err: err.message }, 'could not check token denylist');
    return false;
  }
}

async function revokeToken(decoded) {
  if (!decoded || !decoded.jti || !decoded.exp) return;
  const ttl = Math.max(1, decoded.exp - Math.floor(Date.now() / 1000));
  try {
    await getRedis().set(DENYLIST_PREFIX + decoded.jti, '1', 'EX', ttl);
  } catch (err) {
    logger.warn({ err: err.message }, 'could not revoke token');
  }
}

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) return next(new UnauthorizedError('Sign in to continue.'));

  let decoded;
  try {
    decoded = jwt.verify(token, config.secretKey, { algorithms: ['HS256'] });
  } catch (err) {
    return next(new UnauthorizedError(err.name === 'TokenExpiredError' ? 'Your session has expired. Sign in again.' : 'Sign in to continue.'));
  }
  if (await isRevoked(decoded.jti)) return next(new UnauthorizedError('Your session has ended. Sign in again.'));
  req.user = { id: decoded.id, orgId: decoded.orgId || null, jti: decoded.jti, exp: decoded.exp };
  return next();
};

module.exports = { authenticateToken, revokeToken };
