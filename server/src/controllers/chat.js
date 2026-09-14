const chatService = require('../services/chat');
const { NotFoundError } = require('../utils/errors');

const ctx = (req) => ({ projectId: req.params.projectId, userId: req.user.id, organizationId: req.user.orgId });

exports.ask = async (req, res, next) => {
  try {
    const result = await chatService.askQuestion({ ...ctx(req), question: req.body.question, datasetId: req.body.datasetId });
    res.status(202).json(result);
  } catch (err) {
    next(err);
  }
};

exports.getAnalysis = async (req, res, next) => {
  try {
    const analysis = await chatService.getAnalysis({ ...ctx(req), analysisId: req.params.analysisId });
    if (!analysis) return next(new NotFoundError('Analysis not found'));
    return res.json(analysis);
  } catch (err) {
    return next(err);
  }
};

exports.listAnalyses = async (req, res, next) => {
  try {
    const includeResults = req.query.include !== 'summary';
    res.json({ analyses: await chatService.listAnalyses({ ...ctx(req), includeResults }) });
  } catch (err) {
    next(err);
  }
};

exports.deleteAnalysis = async (req, res, next) => {
  try {
    await chatService.deleteAnalysis({ ...ctx(req), analysisId: req.params.analysisId });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};

exports.exportCsv = async (req, res, next) => {
  try {
    const analysis = await chatService.getAnalysis({ ...ctx(req), analysisId: req.params.analysisId });
    if (!analysis) return next(new NotFoundError('Analysis not found'));
    if (analysis.status !== 'completed' || !analysis.results) return next(new NotFoundError('This analysis has no results to export.'));
    const csv = chatService.resultsToCsv(analysis.results);
    const name = String(analysis.question || 'analysis').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'analysis';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    return res.send(`﻿${csv}`);
  } catch (err) {
    return next(err);
  }
};
