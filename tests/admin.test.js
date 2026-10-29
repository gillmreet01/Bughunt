const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'local-admin-api-test-secret';
const app = require('../server/app');
const { User, Challenge, Attempt, Achievement, UserAchievement } = require('../server/models');

const ADMIN_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439012';
const adminToken = jwt.sign({ id: ADMIN_ID, role: 'admin' }, process.env.JWT_SECRET);
const userToken = jwt.sign({ id: USER_ID, role: 'user' }, process.env.JWT_SECRET);

function query(value) {
  return {
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    populate() { return this; },
    select() { return Promise.resolve(value); },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

async function withStubs(stubs, run) {
  const originals = new Map(Object.keys(stubs).map((key) => {
    const [model, method] = key.split('.');
    return [`${model}.${method}`, [({ User, Challenge, Attempt, Achievement, UserAchievement })[model], method, ({ User, Challenge, Attempt, Achievement, UserAchievement })[model][method]]];
  }));
  for (const [key, implementation] of Object.entries(stubs)) {
    const [model, method] = key.split('.');
    ({ User, Challenge, Attempt, Achievement, UserAchievement })[model][method] = implementation;
  }
  try { await run(); }
  finally {
    for (const [, [model, method, original]] of originals) model[method] = original;
  }
}

const adminRoleLookup = () => ({ select: async () => ({ role: 'admin' }) });
const validChallenge = {
  title: 'Python loop boundary', language: 'Python', topic: 'Loops', difficulty: 'Beginner',
  description: 'Check the loop stop value.', buggyCode: 'for i in range(5):',
  options: ['range(6)', 'range(5)', 'range(4)', 'range(0)'], correctIndex: 0,
  hints: ['Check the stop value.'], xpReward: 10, correctedCode: 'range(6)',
  explanation: 'The stop value is excluded.',
};

test('admin API returns 401 without a token and 403 for a regular signed-in user', async () => {
  await request(app).get('/api/admin/stats').expect(401);
  await request(app).get('/api/admin/stats').set('Authorization', `Bearer ${userToken}`).expect(403, { error: 'Administrator access required.' });
});

test('admin API rechecks the persisted role instead of trusting a stale administrator JWT', async () => {
  await withStubs({ 'User.findById': () => ({ select: async () => ({ role: 'user' }) }) }, async () => {
    await request(app).get('/api/admin/stats').set('Authorization', `Bearer ${adminToken}`).expect(403, { error: 'Administrator access required.' });
  });
});

test('dashboard statistics use database counts and return accurate zero-safe fields', async () => {
  await withStubs({
    'User.findById': adminRoleLookup,
    'User.countDocuments': async () => 12,
    'Challenge.countDocuments': async () => 30,
    'Attempt.countDocuments': async (filter) => filter?.correct ? 7 : 20,
  }, async () => {
    await request(app).get('/api/admin/stats').set('Authorization', `Bearer ${adminToken}`).expect(200, {
      users: 12, challenges: 30, attempts: 20, successfulSubmissions: 7, solves: 7,
    });
  });
});

test('analytics handles an empty database and only accepts supported date ranges', async () => {
  await withStubs({
    'User.findById': adminRoleLookup,
    'User.aggregate': async (pipeline) => pipeline[0]?.$bucket ? [] : [],
    'User.find': () => query([]),
    'Attempt.aggregate': async () => [],
    'Attempt.find': () => query([]),
  }, async () => {
    const res = await request(app).get('/api/admin/analytics?days=7').set('Authorization', `Bearer ${adminToken}`).expect(200);
    assert.equal(res.body.days, 7);
    assert.equal(res.body.userGrowth.length, 7);
    assert.ok(res.body.userGrowth.every((row) => row.count === 0));
    assert.deepEqual(res.body.byLanguage.map((row) => row.language), ['Python', 'Java', 'C++']);
    assert.ok(res.body.byLanguage.every((row) => row.attempts === 0));
    assert.deepEqual(res.body.challengePerformance, []);
    assert.deepEqual(res.body.recentActivity, []);
    assert.deepEqual(res.body.recentUsers, []);
    await request(app).get('/api/admin/analytics?days=8').set('Authorization', `Bearer ${adminToken}`).expect(400);
  });
});

test('challenge create validates fields, blocks mass assignment, and supports safe edit/deactivation', async () => {
  let created;
  let saved = 0;
  const record = { _id: '507f1f77bcf86cd799439013', ...validChallenge, active: true, save: async function save() { saved += 1; } };
  await withStubs({
    'User.findById': adminRoleLookup,
    'Challenge.create': async (data) => { created = data; return { _id: record._id, ...data, active: true }; },
    'Challenge.findById': () => query(record),
  }, async () => {
    await request(app).post('/api/admin/challenges').set('Authorization', `Bearer ${adminToken}`).send({ ...validChallenge, role: 'admin' }).expect(400);
    await request(app).post('/api/admin/challenges').set('Authorization', `Bearer ${adminToken}`).send({ ...validChallenge, options: ['only one'] }).expect(400);
    const createdResponse = await request(app).post('/api/admin/challenges').set('Authorization', `Bearer ${adminToken}`).send(validChallenge).expect(201);
    assert.equal(created.title, validChallenge.title);
    assert.equal(createdResponse.body.challenge.correctIndex, 0);
    assert.equal('role' in createdResponse.body.challenge, false);
    await request(app).patch(`/api/admin/challenges/${record._id}`).set('Authorization', `Bearer ${adminToken}`).send({ title: 'Updated title', role: 'user' }).expect(400);
    await request(app).patch(`/api/admin/challenges/${record._id}`).set('Authorization', `Bearer ${adminToken}`).send({ title: 'Updated title' }).expect(200);
    assert.equal(record.title, 'Updated title');
    await request(app).delete(`/api/admin/challenges/${record._id}`).set('Authorization', `Bearer ${adminToken}`).expect(200, { ok: true, deactivated: true });
    assert.equal(record.active, false);
    assert.equal(saved, 2);
    await request(app).get('/api/admin/challenges/not-an-id').set('Authorization', `Bearer ${adminToken}`).expect(400);
  });
});

test('user listing is paginated, searchable, and excludes hashes and tokens', async () => {
  const listed = [{ _id: USER_ID, name: 'Learner', email: 'learner@example.test', role: 'user', xp: 50, streak: 3, createdAt: new Date('2025-01-01'), passwordHash: 'must-not-leak' }];
  let observedFilter;
  await withStubs({
    'User.findById': adminRoleLookup,
    'User.countDocuments': async (filter) => { observedFilter = filter; return 1; },
    'User.find': (filter) => { observedFilter = filter; return query(listed); },
  }, async () => {
    const res = await request(app).get('/api/admin/users?q=learner&page=1&limit=5&sort=xp&direction=desc').set('Authorization', `Bearer ${adminToken}`).expect(200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0].name, 'Learner');
    assert.equal('passwordHash' in res.body.items[0], false);
    assert.equal('token' in res.body.items[0], false);
    assert.match(observedFilter.$or[0].name.$regex, /learner/i);
    await request(app).get('/api/admin/users?page=0').set('Authorization', `Bearer ${adminToken}`).expect(400);
  });
});

test('achievement CRUD validates metadata and refuses to delete definitions already earned', async () => {
  const record = { _id: '507f1f77bcf86cd799439014', key: 'early-bird', name: 'Early Bird', description: 'Complete a first challenge.', icon: 'bug', save: async () => {} };
  let created;
  await withStubs({
    'User.findById': adminRoleLookup,
    'Achievement.create': async (data) => { created = data; return { _id: record._id, ...data }; },
    'Achievement.findById': () => query(record),
    'Achievement.deleteOne': async () => ({ deletedCount: 1 }),
    'UserAchievement.exists': async () => ({ _id: 'award' }),
  }, async () => {
    await request(app).post('/api/admin/achievements').set('Authorization', `Bearer ${adminToken}`).send({ key: 'unsafe', name: 'Unsafe', description: 'x', icon: 'bug', role: 'admin' }).expect(400);
    const result = await request(app).post('/api/admin/achievements').set('Authorization', `Bearer ${adminToken}`).send({ key: 'early-bird', name: 'Early Bird', description: 'Complete a first challenge.', icon: 'bug' }).expect(201);
    assert.equal(created.key, 'early-bird');
    assert.equal(result.body.achievement.name, 'Early Bird');
    await request(app).patch(`/api/admin/achievements/${record._id}`).set('Authorization', `Bearer ${adminToken}`).send({ key: 'changed-key' }).expect(400);
    await request(app).patch(`/api/admin/achievements/${record._id}`).set('Authorization', `Bearer ${adminToken}`).send({ name: 'First Fix' }).expect(200);
    assert.equal(record.name, 'First Fix');
    await request(app).delete(`/api/admin/achievements/${record._id}`).set('Authorization', `Bearer ${adminToken}`).expect(409);
    await request(app).get('/api/admin/achievements/not-an-id').set('Authorization', `Bearer ${adminToken}`).expect(404);
  });
});

test('public challenge detail does not return answer keys or solution fields', async () => {
  const challenge = {
    id: '507f1f77bcf86cd799439015', title: 'Loop boundary', language: 'Python', topic: 'Loops', difficulty: 'Beginner',
    description: 'Fix the range.', buggyCode: 'range(5)', options: ['range(6)', 'range(5)', 'range(4)', 'range(0)'],
    correctIndex: 0, correctedCode: 'range(6)', explanation: 'The stop is exclusive.', xpReward: 10, hints: ['Check the end value.'],
  };
  await withStubs({
    'Challenge.findOne': async () => challenge,
    'Attempt.findOne': () => ({ sort: async () => null }),
    'Attempt.exists': async () => false,
    'Attempt.countDocuments': async () => 0,
  }, async () => {
    const res = await request(app).get(`/api/challenges/${challenge.id}`).set('Authorization', `Bearer ${userToken}`).expect(200);
    assert.equal(res.body.challenge.options.length, 4);
    assert.equal('correctIndex' in res.body.challenge, false);
    assert.equal('correctedCode' in res.body.challenge, false);
    assert.equal('explanation' in res.body.challenge, false);
  });
});
