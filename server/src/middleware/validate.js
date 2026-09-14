const { BadRequestError } = require('../utils/errors');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Minimal declarative body validator. Each rule:
 *   { type: 'string'|'number'|'boolean'|'array'|'uuid'|'email'|'enum',
 *     required?, min?, max?, values?, trim? }
 */
function validateBody(rules) {
  return (req, res, next) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const out = {};
    for (const [key, rule] of Object.entries(rules)) {
      let value = body[key];
      if (value === undefined || value === null || value === '') {
        if (rule.required) return next(new BadRequestError(`${rule.label || key} is required.`));
        if (rule.default !== undefined) out[key] = rule.default;
        continue;
      }
      switch (rule.type) {
        case 'string':
        case 'email':
          if (typeof value !== 'string') return next(new BadRequestError(`${rule.label || key} must be text.`));
          if (rule.trim !== false) value = value.trim();
          if (rule.min && value.length < rule.min) return next(new BadRequestError(`${rule.label || key} must be at least ${rule.min} characters.`));
          if (rule.max && value.length > rule.max) return next(new BadRequestError(`${rule.label || key} must be at most ${rule.max} characters.`));
          if (rule.type === 'email') {
            value = value.toLowerCase();
            if (!EMAIL_RE.test(value)) return next(new BadRequestError('Enter a valid email address.'));
          }
          break;
        case 'uuid':
          if (typeof value !== 'string' || !UUID_RE.test(value)) return next(new BadRequestError(`${rule.label || key} is not a valid id.`));
          break;
        case 'number': {
          const n = Number(value);
          if (!Number.isFinite(n)) return next(new BadRequestError(`${rule.label || key} must be a number.`));
          if (rule.min !== undefined && n < rule.min) return next(new BadRequestError(`${rule.label || key} must be at least ${rule.min}.`));
          if (rule.max !== undefined && n > rule.max) return next(new BadRequestError(`${rule.label || key} must be at most ${rule.max}.`));
          value = n;
          break;
        }
        case 'boolean':
          value = value === true || value === 'true';
          break;
        case 'enum':
          if (!rule.values.includes(value)) return next(new BadRequestError(`${rule.label || key} must be one of: ${rule.values.join(', ')}.`));
          break;
        case 'array':
          if (!Array.isArray(value)) return next(new BadRequestError(`${rule.label || key} must be a list.`));
          if (rule.max && value.length > rule.max) return next(new BadRequestError(`${rule.label || key} can have at most ${rule.max} items.`));
          if (rule.items === 'uuid' && !value.every((v) => typeof v === 'string' && UUID_RE.test(v))) {
            return next(new BadRequestError(`${rule.label || key} contains an invalid id.`));
          }
          break;
        default:
          break;
      }
      out[key] = value;
    }
    req.body = out;
    return next();
  };
}

function validateParams(names) {
  return (req, res, next) => {
    for (const name of names) {
      if (!UUID_RE.test(String(req.params[name] || ''))) {
        return next(new BadRequestError(`${name} is not a valid id.`));
      }
    }
    return next();
  };
}

module.exports = { validateBody, validateParams, UUID_RE, EMAIL_RE };
