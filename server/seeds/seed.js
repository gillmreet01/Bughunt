const { getConfig, connectDatabase } = require('../config/env');
const { Challenge, Achievement } = require('../models');
const challenges = require('./challenges');

const achievements = [
  ['first', 'First Bug Fixed', 'Solve your first challenge', 'bug'],
  ['ten', '10 Challenges Completed', 'Complete ten distinct challenges', 'star'],
  ['perfect', 'Perfect Accuracy', 'Solve three challenges without an incorrect answer', 'target'],
  ['python', 'Python Beginner', 'Solve a Python challenge', 'python'],
  ['java', 'Java Explorer', 'Solve a Java challenge', 'java'],
  ['cpp', 'C++ Challenger', 'Solve a C++ challenge', 'cpp'],
];

async function seed() {
  const config = getConfig();
  await connectDatabase(config);
  try {
    for (const challenge of challenges) {
      await Challenge.updateOne(
        { title: challenge.title, language: challenge.language },
        { $setOnInsert: challenge },
        { upsert: true },
      );
    }
    for (const [key, name, description, icon] of achievements) {
      await Achievement.updateOne(
        { key },
        { $setOnInsert: { key, name, description, icon } },
        { upsert: true },
      );
    }
    console.log(`Seed complete: ${challenges.length} challenges and ${achievements.length} achievements.`);
  } finally {
    await require('mongoose').disconnect();
  }
}

if (require.main === module) {
  seed().catch((error) => {
    console.error(`BugHunt seed error: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { seed };
