// Database-backed tests. They start an in-memory MongoDB (mongodb-memory-server);
// the first run downloads a mongod binary, so allow network access once.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod, app, models;
const seedRows = require('../server/seeds/challenges');
const seedScript = path.resolve(__dirname, '../server/seeds/seed.js');

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('bughunt_test');
  process.env.JWT_SECRET = 'integration-test-secret';
  process.env.TZ = 'Asia/Kolkata';
  process.env.RATE_LIMIT_SCALE = '1000'; // many requests from one IP in a short time
  await mongoose.connect(process.env.MONGODB_URI);
  models = require('../server/models');
  app = require('../server/app');
  await Promise.all(Object.values(models).map((m) => m.syncIndexes()));
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test.beforeEach(async () => {
  await Promise.all(Object.values(models).map((m) => m.deleteMany({})));
});

let counter = 0;
async function signUp(role = 'user') {
  const email = `user${++counter}@example.com`;
  const password = 'correct-horse-battery';
  const res = await request(app).post('/api/auth/register').send({ name: `User ${counter}`, email, password }).expect(201);
  if (role !== 'user') {
    await models.User.updateOne({ email }, { $set: { role } });
    const login = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
    return { token: login.body.token, id: res.body.user.id, email, password };
  }
  return { token: res.body.token, id: res.body.user.id, email, password };
}
const authed = (req, token) => req.set('Authorization', `Bearer ${token}`);
const submit = (token, id, answer) => authed(request(app).post(`/api/challenges/${id}/submit`), token).send({ answer });

async function makeChallenges(count = 1, overrides = {}) {
  const docs = [];
  for (let i = 0; i < count; i++) {
    docs.push({
      title: `Challenge ${i + 1}`, language: 'Python', topic: 'Loops', difficulty: 'Beginner',
      description: 'd', buggyCode: 'x', options: ['a', 'b', 'c', 'd'], correctIndex: 2,
      hints: ['hint one', 'hint two'], correctedCode: 'c', explanation: 'because', xpReward: 10,
      ...overrides,
    });
  }
  return models.Challenge.insertMany(docs);
}

test('correct answer awards XP once; later correct answers award nothing', async () => {
  const { token } = await signUp();
  const [c] = await makeChallenges();
  const wrong = await submit(token, c.id, 0).expect(200);
  assert.equal(wrong.body.correct, false);
  assert.equal(wrong.body.xpAwarded, 0);
  const first = await submit(token, c.id, 2).expect(200);
  assert.equal(first.body.correct, true);
  assert.equal(first.body.xpAwarded, 10);
  const again = await submit(token, c.id, 2).expect(200);
  assert.equal(again.body.xpAwarded, 0);
  assert.equal(again.body.totalXp, 10);
});

test('parallel correct submissions cannot double-award XP', async () => {
  const { token, id } = await signUp();
  const [c] = await makeChallenges(1, { xpReward: 30 });
  const results = await Promise.all(Array.from({ length: 12 }, () => submit(token, c.id, 2)));
  for (const r of results) assert.equal(r.status, 200);
  const awarded = results.filter((r) => r.body.xpAwarded > 0);
  assert.equal(awarded.length, 1);
  assert.equal((await models.User.findById(id)).xp, 30);
  assert.equal(await models.Attempt.countDocuments({ user: id, challenge: c.id, xpAwarded: { $gt: 0 } }), 1);
  assert.equal(await models.Attempt.countDocuments({ user: id, challenge: c.id }), 12);
});

test('invalid answers are rejected and never stored', async () => {
  const { token, id } = await signUp();
  const [c] = await makeChallenges();
  for (const answer of [null, '', false, [], '2', 4, -1, 1.5]) await submit(token, c.id, answer).expect(400);
  assert.equal(await models.Attempt.countDocuments({ user: id }), 0);
});

test('challenge detail never exposes the answer key, solution or hint text', async () => {
  const { token } = await signUp();
  const [c] = await makeChallenges();
  const res = await authed(request(app).get(`/api/challenges/${c.id}`), token).expect(200);
  const body = JSON.stringify(res.body);
  assert.equal(res.body.challenge.hintCount, 2);
  for (const secret of ['correctIndex', 'correctedCode', 'explanation', 'hint one', 'hint two', 'because']) {
    assert.ok(!body.includes(secret), `leaked ${secret}`);
  }
});

test('hints are revealed one at a time and usage is capped at the hint count', async () => {
  const { token, id } = await signUp();
  const [c] = await makeChallenges();
  const hint = () => authed(request(app).post(`/api/challenges/${c.id}/hint`), token).expect(200);
  assert.deepEqual((await hint()).body, { hint: 'hint one', hintsUsed: 1 });
  assert.deepEqual((await hint()).body, { hint: 'hint two', hintsUsed: 2 });
  assert.deepEqual((await hint()).body, { hint: 'hint two', hintsUsed: 2 });
  assert.equal((await models.HintUsage.findOne({ user: id, challenge: c.id })).count, 2);
  const [noHints] = await makeChallenges(1, { title: 'No hints', hints: [] });
  await authed(request(app).post(`/api/challenges/${noHints.id}/hint`), token).expect(404);
});

test('hints used so far are copied into the attempt record', async () => {
  const { token, id } = await signUp();
  const [c] = await makeChallenges();
  await authed(request(app).post(`/api/challenges/${c.id}/hint`), token).expect(200);
  await submit(token, c.id, 2).expect(200);
  assert.equal((await models.Attempt.findOne({ user: id })).hintsUsed, 1);
});

test('challenge list: limit and page are sanitised and total is reported', async () => {
  const { token } = await signUp();
  await makeChallenges(5);
  const list = (qs) => authed(request(app).get(`/api/challenges?${qs}`), token).expect(200);
  assert.equal((await list('limit=0')).body.items.length, 5);
  assert.equal((await list('limit=abc&page=xyz')).body.items.length, 5);
  assert.equal((await list('limit=-3')).body.items.length, 5);
  const page2 = (await list('limit=2&page=2')).body;
  assert.equal(page2.items.length, 2);
  assert.equal(page2.total, 5);
  assert.equal(page2.page, 2);
  assert.equal((await list('limit=500')).body.limit, 50);
});

test('default page size lists every challenge (up to 50)', async () => {
  const { token } = await signUp();
  await makeChallenges(30);
  const res = await authed(request(app).get('/api/challenges'), token).expect(200);
  assert.equal(res.body.items.length, 30);
  assert.equal(res.body.total, 30);
});

test('solved filter is applied before pagination', async () => {
  const { token } = await signUp();
  const cs = await makeChallenges(6);
  for (const c of cs.slice(0, 3)) await submit(token, c.id, 2).expect(200);
  const solved = (await authed(request(app).get('/api/challenges?solved=true&limit=2&page=2'), token).expect(200)).body;
  assert.equal(solved.total, 3);
  assert.equal(solved.items.length, 1);
  assert.ok(solved.items.every((i) => i.solved));
  const unsolved = (await authed(request(app).get('/api/challenges?solved=false&limit=2'), token).expect(200)).body;
  assert.equal(unsolved.total, 3);
  assert.equal(unsolved.items.length, 2);
  assert.ok(unsolved.items.every((i) => !i.solved));
});

test('search treats user input literally, not as a regular expression', async () => {
  const { token } = await signUp();
  await makeChallenges(1, { title: 'C++ Operators: use modulo' });
  await makeChallenges(1, { title: 'Python Lists: last item' });
  const find = async (s) => (await authed(request(app).get('/api/challenges').query({ search: s }), token).expect(200)).body.items;
  assert.equal((await find('C++')).length, 1);
  assert.equal((await find('(')).length, 0);
  assert.equal((await find('.*')).length, 0);
  assert.equal((await find('(a+)+$')).length, 0);
  assert.equal((await find('last')).length, 1);
});

test('"10 Challenges Completed" needs ten distinct solved challenges, not ten correct attempts', async () => {
  const { token } = await signUp();
  await models.Achievement.insertMany([
    { key: 'first', name: 'First' }, { key: 'ten', name: 'Ten' }, { key: 'perfect', name: 'Perfect' }, { key: 'python', name: 'Py' },
  ]);
  const cs = await makeChallenges(10);
  let last;
  for (let i = 0; i < 12; i++) last = await submit(token, cs[0].id, 2).expect(200);
  const names = async () => (await authed(request(app).get('/api/achievements/me'), token).expect(200)).body.items.map((u) => u.achievement.key);
  const afterRepeats = await names();
  assert.ok(afterRepeats.includes('first'));
  assert.ok(!afterRepeats.includes('ten'));
  assert.ok(!afterRepeats.includes('perfect'));
  for (const c of cs.slice(1)) last = await submit(token, c.id, 2).expect(200);
  const final = await names();
  assert.ok(final.includes('ten'));
  assert.ok(final.includes('perfect'));
  assert.ok(Array.isArray(last.body.achievements));
});

test('achievements are not unlocked twice', async () => {
  const { token, id } = await signUp();
  await models.Achievement.create({ key: 'first', name: 'First' });
  const [c] = await makeChallenges();
  const a = await submit(token, c.id, 2).expect(200);
  const b = await submit(token, c.id, 2).expect(200);
  assert.deepEqual(a.body.achievements, ['First']);
  assert.deepEqual(b.body.achievements, []);
  assert.equal(await models.UserAchievement.countDocuments({ user: id }), 1);
});

test('streak advances once per day, resets after a gap, and dashboard does not show a stale streak', async () => {
  const { token, id } = await signUp();
  const [c] = await makeChallenges();
  await submit(token, c.id, 0).expect(200);
  await submit(token, c.id, 0).expect(200);
  assert.equal((await models.User.findById(id)).streak, 1);

  const day = 86400000;
  await models.User.updateOne({ _id: id }, { $set: { lastActivityDate: new Date(Date.now() - day), streak: 4 } });
  await submit(token, c.id, 0).expect(200);
  assert.equal((await models.User.findById(id)).streak, 5);

  await models.User.updateOne({ _id: id }, { $set: { lastActivityDate: new Date(Date.now() - 3 * day), streak: 9 } });
  const dash = await authed(request(app).get('/api/dashboard'), token).expect(200);
  assert.equal(dash.body.user.streak, 0);
  await submit(token, c.id, 0).expect(200);
  assert.equal((await models.User.findById(id)).streak, 1);
});

test('dashboard recommendations expose only public challenge fields', async () => {
  const { token } = await signUp();
  const cs = await makeChallenges(5);
  await submit(token, cs[0].id, 2).expect(200);
  const res = await authed(request(app).get('/api/dashboard'), token).expect(200);
  assert.equal(res.body.completed, 1);
  assert.equal(res.body.recommended.length, 4);
  for (const r of res.body.recommended) {
    assert.ok(r.id);
    assert.notEqual(r.id, cs[0].id);
    for (const key of ['hints', 'options', 'buggyCode', 'correctIndex']) assert.ok(!(key in r), `leaked ${key}`);
  }
});

test('leaderboard ranks by XP and counts distinct solved challenges', async () => {
  const a = await signUp();
  const b = await signUp();
  const cs = await makeChallenges(3, { xpReward: 10 });
  for (const c of cs) await submit(a.token, c.id, 2).expect(200);
  for (let i = 0; i < 4; i++) await submit(b.token, cs[0].id, 2).expect(200);
  const res = await authed(request(app).get('/api/leaderboard'), b.token).expect(200);
  assert.deepEqual(res.body.items.map((r) => [r.id, r.rank, r.xp, r.solved, r.me]), [
    [a.id, 1, 30, 3, false],
    [b.id, 2, 10, 1, true],
  ]);
});

test('progress aggregates attempts by language and flags weak topics', async () => {
  const { token } = await signUp();
  const [c] = await makeChallenges(1, { topic: 'Recursion' });
  for (let i = 0; i < 3; i++) await submit(token, c.id, 0).expect(200);
  await submit(token, c.id, 2).expect(200);
  const res = await authed(request(app).get('/api/progress'), token).expect(200);
  assert.equal(res.body.accuracy, 25);
  assert.equal(res.body.solved, 1);
  assert.deepEqual(res.body.byLanguage.Python, { attempts: 4, correct: 1 });
  assert.equal(res.body.weakTopics[0].topic, 'Recursion');
});

test('admin access is checked against the database role, not only the token', async () => {
  const admin = await signUp('admin');
  await authed(request(app).get('/api/admin/stats'), admin.token).expect(200);
  await models.User.updateOne({ _id: admin.id }, { $set: { role: 'user' } });
  await authed(request(app).get('/api/admin/stats'), admin.token).expect(403);
  const user = await signUp();
  await authed(request(app).get('/api/admin/users'), user.token).expect(403);
});

test('account lifecycle: duplicate email, wrong password, profile and password change', async () => {
  const u = await signUp();
  await request(app).post('/api/auth/register').send({ name: 'Dup', email: u.email.toUpperCase(), password: 'another-password' }).expect(409);
  await request(app).post('/api/auth/login').send({ email: u.email, password: 'nope-nope-nope' }).expect(401);
  await request(app).post('/api/auth/login').send({ email: 'ghost@example.com', password: 'nope-nope-nope' }).expect(401);
  const profile = await authed(request(app).patch('/api/profile'), u.token).send({ name: ' New Name ', bio: 'hello', role: 'admin' }).expect(200);
  assert.equal(profile.body.user.name, 'New Name');
  assert.equal(profile.body.user.role, 'user');
  await authed(request(app).patch('/api/profile/password'), u.token).send({ currentPassword: 'wrong', newPassword: 'brand-new-password' }).expect(400);
  await authed(request(app).patch('/api/profile/password'), u.token).send({ currentPassword: u.password, newPassword: 'brand-new-password' }).expect(200);
  await request(app).post('/api/auth/login').send({ email: u.email, password: 'brand-new-password' }).expect(200);
  await request(app).post('/api/auth/login').send({ email: u.email, password: u.password }).expect(401);
});

test('seed script is idempotent, loads 30 challenges and refreshes option order', () => {
  const run = () => spawnSync(process.execPath, [seedScript], {
    env: { ...process.env, MONGODB_URI: process.env.MONGODB_URI, JWT_SECRET: process.env.JWT_SECRET },
    encoding: 'utf8',
  });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /30 challenges/);
});

test('seeded database has 30 challenges with varied correct positions and answer-key consistency', async () => {
  await models.Challenge.deleteMany({});
  // Simulate a database seeded by the old code (answer always first), then re-seed.
  await models.Challenge.collection.insertMany(seedRows.map((r) => ({ ...r, options: [r.correctedCode, 'w1', 'w2', 'w3'], correctIndex: 0 })));
  const seed = spawnSync(process.execPath, [seedScript], { env: { ...process.env }, encoding: 'utf8' });
  assert.equal(seed.status, 0, seed.stderr);
  const rows = await models.Challenge.find({}).select('+correctIndex +correctedCode');
  assert.equal(rows.length, 30);
  assert.equal(new Set(rows.map((r) => r.correctIndex)).size, 4);
  for (const r of rows) assert.equal(r.options[r.correctIndex], r.correctedCode);
});
