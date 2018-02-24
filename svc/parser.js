/**
 * Worker that parses replays
 * The actual parsing is done by invoking the Java-based parser.
 * This produces an event stream (newline-delimited JSON)
 * Stream is run through a series of processors to count/aggregate it into a single object
 * This object is passed to insertMatch to persist the data into the database.
 * */
const utility = require('../util/utility');
const getGcData = require('../util/getGcData');
const config = require('../config');
const queue = require('../store/queue');
const queries = require('../store/queries');
const cp = require('child_process');
const async = require('async');
const numCPUs = require('os').cpus().length;
const redis = require('../store/redis');

const insertMatch = queries.insertMatch;
const buildReplayUrl = utility.buildReplayUrl;

function runParse(match, job, cb) {
  let url = match.url;
  if (config.NODE_ENV === 'test') {
    url = `https://cdn.rawgit.com/odota/testfiles/master/${match.match_id}_1.dem`;
  }
  console.log(new Date(), url);
  cp.exec(
    `curl --max-time 180 --fail ${url} | ${url && url.slice(-3) === 'bz2' ? 'bunzip2' : 'cat'} | curl -X POST -T - ${config.PARSER_HOST} | node processors/createParsedDataBlob.js ${match.match_id} ${Boolean(match.doLogParse)}`,
    { shell: true, maxBuffer: 10 * 1024 * 1024 },
    (err, stdout) => {
      if (err) {
        return cb(err);
      }
      const result = Object.assign({}, JSON.parse(stdout), match);
      return insertMatch(result, {
        type: 'parsed',
        skipParse: true,
        doLogParse: match.doLogParse,
      }, cb);
    },
  );
}

function parseProcessor(job, cb) {
  const match = job;
  async.series({
    getDataSource(cb) {
      getGcData(match, (err, result) => {
        if (err) {
          return cb(err);
        }
        match.url = buildReplayUrl(result.match_id, result.cluster, result.replay_salt);
        return cb(err);
      });
    },
    runParse(cb) {
      runParse(match, job, cb);
    },
  }, (err) => {
    if (err) {
      console.error(err.stack || err);
    } else {
      console.log('completed parse of match %s', match.match_id);
      if (match.origin === 'scanner' && match.match_id % 100 < config.SCENARIOS_SAMPLE_PERCENT) {
        redis.lpush('scenariosQueue', match.match_id);
      }
    }
    return cb(err, match.match_id);
  });
}

queue.runReliableQueue('parse', Number(config.PARSER_PARALLELISM) || numCPUs, parseProcessor);
