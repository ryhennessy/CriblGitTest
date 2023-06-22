const cLogger = C.util.getLogger('func:dns_lookup');
const { NestedPropertyAccessor } = C.expr;
const NodeCache = C.internal.NodeCache;

const NOOP = () => {};

const dns = require('dns').promises;
const net = require('net');
exports.name = 'DNS Lookup';
exports.version = '0.1';
exports.group = 'Standard';

// Cache
let _cache;
const CACHE_MAX_SIZE = 10000;

// Input to Output field mappings:
let _reverseLookupFields = [];
let _dnsLookupFields = [];

// Overrides to global DNS
let _dnsServers;
let _dnsResolver;

// Used to throttle error logging.
let numErrors = 0;
const ERROR_THRESHOLD = 1000;

exports.init = (opts) => {
  const conf = opts.conf || {};
  conf.dnsLookupFields = conf.dnsLookupFields || [];
  conf.reverseLookupFields = conf.reverseLookupFields || [];
  if (!conf.dnsLookupFields.length && !conf.reverseLookupFields.length) {
    throw new Error('Invalid arguments - Must specify at least 1 field to lookup!', conf);
  }

  _dnsResolver = dns;
  _dnsServers = conf.dnsServers || [];
  if (_dnsServers.length) {
    try {
      _dnsResolver = new dns.Resolver();
      _dnsResolver.setServers(_dnsServers);
      cLogger.info('Using DNS overrides.', { dnsServers: _dnsServers });
    } catch (err) {
      cLogger.error('Invalid DNS override(s)', { dnsServers: conf.dnsServers, err });
      throw new Error(
        'Invalid arguments - DNS overrides contain one or more invalid IP addresses! Check the logs for more details.',
        conf
      );
    }
  }

  setUpFields(conf.reverseLookupFields, _reverseLookupFields);
  setUpFields(conf.dnsLookupFields, _dnsLookupFields, true);

  conf.maxCacheSize = Number(conf.maxCacheSize);
  conf.maxCacheSize = Number.isNaN(conf.maxCacheSize) ? 5000 : conf.maxCacheSize;
  if (conf.maxCacheSize > CACHE_MAX_SIZE)
    throw new Error(`Invalid argument - Max cache size allowed is ${CACHE_MAX_SIZE}`, conf);
  conf.cacheTTL = Number(conf.cacheTTL);
  conf.cacheTTL = Number.isNaN(conf.cacheTTL) ? 30 : conf.cacheTTL;
  if (conf.cacheTTL > 0) {
    _cache = new NodeCache({
      stdTTL: conf.cacheTTL * 60,
      checkperiod: 600,
      useClones: false,
      maxKeys: conf.maxCacheSize,
    });
  }
};

exports.process = (event) => {
  const promises = [];
  promises.push(...reverseDnsLookup(event));
  promises.push(...dnsLookup(event));
  return Promise.all(promises).then(() => event);
};

exports.unload = () => {
  _cache = undefined;
  _dnsLookupFields = [];
  _reverseLookupFields = [];
  _dnsServers = undefined;
  _dnsResolver = undefined;
};

function getDnsResolver() {
  return _dnsResolver;
}

const reverseFn = (_ip) => getDnsResolver().reverse(_ip);
function reverseDnsLookup(event) {
  const results = [];
  for (let i = 0; i < _reverseLookupFields.length; i++) {
    const [inputField, outputField] = _reverseLookupFields[i];
    const ip = (inputField.get(event) || '').trim();
    if (net.isIP(ip)) {
      const key = `ip_${ip}`;
      const p = resolve(key, reverseFn, [ip])
        .then((val) => {
          if (val !== null) outputField.set(event, val);
        })
        .catch(NOOP);
      results.push(p);
    }
  }
  return results;
}

const lookupFn = (_dns, _rrt) => {
  return getDnsResolver()
    .resolve(_dns, _rrt)
    .then((records) => {
      // special treatment for ANY records
      if (_rrt !== 'ANY') return records;
      if (!Array.isArray(records)) return records;
      if (records.length === 1) return records;

      const _rec = {};
      for (let x = 0; x < records.length; x++) {
        const { type, ...rest } = records[x];
        if (!_rec[type]) _rec[type] = rest;
        else if (Array.isArray(_rec[type])) _rec[type].push(rest);
        else _rec[type] = [_rec[type], rest];
      }
      return _rec;
    });
};

function dnsLookup(event) {
  const results = [];
  for (let i = 0; i < _dnsLookupFields.length; i++) {
    const [inputField, outputField, resourceRecordType] = _dnsLookupFields[i];
    const domain = (inputField.get(event) || '').trim();
    if (!net.isIP(domain)) {
      const key = `dns_${domain}_${resourceRecordType}`;
      const p = resolve(key, lookupFn, [domain, resourceRecordType])
        .then((val) => {
          if (val !== null) outputField.set(event, val);
        })
        .catch(NOOP);
      results.push(p);
    }
  }
  return results;
}

const CACHE_THRESHOLD = 5000;
async function resolve(cacheKey, pullFn, args) {
  if (_cache) {
    const cached = _cache.get(cacheKey);
    if ((_cache.stats.hits + _cache.stats.misses) % CACHE_THRESHOLD === 0) {
      cLogger.debug('Cache stats', _cache.getStats());
    }
    if (cached) return cached;
  }
  const p = new Promise((res) => {
    const start = Date.now();
    pullFn(...args)
      .then((result) => {
        if (Array.isArray(result) && result.length === 1) result = result[0];
        res(result);
      })
      .catch((err) => {
        handleErorr(err, { args });
        res(null);
      })
      .finally(() => cLogger.debug(`dns took ${Date.now() - start}`, { args }));
  });
  if (_cache) _cache.set(cacheKey, p);
  return p;
}

const handleErorr = (error, info) => {
  if (numErrors++ % ERROR_THRESHOLD) {
    cLogger.error('DNS Lookup error', { error, ...info });
  }
};

function setUpFields(source, dest, withDnsRecords) {
  for (let i = 0; i < source.length; i++) {
    const field = source[i];
    const { inFieldName, outFieldName, resourceRecordType } = field;
    if (inFieldName && inFieldName.length) {
      const outputField = outFieldName && outFieldName.length ? outFieldName : inFieldName;
      const fields = [new NestedPropertyAccessor(inFieldName), new NestedPropertyAccessor(outputField)];
      if (withDnsRecords) fields.push(resourceRecordType || 'A');
      dest.push(fields);
    }
  }
}

if (process.env.NODE_ENV === 'test') {
  // For unit test
  exports.getDnsCache = () => _cache;
  exports.getDnsResolver = getDnsResolver;
}
