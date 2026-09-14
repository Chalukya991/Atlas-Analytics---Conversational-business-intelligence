const authService = require('../services/auth');

exports.register = async (req, res, next) => {
  try {
    const { email, password, name } = req.body;
    res.status(201).json(await authService.register(email, password, name));
  } catch (err) {
    next(err);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    res.json(await authService.login(email, password));
  } catch (err) {
    next(err);
  }
};

exports.me = async (req, res, next) => {
  try {
    res.json({ user: await authService.me(req.user.id) });
  } catch (err) {
    next(err);
  }
};

exports.logout = async (req, res, next) => {
  try {
    await authService.logout(req.user);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};

exports.changePassword = async (req, res, next) => {
  try {
    await authService.changePassword(req.user.id, req.body.currentPassword, req.body.newPassword);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};
