const express = require('express');
const mongoose = require('mongoose');
const { User, Challenge, Attempt, Achievement, UserAchievement } = require('../models');

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const LANGUAGES = ['Python', 'Java', 'C++'];
const DIFFICULTIES = ['Beginner', 'Intermediate', 'Advanced'];
const ICONS = ['bug', 'star', 'target', 'python', 'java', 'cpp'];
const CHALLENGE_FIELDS = [
  'title', 'language', 'topic', 'difficulty', 'description', 'buggyCode',
  'options', 'correctIndex', 'hints', 'xpReward', 'correctedCode', 'explanation', 'active',
];

// JWT signatures authenticate the caller; confirm the role still exists in MongoDB
// so a role removed from the database does not remain valid for the token lifetime.
router.use(asyncRoute(async (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Administrator access required.' });
  const user = await User.findById(req.user.id).select('role');
  if (!user) return res.status(401).json({ error: 'Account not found. Please sign in again.' });
  if (user.role !== 'admin') return res.status(403).json({ error: 'Administrator access required.' });
  req.admin = user;
  next();
}));

function pagination(query) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return { error: 'Page must be a positive integer and limit must be between 1 and 100.' };
  }
  return { page, limit };
}

function safePattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function userView(user) {
  if (!user) return null;
  return {
    id: String(user._id || user.id), name: user.name, email: user.email,
    role: user.role, xp: user.xp, streak: user.streak,
    lastActivityDate: user.lastActivityDate || null,
    bio: user.profile?.bio || '', createdAt: user.createdAt,
  };
}

function challengeView(challenge) {
  return {
    id: String(challenge._id || challenge.id), title: challenge.title,
    language: challenge.language, topic: challenge.topic, difficulty: challenge.difficulty,
    description: challenge.description, buggyCode: challenge.buggyCode,
    options: challenge.options, correctIndex: challenge.correctIndex,
    hints: challenge.hints || [], correctedCode: challenge.correctedCode,
    explanation: challenge.explanation, xpReward: challenge.xpReward,
    active: challenge.active, createdAt: challenge.createdAt, updatedAt: challenge.updatedAt,
  };
}

function validateChallenge(input, partial = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Request body must be an object.' };
  const unknown = Object.keys(input).filter((key) => !CHALLENGE_FIELDS.includes(key));
  if (unknown.length) return { error: `Unsupported challenge field: ${unknown[0]}.` };
  if (!partial && CHALLENGE_FIELDS.some((key) => key !== 'active' && input[key] === undefined)) {
    return { error: 'Provide all challenge fields, including four options, a correct answer, hints and an explanation.' };
  }
  if (!Object.keys(input).length) return { error: 'Provide at least one challenge field to update.' };
  const value = {};
  for (const key of ['title', 'topic', 'description', 'buggyCode', 'correctedCode', 'explanation']) {
    if (input[key] === undefined) continue;
    const max = key === 'buggyCode' || key === 'correctedCode' ? 12000 : key === 'description' || key === 'explanation' ? 2000 : 120;
    if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > max) {
      return { error: `${key} must be a non-empty string of at most ${max} characters.` };
    }
    value[key] = input[key].trim();
  }
  if (input.language !== undefined) {
    if (!LANGUAGES.includes(input.language)) return { error: 'Language must be Python, Java or C++.' };
    value.language = input.language;
  }
  if (input.difficulty !== undefined) {
    if (!DIFFICULTIES.includes(input.difficulty)) return { error: 'Difficulty must be Beginner, Intermediate or Advanced.' };
    value.difficulty = input.difficulty;
  }
  if (input.options !== undefined) {
    if (!Array.isArray(input.options) || input.options.length !== 4 || input.options.some((item) => typeof item !== 'string' || !item.trim() || item.length > 1000)) {
      return { error: 'A challenge must contain exactly four non-empty answer options (up to 1000 characters each).' };
    }
    value.options = input.options.map((item) => item.trim());
  }
  if (input.correctIndex !== undefined) {
    if (!Number.isInteger(input.correctIndex) || input.correctIndex < 0 || input.correctIndex > 3) return { error: 'correctIndex must be an integer from 0 to 3.' };
    value.correctIndex = input.correctIndex;
  }
  if (input.hints !== undefined) {
    if (!Array.isArray(input.hints) || input.hints.length < 1 || input.hints.length > 10 || input.hints.some((hint) => typeof hint !== 'string' || !hint.trim() || hint.length > 300)) {
      return { error: 'Provide between 1 and 10 non-empty hints (up to 300 characters each).' };
    }
    value.hints = input.hints.map((hint) => hint.trim());
  }
  if (input.xpReward !== undefined) {
    if (!Number.isInteger(input.xpReward) || input.xpReward < 1 || input.xpReward > 1000) return { error: 'XP reward must be an integer from 1 to 1000.' };
    value.xpReward = input.xpReward;
  }
  if (input.active !== undefined) {
    if (typeof input.active !== 'boolean') return { error: 'active must be true or false.' };
    value.active = input.active;
  }
  if (value.options && value.correctIndex !== undefined && value.correctIndex >= value.options.length) return { error: 'The correct answer must point to one of the four options.' };
  return { value };
}

function validateAchievement(input, partial = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Request body must be an object.' };
  const allowed = partial ? ['name', 'description', 'icon'] : ['key', 'name', 'description', 'icon'];
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length) return { error: `Unsupported achievement field: ${unknown[0]}.` };
  if (!partial && allowed.some((key) => typeof input[key] !== 'string')) return { error: 'Provide a key, name, description and supported icon.' };
  if (!Object.keys(input).length) return { error: 'Provide at least one achievement field to update.' };
  const value = {};
  if (input.key !== undefined) {
    if (typeof input.key !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.key)) return { error: 'Achievement key must use lowercase letters, numbers and single hyphens.' };
    value.key = input.key;
  }
  for (const [key, max] of [['name', 80], ['description', 240]]) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > max) return { error: `${key} must be a non-empty string of at most ${max} characters.` };
    value[key] = input[key].trim();
  }
  if (input.icon !== undefined) {
    if (!ICONS.includes(input.icon)) return { error: `Icon must be one of: ${ICONS.join(', ')}.` };
    value.icon = input.icon;
  }
  return { value };
}

router.get('/stats', asyncRoute(async (_req, res) => {
  const [users, challenges, attempts, successfulSubmissions] = await Promise.all([
    User.countDocuments(), Challenge.countDocuments(), Attempt.countDocuments(), Attempt.countDocuments({ correct: true }),
  ]);
  res.json({ users, challenges, attempts, successfulSubmissions, solves: successfulSubmissions });
}));

router.get('/analytics', asyncRoute(async (req, res) => {
  const days = req.query.days === undefined ? 30 : Number(req.query.days);
  if (![7, 30, 90].includes(days)) return res.status(400).json({ error: 'days must be 7, 30 or 90.' });
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const groupDate = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } };
  const [usersByDay, attemptsByDay, languageRows, performanceRows, xpRows, recentAttempts, recentUsers] = await Promise.all([
    User.aggregate([
      { $match: { createdAt: { $gte: start } } },
      { $group: { _id: groupDate, count: { $sum: 1 } } }, { $sort: { _id: 1 } },
    ]),
    Attempt.aggregate([
      { $match: { createdAt: { $gte: start } } },
      { $group: { _id: groupDate, attempts: { $sum: 1 }, correct: { $sum: { $cond: ['$correct', 1, 0] } } } },
      { $sort: { _id: 1 } },
    ]),
    Attempt.aggregate([
      { $lookup: { from: Challenge.collection.name, localField: 'challenge', foreignField: '_id', as: 'challenge' } },
      { $unwind: '$challenge' },
      { $group: { _id: '$challenge.language', attempts: { $sum: 1 }, correct: { $sum: { $cond: ['$correct', 1, 0] } } } },
    ]),
    Attempt.aggregate([
      { $group: { _id: { challenge: '$challenge', user: '$user' }, attempts: { $sum: 1 }, solved: { $max: { $cond: ['$correct', 1, 0] } } } },
      { $group: { _id: '$_id.challenge', attempts: { $sum: '$attempts' }, learners: { $sum: 1 }, solvers: { $sum: '$solved' } } },
      { $sort: { attempts: -1 } }, { $limit: 10 },
      { $lookup: { from: Challenge.collection.name, localField: '_id', foreignField: '_id', as: 'challenge' } },
      { $unwind: { path: '$challenge', preserveNullAndEmptyArrays: true } },
      { $project: { _id: 0, id: '$_id', title: '$challenge.title', language: '$challenge.language', difficulty: '$challenge.difficulty', attempts: 1, learners: 1, solvers: 1 } },
    ]),
    User.aggregate([
      { $bucket: { groupBy: '$xp', boundaries: [0, 50, 100, 250], default: '250+', output: { users: { $sum: 1 } } } },
    ]),
    Attempt.find().sort({ createdAt: -1 }).limit(8).populate('user', 'name email').populate('challenge', 'title language'),
    User.find().sort({ createdAt: -1 }).limit(5).select('name email createdAt'),
  ]);
  const dateLabels = Array.from({ length: days }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
  const userMap = new Map(usersByDay.map((row) => [row._id, row.count]));
  const attemptMap = new Map(attemptsByDay.map((row) => [row._id, row]));
  const byLanguage = LANGUAGES.map((language) => {
    const row = languageRows.find((item) => item._id === language);
    return { language, attempts: row?.attempts || 0, correct: row?.correct || 0 };
  });
  const xpLabels = new Map([[0, '0-49'], [50, '50-99'], [100, '100-249'], ['250+', '250+']]);
  const xpDistribution = [0, 50, 100, '250+'].map((bucket) => ({ range: xpLabels.get(bucket), users: xpRows.find((row) => row._id === bucket)?.users || 0 }));
  const recentActivity = recentAttempts.map((attempt) => ({
    id: String(attempt._id || attempt.id), createdAt: attempt.createdAt, correct: !!attempt.correct,
    user: attempt.user ? { id: String(attempt.user._id || attempt.user.id), name: attempt.user.name, email: attempt.user.email } : null,
    challenge: attempt.challenge ? { id: String(attempt.challenge._id || attempt.challenge.id), title: attempt.challenge.title, language: attempt.challenge.language } : null,
  }));
  res.json({
    days, labels: dateLabels,
    userGrowth: dateLabels.map((date) => ({ date, count: userMap.get(date) || 0 })),
    attemptTrend: dateLabels.map((date) => ({ date, attempts: attemptMap.get(date)?.attempts || 0, correct: attemptMap.get(date)?.correct || 0 })),
    byLanguage,
    challengePerformance: performanceRows.map((row) => ({ ...row, completionRate: row.learners ? Math.round((row.solvers / row.learners) * 100) : 0 })),
    xpDistribution,
    recentActivity,
    recentUsers: recentUsers.map(userView),
  });
}));

router.get('/users', asyncRoute(async (req, res) => {
  const paging = pagination(req.query);
  if (paging.error) return res.status(400).json({ error: paging.error });
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  if (req.query.q !== undefined && typeof req.query.q !== 'string') return res.status(400).json({ error: 'q must be text.' });
  const role = req.query.role;
  if (role !== undefined && !['admin', 'user'].includes(role)) return res.status(400).json({ error: 'role must be admin or user.' });
  const sortKey = req.query.sort || 'createdAt';
  const sortField = { name: 'name', email: 'email', xp: 'xp', streak: 'streak', createdAt: 'createdAt' }[sortKey];
  if (!sortField) return res.status(400).json({ error: 'Unsupported user sort field.' });
  const direction = req.query.direction || 'desc';
  if (!['asc', 'desc'].includes(direction)) return res.status(400).json({ error: 'direction must be asc or desc.' });
  const filter = {};
  if (q) filter.$or = [{ name: { $regex: safePattern(q), $options: 'i' } }, { email: { $regex: safePattern(q), $options: 'i' } }];
  if (role) filter.role = role;
  const [total, users] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter).sort({ [sortField]: direction === 'asc' ? 1 : -1 }).skip((paging.page - 1) * paging.limit).limit(paging.limit).select('name email role xp streak lastActivityDate profile.bio createdAt'),
  ]);
  res.json({ items: users.map(userView), total, page: paging.page, limit: paging.limit, pages: Math.ceil(total / paging.limit) });
}));

router.get('/users/:id', asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid user id.' });
  const paging = pagination(req.query);
  if (paging.error) return res.status(400).json({ error: paging.error });
  const user = await User.findById(req.params.id).select('name email role xp streak lastActivityDate profile.bio createdAt');
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const [attempts, successful] = await Promise.all([
    Attempt.find({ user: req.params.id }).sort({ createdAt: -1 }).skip((paging.page - 1) * paging.limit).limit(paging.limit).populate('challenge', 'title language topic difficulty'),
    Attempt.countDocuments({ user: req.params.id, correct: true }),
  ]);
  res.json({
    user: userView(user), successfulSubmissions: successful,
    attempts: attempts.map((attempt) => ({
      id: String(attempt._id || attempt.id), createdAt: attempt.createdAt,
      correct: !!attempt.correct, hintsUsed: attempt.hintsUsed, xpAwarded: attempt.xpAwarded,
      challenge: attempt.challenge ? { id: String(attempt.challenge._id || attempt.challenge.id), title: attempt.challenge.title, language: attempt.challenge.language, topic: attempt.challenge.topic, difficulty: attempt.challenge.difficulty } : null,
    })),
    page: paging.page, limit: paging.limit,
  });
}));

router.get('/challenges', asyncRoute(async (req, res) => {
  const paging = pagination(req.query);
  if (paging.error) return res.status(400).json({ error: paging.error });
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  if (req.query.q !== undefined && typeof req.query.q !== 'string') return res.status(400).json({ error: 'q must be text.' });
  if (req.query.language && !LANGUAGES.includes(req.query.language)) return res.status(400).json({ error: 'Invalid language filter.' });
  if (req.query.difficulty && !DIFFICULTIES.includes(req.query.difficulty)) return res.status(400).json({ error: 'Invalid difficulty filter.' });
  const status = req.query.status || 'all';
  if (!['all', 'active', 'inactive'].includes(status)) return res.status(400).json({ error: 'status must be all, active or inactive.' });
  const filter = {};
  if (req.query.language) filter.language = req.query.language;
  if (req.query.difficulty) filter.difficulty = req.query.difficulty;
  if (status !== 'all') filter.active = status === 'active';
  if (q) filter.$or = [{ title: { $regex: safePattern(q), $options: 'i' } }, { topic: { $regex: safePattern(q), $options: 'i' } }];
  const [total, challenges] = await Promise.all([
    Challenge.countDocuments(filter),
    Challenge.find(filter).sort({ createdAt: -1, title: 1 }).skip((paging.page - 1) * paging.limit).limit(paging.limit).select('+correctIndex +correctedCode +explanation'),
  ]);
  res.json({ items: challenges.map(challengeView), total, page: paging.page, limit: paging.limit, pages: Math.ceil(total / paging.limit) });
}));

router.get('/challenges/:id', asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid challenge id.' });
  const challenge = await Challenge.findById(req.params.id).select('+correctIndex +correctedCode +explanation');
  if (!challenge) return res.status(404).json({ error: 'Challenge not found.' });
  res.json({ challenge: challengeView(challenge) });
}));

router.post('/challenges', asyncRoute(async (req, res) => {
  const result = validateChallenge(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const challenge = await Challenge.create(result.value);
  res.status(201).json({ challenge: challengeView(challenge) });
}));

router.patch('/challenges/:id', asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid challenge id.' });
  const result = validateChallenge(req.body, true);
  if (result.error) return res.status(400).json({ error: result.error });
  const challenge = await Challenge.findById(req.params.id).select('+correctIndex +correctedCode +explanation');
  if (!challenge) return res.status(404).json({ error: 'Challenge not found.' });
  Object.assign(challenge, result.value);
  await challenge.save();
  res.json({ challenge: challengeView(challenge) });
}));

router.delete('/challenges/:id', asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid challenge id.' });
  const challenge = await Challenge.findById(req.params.id);
  if (!challenge) return res.status(404).json({ error: 'Challenge not found.' });
  challenge.active = false;
  await challenge.save();
  res.json({ ok: true, deactivated: true });
}));

router.get('/achievements', asyncRoute(async (_req, res) => {
  const items = await Achievement.find().sort({ key: 1 });
  res.json({ items: items.map((item) => ({ id: String(item._id || item.id), key: item.key, name: item.name, description: item.description, icon: item.icon })) });
}));

router.post('/achievements', asyncRoute(async (req, res) => {
  const result = validateAchievement(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const item = await Achievement.create(result.value);
  res.status(201).json({ achievement: { id: String(item._id || item.id), key: item.key, name: item.name, description: item.description, icon: item.icon } });
}));

router.patch('/achievements/:id', asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid achievement id.' });
  const result = validateAchievement(req.body, true);
  if (result.error) return res.status(400).json({ error: result.error });
  const item = await Achievement.findById(req.params.id);
  if (!item) return res.status(404).json({ error: 'Achievement not found.' });
  Object.assign(item, result.value);
  await item.save();
  res.json({ achievement: { id: String(item._id || item.id), key: item.key, name: item.name, description: item.description, icon: item.icon } });
}));

router.delete('/achievements/:id', asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid achievement id.' });
  const item = await Achievement.findById(req.params.id);
  if (!item) return res.status(404).json({ error: 'Achievement not found.' });
  if (await UserAchievement.exists({ achievement: item._id || item.id })) {
    return res.status(409).json({ error: 'This achievement has already been earned. It cannot be deleted while user awards reference it.' });
  }
  await Achievement.deleteOne({ _id: item._id || item.id });
  res.json({ ok: true });
}));

router.use((req, res) => res.status(404).json({ error: 'Admin endpoint not found.' }));

module.exports = router;
module.exports.validateChallenge = validateChallenge;
module.exports.validateAchievement = validateAchievement;
module.exports.userView = userView;
