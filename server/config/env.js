const path = require('path');
const dotenv = require('dotenv');
const dns = require('node:dns');
const net = require('node:net');

// Resolve from this file, not process.cwd(), so `npm run` works from any directory.
const projectRoot = path.resolve(__dirname, '..', '..');
const envPath = path.join(projectRoot, '.env');
dotenv.config({ path: envPath });

function getConfig() {
  const missing = ['MONGODB_URI', 'JWT_SECRET'].filter((key) => {
    const value = process.env[key];
    return typeof value !== 'string' || value.trim() === '' || value.startsWith('replace-with-');
  });

  if (missing.length) {
    throw new Error(
      `Missing required environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. ` +
      `Create ${envPath} from .env.example and set these values.`,
    );
  }

  const mongoDnsServers = (process.env.MONGODB_DNS_SERVERS || '')
    .split(',')
    .map((server) => server.trim())
    .filter(Boolean);
  if (mongoDnsServers.some((server) => net.isIP(server) === 0)) {
    throw new Error('MONGODB_DNS_SERVERS must be a comma-separated list of DNS server IP addresses.');
  }

  const configuredTimezone = process.env.TZ || 'Asia/Kolkata';
  let timezone = configuredTimezone;
  let timezoneInvalid = false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: configuredTimezone });
  } catch {
    timezone = 'Asia/Kolkata';
    timezoneInvalid = true;
  }

  return {
    port: Number(process.env.PORT) || 3000,
    mongodbUri: process.env.MONGODB_URI.trim(),
    jwtSecret: process.env.JWT_SECRET,
    clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:3000',
    timezone,
    timezoneInvalid,
    mongoDnsServers,
  };
}

function configureMongoDns(config) {
  if (config.mongoDnsServers?.length) dns.setServers(config.mongoDnsServers);
}

async function connectDatabase(config = getConfig()) {
  const mongoose = require('mongoose');
  try {
    configureMongoDns(config);
    await mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: 8000 });
  } catch (error) {
    // Classify using driver metadata only; never forward the raw error or URI.
    throw new Error(diagnoseMongoError(error));
  }
}

function collectDriverErrors(root) {
  const found = [];
  const seen = new Set();
  const visit = (value, depth = 0) => {
    if (!value || depth > 8 || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) return;
    seen.add(value);
    found.push(value);
    for (const key of ['cause', 'reason', 'error', 'originalError', 'err', 'errors']) {
      try {
        const child = value[key];
        if (Array.isArray(child)) child.forEach((item) => visit(item, depth + 1));
        else visit(child, depth + 1);
      } catch {}
    }
    // MongoDB's topology error keeps per-host errors in a Map.
    try {
      if (value.servers instanceof Map) {
        for (const server of value.servers.values()) visit(server, depth + 1);
      }
    } catch {}
  };
  visit(root);
  return found;
}

function diagnoseMongoError(error) {
  const errors = collectDriverErrors(error);
  const codes = errors.map((item) => String(item.code || '')).join(' ');
  const names = errors.map((item) => String(item.name || '')).join(' ');
  const codeNames = errors.map((item) => String(item.codeName || '')).join(' ');
  const messages = errors.map((item) => String(item.message || '')).join(' ');
  const details = `${codes} ${names} ${codeNames} ${messages}`;

  if (/MongoParseError|MongoInvalidArgumentError|Invalid scheme|Invalid URL|URI malformed|must be a string/i.test(details)) {
    return 'MongoDB connection string is invalid. Check that MONGODB_URI is a complete mongodb:// or mongodb+srv:// URI, with reserved username/password characters URL-encoded.';
  }
  if (/AuthenticationFailed|codeName.*Authentication|(^|\s)18(\s|$)|authentication failed|auth failed|bad auth|SCRAM.*failed|not authorized/i.test(details)) {
    return 'MongoDB authentication failed. Check the database username and password in your MongoDB provider; URL-encode reserved characters. Do not paste the URI into chat or logs.';
  }
  if (/IP address.*(not allowed|blocked)|not in (the )?(IP )?(access|allow) list|IP access list|whitelist|white.?list restriction|network access denied/i.test(details)) {
    return 'MongoDB network access was denied. In Atlas, add this machine’s current public IP to Network Access; for local MongoDB, check bind address and firewall rules.';
  }
  if (/(querySrv|resolveSrv).*(ECONNREFUSED|EAI_AGAIN)|(ECONNREFUSED|EAI_AGAIN).*(querySrv|resolveSrv)/i.test(details)) {
    return 'The configured DNS resolver refused the MongoDB SRV lookup. Check MONGODB_DNS_SERVERS or the Windows adapter DNS settings, and ensure the resolver permits both SRV and TXT queries.';
  }
  if (/ENOTFOUND|EAI_AGAIN|ENODATA|ESERVFAIL|querySrv|resolveSrv|getaddrinfo|DNS lookup|DNS name/i.test(details)) {
    return 'MongoDB DNS/SRV lookup failed. Check the Atlas cluster hostname in MONGODB_URI, DNS connectivity, and whether your network permits SRV lookups.';
  }
  if (/ETIMEDOUT|timed out|timeout|server selection/i.test(details)) {
    return 'MongoDB connection timed out. Check that the database is running and reachable; for Atlas, verify Network Access IP allow-list and outbound firewall access.';
  }
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|MongoNetworkError/i.test(details)) {
    return 'MongoDB host is unreachable or refused the connection. Check the local service/port or Atlas availability, Network Access, and firewall settings.';
  }
  return 'MongoDB connection failed for an unclassified reason. Check MONGODB_URI format, database availability, credentials, DNS, and network access. Sensitive connection details were omitted.';
}

module.exports = { envPath, projectRoot, getConfig, configureMongoDns, connectDatabase, diagnoseMongoError };
