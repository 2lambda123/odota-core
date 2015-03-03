var utility = require('./utility');
var async = require('async');
var db = require('./db');
var logger = utility.logger;
var fs = require('fs');
var getData = utility.getData;
var request = require('request');
var operations = require('./operations');
var insertPlayer = operations.insertPlayer;
var insertMatch = operations.insertMatch;
var spawn = require('child_process').spawn;
var domain = require('domain');
var JSONStream = require('JSONStream');
var constants = require('./constants.json');
var progress = require('request-progress');
var mode = utility.mode;

function processParse(job, cb) {
    if (job.data.payload.expired) {
        console.log("match expired");
        return cb(null);
    }
    var t1 = new Date();
    var attempts = job.toJSON().attempts.remaining;
    var noRetry = attempts <= 1;
    var d = domain.create();
    var exited;

    function exit(err) {
        if (!exited) {
            exited = true;
            cb(err.message || err);
        }
    }
    d.on('error', exit);
    d.run(function() {
        runParser(job, function(err, parsed_data) {
            var match_id = job.data.payload.match_id || parsed_data.match_id;
            job.data.payload.match_id = match_id;
            job.data.payload.parsed_data = parsed_data;
            if (err && noRetry) {
                logger.info("match_id %s, error %s, not retrying", match_id, err);
                job.data.payload.parse_status = 1;
            }
            else if (err) {
                logger.info("match_id %s, error %s, attempts %s", match_id, err, attempts);
                return cb(err);
            }
            else {
                logger.info("[PARSER] match_id %s, parse time: %s", match_id, (new Date() - t1) / 1000);
                job.data.payload.parse_status = 2;
            }
            job.update();
            db.matches.update({
                match_id: match_id
            }, {
                $set: job.data.payload,
            }, function(err) {
                return cb(err, job.data.payload);
            });
        });
    });
}

function runParser(job, cb) {
    var entries = [];
    var name_to_slot = {};
    var hero_to_slot = {};
    var error = "incomplete";
    var parsed_data = {
        "version": constants.parser_version,
        "game_zero": 0,
        "match_id": 0,
        "players": Array.apply(null, new Array(10)).map(function() {
            return {
                "stuns": -1,
                "lane": -1,
                "gold": [],
                "lh": [],
                "xp": [],
                "pos_log": [],
                "hero_log": [],
                "purchase_log": [],
                "kill_log": [],
                "buyback_log": [],
                "pos": {},
                "obs": {},
                "sen": {},
                "purchase": {},
                "gold_reasons": {},
                "xp_reasons": {},
                "kills": {},
                "item_uses": {},
                "ability_uses": {},
                "hero_hits": {},
                "damage": {},
                "damage_taken": {},
                "runes": {},
                "runes_bottled": {},
                "killed_by": {},
                "modifier_applied": {},
                "modifier_lost": {},
                "healing": {}
            };
        }),
        "times": [],
        "chat": []
    };

    function setParsedData(e) {
        var t = parsed_data[e.type];
        if (typeof t === "undefined") {
            console.log(e);
        }
        else if (t.constructor === Array) {
            t.push(e.value);
        }
        else {
            parsed_data[e.type] = e.value;
        }
    }

    function translate(e) {
        //transform to 0-127 range from 64-191, y=0 at top left from bottom left
        e.key = JSON.parse(e.key);
        e.key = [e.key[0] - 64, 127 - (e.key[1] - 64)];
        entries.push(e);
    }

    function interval(e) {
        e.interval = true;
        populate(e);
    }

    function assocName(name) {
        //given a name (npc_dota_visage_familiar...), tries to convert to the associated hero's name
        if (!name) {
            return;
        }
        else if (name in hero_to_slot) {
            return name;
        }
        else if (name.indexOf("illusion_") === 0) {
            var s = name.slice("illusion_".length);
            return s;
        }
        else if (name.indexOf("npc_dota_") === 0) {
            //split by _
            var split = name.split("_");
            //get the third element
            var identifiers = [split[2], split[2] + "_" + split[3]];
            identifiers.forEach(function(id) {
                //append to npc_dota_hero_, see if matches
                var attempt = "npc_dota_hero_" + id;
                if (attempt in hero_to_slot) {
                    return attempt;
                }
            });
        }
    }

    function getChatSlot(e) {
        e.slot = name_to_slot[e.unit];
        parsed_data.chat.push(e);
    }

    function getSlot(e) {
        //on a reversed field, key should be merged since the unit was damaged/killed by the key or a minion
        //otherwise, unit should be merged since the damage/kill was done by the unit or a minion
        e.reverse ? e.key = assocName(e.key) : e.unit = assocName(e.unit);
        //use slot, then map value (could be undefined)
        e.slot = ("slot" in e) ? e.slot : hero_to_slot[e.unit];
        populate(e);
    }

    function getSlotReverse(e) {
        e.reverse = true;
        getSlot(e);
    }

    function posPopulate(e) {
        var x = e.key[0];
        var y = e.key[1];
        //hash this location
        var h = parsed_data.players[e.slot][e.type];
        if (!h[x]) {
            h[x] = {};
        }
        if (!h[x][y]) {
            h[x][y] = 0;
        }
        h[x][y] += 1;
    }

    function populate(e) {
        if (typeof e.slot === "undefined") {
            //console.log(e);
            //couldn't associate with a player
            return;
        }
        var t = parsed_data.players[e.slot][e.type];
        if (typeof t === "undefined") {
            console.log(e);
        }
        else if (t.constructor === Array) {
            e = (e.interval) ? e.value : {
                time: e.time,
                key: e.key
            };
            t.push(e);
        }
        else if (typeof t === "object") {
            e.value = e.value || 1;
            t[e.key] ? t[e.key] += e.value : t[e.key] = e.value;
        }
        else {
            parsed_data.players[e.slot][e.type] = e.value || Number(e.key);
        }
    }
    var parser = spawn("java", ["-jar",
        "parser/target/stats-0.1.0.jar"
    ], {
        stdio: ['pipe', 'pipe', 'ignore'], //don't handle stderr
        encoding: 'utf8'
    });
    logger.info("[PARSER] streaming from %s", job.data.payload.url || job.data.payload.fileName);
    if (job.data.payload.fileName) {
        fs.createReadStream(job.data.payload.fileName).pipe(parser.stdin);
    }
    else if (job.data.payload.url) {
        var bz = spawn("bunzip2");
        progress(request.get({
            url: job.data.payload.url,
            encoding: null,
            timeout: 30000
        })).on('progress', function(state) {
            job.progress(state.percent, 100);
        }).on('response', function(response) {
            error = (response.statusCode !== 200) ? "download error" : error;
        }).pipe(bz.stdin);
        bz.stdout.pipe(parser.stdin);
    }
    else {
        console.log(job.data);
        return cb("no data");
    }
    var outStream = JSONStream.parse();
    parser.stdout.pipe(outStream);
    outStream.on('root', function preprocess(e) {
        var preTypes = {
            "times": setParsedData,
            "match_id": setParsedData,
            "state": function(e) {
                var states = {
                    "PLAYING": "game_zero"
                };
                e.type = states[e.key];
                setParsedData(e);
            },
            "hero_log": function(e) {
                //get hero by id
                var h = constants.heroes[e.key];
                hero_to_slot[h ? h.name : e.key] = e.slot;
                //push it to entries for hero log
                entries.push(e);
            },
            "name": function(e) {
                name_to_slot[e.key] = e.slot;
            },
            "pos": translate,
            "obs": translate,
            "sen": translate
        };
        if (preTypes[e.type]) {
            preTypes[e.type](e);
        }
        else {
            entries.push(e);
        }
    });
    outStream.on('end', function() {
        entries.forEach(function processEntry(e) {
            var types = {
                "epilogue": function() {
                    error = false;
                },
                "hero_log": populate,
                "gold_reasons": function(e) {
                    if (!constants.gold_reasons[e.key]) {
                        console.log(e);
                    }
                    getSlot(e);
                },
                "xp_reasons": function(e) {
                    if (!constants.xp_reasons[e.key]) {
                        console.log(e);
                    }
                    getSlot(e);
                },
                "purchase": function(e) {
                    getSlot(e);
                    e.type = "purchase_log";
                    populate(e);
                },
                "modifier_applied": getSlot,
                "modifier_lost": getSlot,
                "healing": getSlot,
                "ability_trigger": getSlot,
                "item_uses": getSlot,
                "ability_uses": getSlot,
                "kills": getSlot,
                "damage": getSlot,
                "buyback_log": getSlot,
                "chat": getChatSlot,
                "stuns": populate,
                "runes": populate,
                "runes_bottled": populate,
                "lh": interval,
                "gold": interval,
                "xp": interval,
                "pos": function(e) {
                    posPopulate(e);
                    e.type = "pos_log";
                    populate(e);
                },
                "obs": posPopulate,
                "sen": posPopulate,
                "hero_hits": getSlot,
                "kill_log": getSlot,
                "damage_taken": getSlotReverse,
                "killed_by": getSlotReverse
            };
            e.time -= parsed_data.game_zero;
            if (types[e.type]) {
                types[e.type](e);
            }
            else {
                console.log(e);
            }
        });
        //postprocess
        parsed_data.players.forEach(function(p) {
            var lanes = p.pos_log.filter(function(e) {
                return e.time < 600;
            }).map(function(e) {
                return constants.lanes[e.key[1]][e.key[0]];
            });
            delete p["pos_log"];
            p.lane = mode(lanes);
        });
        cb(error, parsed_data);
    });
}

function processApi(job, cb) {
    //process an api request
    var payload = job.data.payload;
    getData(job.data.url, function(err, data) {
        if (err) {
            //encountered non-retryable error, pass back to kue as the result
            //cb with err causes kue to retry
            return cb(null, {
                error: err
            });
        }
        else if (data.response) {
            logger.info("summaries response");
            async.mapSeries(data.response.players, insertPlayer, function(err) {
                cb(err, data.response.players);
            });
        }
        else if (payload.match_id) {
            logger.info("details response");
            var match = data.result;
            //join payload with match
            for (var prop in payload) {
                match[prop] = (prop in match) ? match[prop] : payload[prop];
            }
            insertMatch(match, function(err, job2) {
                if (err || !match.request) {
                    cb(err, job2);
                }
                else {
                    var api_val = 0;
                    job.progress(api_val, 100 + api_val);
                    job2.on('progress', function(prog) {
                        job.progress(api_val + prog, 100 + api_val);
                    });
                    job2.on('complete', function() {
                        cb();
                    });
                }
            });
        }
        else {
            return cb("unknown response");
        }
    });
}

function processMmr(job, cb) {
    var payload = job.data.payload;
    getData(job.data.url, function(err, data) {
        if (err) {
            logger.info(err);
            //don't retry processmmr attempts, data will likely be out of date anyway
            return cb(null, err);
        }
        logger.info("mmr response");
        if (data.soloCompetitiveRank || data.competitiveRank) {
            db.ratings.insert({
                match_id: payload.match_id,
                account_id: payload.account_id,
                soloCompetitiveRank: data.soloCompetitiveRank,
                competitiveRank: data.competitiveRank,
                time: new Date()
            }, function(err) {
                cb(err);
            });
        }
        else {
            cb(null);
        }
    });
}
module.exports = {
    processParse: processParse,
    processApi: processApi,
    processMmr: processMmr
};
