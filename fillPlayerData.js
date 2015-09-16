var advQuery = require('./advquery');
var utility = require('./utility');
var generatePositionData = utility.generatePositionData;
var reduceMatch = utility.reduceMatch;
var constants = require('./constants.json');
var queries = require('./queries');
var config = require('./config');
var async = require('async');
var db = require('./db');
var r = require('./redis');
var redis = r.client;
var zlib = require('zlib');
var preprocessQuery = require('./preprocessQuery');
var filter = require('./filter');
var aggregator = require('./aggregator');
module.exports = function fillPlayerData(account_id, options, cb) {
    //options.info, the tab the player is on
    //options.query, the query object to use in advQuery
    var cache;
    var player;
    var cachedTeammates;
    preprocessQuery(options.query);
    console.time("count");
    db.matches.count({
        "players.account_id": Number(account_id)
    }, function(err, match_count) {
        if (err) {
            return cb(err);
        }
        //console.log(match_count);
        console.timeEnd("count");
        db.player_matches.find({
            account_id: account_id
        }, function(err, results) {
            if (err) {
                return cb(err);
            }
            cache = {
                data: results
            };
            //redis.get("player:" + account_id, function(err, result) {
            //cache = result && !err ? JSON.parse(zlib.inflateSync(new Buffer(result, 'base64'))) : null;
            //var cacheValid = cache && Object.keys(cache.data).length===match_count;
            cachedTeammates = cache && cache.aggData ? cache.aggData.teammates : null;
            var cacheValid = cache && cache.data.length === match_count;
            var filter_exists = Object.keys(options.query.js_select).length;
            player = {
                account_id: account_id,
                personaname: account_id
            };
            /*
            if (cacheValid && !filter_exists) {
                console.log("player cache hit %s", player.account_id);
                //unpack cache.data into an array
                var arr = [];
                for (var key in cache.data) {
                    arr.push(cache.data[key]);
                }
                cache.data = arr;
                processResults(err, {
                    data: cache.data,
                    aggData: cache.aggData,
                    unfiltered: cache.data
                });
            }
            */
            //below code if we want to cache full matches (with parsed data)
            if (cacheValid) {
                console.log("player cache hit %s", player.account_id);
                //cached data should come in ascending match order
                var filtered = filter(cache.data, options.query.js_select);
                cache.aggData = aggregator(filtered, null);
                processResults(err, {
                    data: filtered,
                    aggData: cache.aggData,
                    unfiltered: cache.data
                });
            }
            else {
                console.log("player cache miss %s", player.account_id);
                //convert account id to number and search db with it
                //don't do this if the account id is not a number (all or professional)
                if (!isNaN(Number(account_id))) {
                    options.query.mongo_select["players.account_id"] = Number(account_id);
                    //set a larger limit since we are only getting one player's matches
                    options.query.limit = 20000;
                }
                else {
                    options.query.limit = 200;
                }
                //sort ascending to support trends over time
                options.query.sort = {
                    match_id: 1
                };
                advQuery(options.query, processResults);
            }

            function processResults(err, results) {
                if (err) {
                    return cb(err);
                }
                console.log("results: %s", results.data.length);
                //sort matches by descending match id for display
                results.data.sort(function(a, b) {
                    return b.match_id - a.match_id;
                });
                //reduce matches to only required data for display, also shrinks the data for cache resave
                player.data = results.data.map(reduceMatch);
                player.aggData = results.aggData;
                player.all_teammates = cachedTeammates || player.aggData.teammates;
                //convert heroes hash to array and sort
                var aggData = player.aggData;
                if (aggData.heroes) {
                    var heroes_arr = [];
                    var heroes = aggData.heroes;
                    for (var id in heroes) {
                        var h = heroes[id];
                        heroes_arr.push(h);
                    }
                    heroes_arr.sort(function(a, b) {
                        return b.games - a.games;
                    });
                    player.heroes_list = heroes_arr;
                }
                if (aggData.obs) {
                    //generally position data function is used to generate heatmap data for each player in a natch
                    //we use it here to generate a single heatmap for aggregated counts
                    player.obs = aggData.obs.counts;
                    player.sen = aggData.sen.counts;
                    var d = {
                        "obs": true,
                        "sen": true
                    };
                    generatePositionData(d, player);
                    player.posData = [d];
                }
                getPlayerName(function(err, player) {
                    if (err) {
                        return cb(err);
                    }
                    saveCache(player, cb);
                });

                function getPlayerName(cb) {
                    //get this player's name
                    var playerArr = [player];
                    queries.fillPlayerNames(playerArr, function(err) {
                        var player = playerArr[0];
                        cb(err, player);
                    });
                }

                function saveCache(player, cb) {
                    //save cache
                    if (!cacheValid && Number(player.account_id) !== constants.anonymous_account_id) {
                        //delete unnecessary data from match (parsed_data)
                        results.unfiltered.forEach(reduceMatch);
                        //cache = {data: results.unfiltered};
                        async.each(results.unfiltered, function(match_copy, cb) {
                            //delete _id from the fetched match to prevent conflicts
                            delete match_copy._id;
                            db.player_matches.update({
                                account_id: player.account_id,
                                match_id: match_copy.match_id
                            }, {
                                $set: match_copy
                            }, {
                                upsert: true
                            }, cb);
                        }, function(err){
                            return cb(err, player);
                        });
                    }
                    else {
                        return cb(null, player);
                    }
                    /*
                    if (!cacheValid && !filter_exists && Number(player.account_id) !== constants.anonymous_account_id) {
                        //pack data into hash for cache
                        var match_ids = {};
                        results.data.forEach(function(m) {
                            match_ids[m.match_id] = m;
                        });
                        cache = {
                            data: match_ids,
                            aggData: results.aggData
                        };
                        console.log("saving player cache %s", player.account_id);
                        console.time("deflate");
                        redis.setex("player:" + player.account_id, 60 * 60 * 24 * config.UNTRACK_DAYS, zlib.deflateSync(JSON.stringify(cache)).toString('base64'));
                        console.timeEnd("deflate");
                        return cb(null, player);
                    }
                    */
                }
            }
        });
    });
};
