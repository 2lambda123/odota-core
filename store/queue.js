/**
 * Provides methods for working with the job queue
 **/
const generateJob = require('../util/utility').generateJob;
const config = require('../config');
const bull = require('bull');
const url = require('url');
const async = require('async');
const types = ['request', 'mmr', 'parse', 'cache', 'fullhistory'];
// parse the url
const conn_info = url.parse(config.REDIS_URL, true /* parse query string */);
if (conn_info.protocol !== 'redis:')
{
  throw new Error('connection string must use the redis: protocol');
}
const options = {
  port: conn_info.port || 6379,
  host: conn_info.hostname,
  options: conn_info.query,
};
if (conn_info.auth)
{
  options.redis.auth = conn_info.auth.replace(/.*?:/, '');
}

function generateKey(type, state)
{
  return ['bull', type, state].join(':');
}

function getQueue(type)
{
  return bull(type, options.port, options.host);
}

function addToQueue(queue, payload, options, cb)
{
  const job = generateJob(queue.name, payload);
  options.attempts = options.attempts || 15;
  options.backoff = options.backoff ||
    {
      delay: 60 * 1000,
      type: 'exponential',
    };
  queue.add(job, options).then((queuejob) => {
        // console.log("created %s jobId: %s", queue.name, queuejob.jobId);
    cb(null, queuejob);
  }).catch(cb);
}

function getCounts(redis, cb)
{
  async.map(types, getQueueCounts, (err, result) => {
    const obj = {};
    result.forEach((r, i) => {
      obj[types[i]] = r;
    });
    cb(err, obj);
  });

  function getQueueCounts(type, cb)
    {
    async.series(
      {
        'wait': function (cb)
            {
          redis.llen(generateKey(type, 'wait'), cb);
        },
        'act': function (cb)
            {
          redis.llen(generateKey(type, 'active'), cb);
        },
        'del': function (cb)
            {
          redis.zcard(generateKey(type, 'delayed'), cb);
        },
        'comp': function (cb)
            {
          redis.scard(generateKey(type, 'completed'), cb);
        },
        'fail': function (cb)
            {
          redis.scard(generateKey(type, 'failed'), cb);
        },
      }, cb);
  }
}

function cleanup(redis, cb)
{
  async.each(types, (key, cb) => {
    const queue = getQueue(key);
    async.each(['active', 'completed', 'failed', 'delayed'], (type, cb) => {
      queue.clean(24 * 60 * 60 * 1000, type);
      queue.once('cleaned', (job, type) => {
        console.log('cleaned %s %s jobs from queue %s', job.length, type, key);
        cb();
      });
    }, cb);
  }, cb);
}
module.exports = {
  getQueue,
  addToQueue,
  getCounts,
  cleanup,
};
