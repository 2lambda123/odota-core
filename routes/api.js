var express = require('express');
var async = require('async');
var api = express.Router();
var constants = require('../constants');
var config = require('../config');
var request = require('request');
var rc_secret = config.RECAPTCHA_SECRET_KEY;
var multer = require('multer')(
{
    inMemory: true,
    fileSize: 100 * 1024 * 1024, // no larger than 100mb
});
var queue = require('../store/queue');
var rQueue = queue.getQueue('request');
var queries = require('../store/queries');
var buildMatch = require('../store/buildMatch');
var buildPlayer = require('../store/buildPlayer');
var buildStatus = require('../store/buildStatus');
var playerCache = require('../store/playerCache');
var readCache = playerCache.readCache;
const crypto = require('crypto');
module.exports = function(db, redis, cassandra)
{
    api.use(function(req, res, cb)
    {
        res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
        res.header('Access-Control-Allow-Credentials', 'true');
        cb();
    });
    api.get('/constants', function(req, res, cb)
    {
        res.header('Cache-Control', 'max-age=604800, public');
        res.json(constants);
    });
    api.get('/metadata', function(req, res, cb)
    {
        async.parallel(
        {
            banner: function(cb)
            {
                redis.get("banner", cb);
            },
            cheese: function(cb)
            {
                redis.get("cheese_goal", function(err, result)
                {
                    return cb(err,
                    {
                        cheese: result,
                        goal: config.GOAL
                    });
                });
            },
            user: function(cb)
            {
                cb(null, req.user);
            },
        }, function(err, result)
        {
            if (err)
            {
                return cb(err);
            }
            res.json(result);
        });
    });
    api.get('/items', function(req, res)
    {
        res.json(constants.items[req.query.name]);
    });
    api.get('/abilities', function(req, res)
    {
        res.json(constants.abilities[req.query.name]);
    });
    api.get('/matches/:match_id/:info?', function(req, res, cb)
    {
        buildMatch(
        {
            db: db,
            redis: redis,
            cassandra: cassandra,
            match_id: req.params.match_id
        }, function(err, match)
        {
            if (err)
            {
                return cb(err);
            }
            if (!match)
            {
                return cb();
            }
            res.json(match);
        });
    });
    api.get('/players/:account_id/:info?/:subkey?', function(req, res, cb)
    {
        buildPlayer(
        {
            db: db,
            redis: redis,
            cassandra: cassandra,
            account_id: req.params.account_id,
            info: req.params.info,
            subkey: req.params.subkey,
            query: req.query
        }, function(err, player)
        {
            if (err)
            {
                return cb(err);
            }
            if (!player)
            {
                return cb();
            }
            res.json(player);
        });
    });
    /*
    api.get('/player_matches/:account_id', function(req, res, cb)
    {
        readCache(req.params.account_id,
        {
            cacheProject: req.query.project || ['match_id'],
        }, function(err, cache)
        {
            if (err)
            {
                return cb(err);
            }
            //TODO fillskill
            res.json(cache.raw);
        });
    });
    */
    api.get('/match_logs/:match_id', function(req, res, cb)
    {
        db.raw(`SELECT * FROM match_logs WHERE match_id = ? ORDER BY time ASC`, [req.params.match_id]).asCallback(function(err, result)
        {
            if (err)
            {
                return cb(err);
            }
            res.json(result.rows);
        });
    });
    api.get('/pro_matches', function(req, res, cb)
    {
        db.raw(`
        SELECT match_id, start_time, duration, ma.leagueid, name
        FROM matches ma
        JOIN leagues le
        ON ma.leagueid = le.leagueid
        WHERE ma.leagueid > 0
        ORDER BY match_id DESC
        `).asCallback(function(err, result)
        {
            if (err)
            {
                return cb(err);
            }
            res.json(result.rows);
        });
    });
    api.get('/leagues', function(req, res, cb)
    {
        db.raw(`SELECT * FROM leagues ORDER BY leagueid`).asCallback(function(err, result)
        {
            if (err)
            {
                return cb(err);
            }
            res.json(result.rows);
        });
    });
    api.get('/distributions', function(req, res, cb)
    {
        queries.getDistributions(redis, function(err, result)
        {
            if (err)
            {
                return cb(err);
            }
            res.json(result);
        });
    });
    api.get('/rankings', function(req, res, cb)
    {
        queries.getHeroRankings(db, redis, req.query.hero_id,
        {}, function(err, result)
        {
            if (err)
            {
                return cb(err);
            }
            res.json(result);
        });
    });
    api.get('/benchmarks', function(req, res, cb)
    {
        queries.getBenchmarks(db, redis,
        {
            hero_id: req.query.hero_id
        }, function(err, result)
        {
            if (err)
            {
                return cb(err);
            }
            res.json(result);
        });
    });
    api.get('/status', function(req, res, cb)
    {
        buildStatus(db, redis, function(err, status)
        {
            if (err)
            {
                return cb(err);
            }
            res.json(status);
        });
    });
    api.get('/search', function(req, res, cb)
    {
        if (!req.query.q)
        {
            return cb(400);
        }
        queries.searchPlayer(db, req.query.q, function(err, result)
        {
            if (err)
            {
                return cb(err);
            }
            res.json(result);
        });
    });
    api.get('/health/:metric?', function(req, res, cb)
    {
        redis.hgetall('health', function(err, result)
        {
            if (err)
            {
                return cb(err);
            }
            for (var key in result)
            {
                result[key] = JSON.parse(result[key]);
            }
            if (!req.params.metric)
            {
                res.json(result);
            }
            else
            {
                var single = result[req.params.metric];
                var healthy = single.metric < single.threshold;
                res.status(healthy ? 200 : 500).json(single);
            }
        });
    });
    api.post('/request_job', multer.single("replay_blob"), function(req, res, next)
    {
        request.post("https://www.google.com/recaptcha/api/siteverify",
        {
            form:
            {
                secret: rc_secret,
                response: req.body.response
            }
        }, function(err, resp, body)
        {
            if (err)
            {
                return next(err);
            }
            try
            {
                body = JSON.parse(body);
            }
            catch (err)
            {
                return res.render(
                {
                    error: err
                });
            }
            var match_id = Number(req.body.match_id);
            var match;
            if (!body.success && config.ENABLE_RECAPTCHA && !req.file)
            {
                console.log('failed recaptcha');
                return res.json(
                {
                    error: "Recaptcha Failed!"
                });
            }
            else if (req.file)
            {
                console.log(req.file);
                //var key = req.file.originalname + Date.now();
                //var key = Math.random().toString(16).slice(2);
                const hash = crypto.createHash('md5');
                hash.update(req.file.buffer);
                var key = hash.digest('hex');
                redis.setex(new Buffer('upload_blob:' + key), 60 * 60, req.file.buffer);
                match = {
                    replay_blob_key: key
                };
            }
            else if (match_id && !Number.isNaN(match_id))
            {
                match = {
                    match_id: match_id
                };
            }
            if (match)
            {
                console.log(match);
                queue.addToQueue(rQueue, match,
                {
                    attempts: 1
                }, function(err, job)
                {
                    res.json(
                    {
                        error: err,
                        job:
                        {
                            jobId: job.jobId,
                            data: job.data
                        }
                    });
                });
            }
            else
            {
                res.json(
                {
                    error: "Invalid input."
                });
            }
        });
    });
    api.get('/request_job', function(req, res, cb)
    {
        rQueue.getJob(req.query.id).then(function(job)
        {
            if (job)
            {
                job.getState().then(function(state)
                {
                    return res.json(
                    {
                        jobId: job.jobId,
                        data: job.data,
                        state: state,
                        progress: job.progress()
                    });
                }).catch(cb);
            }
            else
            {
                res.json(
                {
                    state: "failed"
                });
            }
        }).catch(cb);
    });
    //TODO implement
    api.get('/picks/:n');
    //TODO @albertcui owns mmstats
    api.get('/mmstats');
    return api;
};
