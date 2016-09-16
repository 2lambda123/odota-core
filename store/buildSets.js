/**
 * Function to build/cache sets of players
 **/
var async = require('async');
var moment = require('moment');
var config = require('../config');
module.exports = function buildSets(db, redis, cb)
{
    console.log("rebuilding sets");
    async.parallel(
    {
        //users in this set are added to the trackedPlayers set
        "donators": function (cb)
        {
            db.select(['account_id']).from('players').where('cheese', '>', 0).asCallback(function (err, docs)
            {
                if (err)
                {
                    return cb(err);
                }
                docs.forEach(function (player)
                {
                    // Refresh donators with expire date in the future
                    redis.zadd('tracked', moment().add(1, 'month').format('X'), player.account_id);
                });
                cb(err);
            });
        }
    }, function (err, result)
    {
        if (err)
        {
            console.log('error occurred during buildSets: %s', err);
            return cb(err);
        }
        // Remove inactive players from tracked set
        redis.zremrangebyscore('tracked', 0, moment().subtract(config.UNTRACK_DAYS, 'days').format('X'));
        return cb(err);
    });
};