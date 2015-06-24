var config = require('./config');
var rc_public = config.RECAPTCHA_PUBLIC_KEY;
var utility = require('./utility');
var r = require('./redis');
var redis = r.client;
var kue = r.kue;
var db = require('./db');
var logger = utility.logger;
var compression = require('compression');
var session = require('express-session');
var RedisStore = require('connect-redis')(session);
var passport = require('./passport');
var status = require('./status');
var auth = require('http-auth');
var path = require('path');
var moment = require('moment');
var bodyParser = require('body-parser');
var async = require('async');
var fs = require('fs');
var goal = Number(config.GOAL);
var fillPlayerData = require('./fillPlayerData');
var queries = require('./queries');
var express = require('express');
var app = express();
var example_match = JSON.parse(fs.readFileSync('./matches/1408333834.json'));
/*
//var cpuCount = require('os').cpus().length;
// Include the cluster module
var cluster = require('cluster');
if (config.NODE_ENV === "test") {
    //don't cluster in test env
    configureApp(app);
} else {
    if (cluster.isMaster) {
        // Count the machine's CPUs
        // Create a worker for each CPU
        for (var i = 0; i < cpuCount; i += 1) {
            cluster.fork();
        }
    }
    else {
        configureApp(app);
    }
}
*/
var server = app.listen(config.PORT, function() {
    var host = server.address().address;
    var port = server.address().port;
    console.log('[WEB] listening at http://%s:%s', host, port);
});
require('./socket.js')(server);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');
app.locals.moment = moment;
app.locals.constants = require('./constants.json');
app.locals.basedir = __dirname + '/views';
app.use(compression());
var basic = auth.basic({
    realm: "Kue"
}, function(username, password, callback) { // Custom authentication method.
    callback(username === config.KUE_USER && password === config.KUE_PASS);
});
app.use("/kue", auth.connect(basic));
app.use("/kue", kue.app);
app.use("/public", express.static(path.join(__dirname, '/public')));
app.use(session({
    store: new RedisStore({
        client: redis,
        ttl: 52 * 7 * 24 * 60 * 60
    }),
    cookie: {
        maxAge: 52 * 7 * 24 * 60 * 60 * 1000
    },
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(function(req, res, next) {
    async.parallel({
        banner: function(cb) {
            redis.get("banner", cb);
        },
        apiDown: function(cb) {
            redis.get("apiDown", cb);
        },
        cheese: function(cb) {
            redis.get("cheese_goal", cb);
        }
    }, function(err, results) {
        res.locals.user = req.user;
        res.locals.banner_msg = results.banner;
        res.locals.api_down = Number(results.apiDown);
        var theGoal = Number(results.cheese || 0.1) / goal * 100;
        res.locals.cheese_goal = (theGoal - 100) > 0 ? 100 : theGoal;
        logger.info("%s visit %s", req.user ? req.user.account_id : "anonymous", req.originalUrl);
        return next(err);
    });
});
var Poet = require('poet');
var poet = new Poet(app);
poet.watch(function() {
    // watcher reloaded
}).init().then(function() {
    // Ready to go!
});
app.get('/robots.txt', function(req, res) {
    res.type('text/plain');
    res.send("User-agent: *\nDisallow: /players\nDisallow: /matches");
});
app.route('/').get(function(req, res, next) {
    if (req.user) {
        res.redirect('/players/' + req.user.account_id);
    }
    else {
        res.render('home', {
            match: example_match,
            truncate: [2, 6], // if tables should be truncated, pass in an array of which players to display
            home: true
        });
    }
});
var advQuery = require('./advquery');
app.route('/professional').get(function(req, res) {
    //TODO index page to list currently live matches and pro games
    //individual live match page for each match
    //interval check api
    //for each match, if time changed, update redis, push to clients
    utility.getData(utility.generateJob("api_live").url, function(err, data) {
        db.matches.find({
            leagueid: {
                $gt: 0
            }
        }, {
            limit: 100,
        }, function(err, data2) {
            //TODO add league data to pro matches
            res.render('professional', {
                live: data,
                recent: data2
            });
        });
    });
});
app.route('/request').get(function(req, res) {
    res.render('request', {
        rc_public: rc_public
    });
});
app.use('/ratings', function(req, res, next) {
    db.players.find({
        "ratings": {
            $ne: null
        }
    }, {
        fields: {
            "cache": 0
        }
    }, function(err, docs) {
        if (err) {
            return next(err);
        }
        docs.forEach(function(d) {
            d.soloCompetitiveRank = d.ratings[d.ratings.length - 1].soloCompetitiveRank;
        });
        docs.sort(function(a, b) {
            return b.soloCompetitiveRank - a.soloCompetitiveRank;
        });
        res.render("ratings", {
            ratings: docs
        });
    });
});
app.route('/preferences').post(function(req, res) {
    if (req.user) {
        for (var key in req.body) {
            //convert string to boolean
            req.body[key] = req.body[key] === "true";
        }
        db.players.update({
            account_id: req.user.account_id
        }, {
            $set: req.body
        }, function(err, num) {
            var success = !(err || !num);
            res.json({
                prefs: req.body,
                sync: success
            });
        });
    }
    else {
        res.json({
            sync: false
        });
    }
});
app.route('/status').get(function(req, res, next) {
    status(function(err, result) {
        if (err) {
            return next(err);
        }
        res.render("status", {
            result: result
        });
    });
});
app.route('/faq').get(function(req, res) {
    res.render("faq", {
        questions: poet.helpers.postsWithTag("faq").reverse()
    });
});
app.route('/compare').get(function(req, res, next) {
    var account_ids = ["all"];
    if (!req.query.compare && req.user) {
        req.query.compare = req.user.account_id.toString();
    }
    if (req.query.compare) {
        account_ids = account_ids.concat(req.query.compare.split(","));
    }
    account_ids = account_ids.slice(0, 6);
    console.log(account_ids);
    var qCopy = JSON.parse(JSON.stringify(req.query));
    async.mapSeries(account_ids, function(account_id, cb) {
        req.query = JSON.parse(JSON.stringify(qCopy));
        fillPlayerData(account_id, {
            query: {
                select: req.query,
                js_agg: {
                    "duration": 1,
                    "first_blood_time": 1,
                    "level": 1,
                    "kills": 1,
                    "deaths": 1,
                    "assists": 1,
                    "last_hits": 1,
                    "denies": 1,
                    "hero_damage": 1,
                    "tower_damage": 1,
                    "hero_healing": 1,
                    "kills_per_min": 1,
                    "deaths_per_min": 1,
                    "assists_per_min": 1,
                    "last_hits_per_min": 1,
                    "gold_per_min": 1,
                    "xp_per_min": 1,
                    "hero_damage_per_min": 1,
                    "tower_damage_per_min": 1,
                    "hero_healing_per_min": 1
                }
            }
        }, function(err, player) {
            //create array of results.aggData for each account_id
            //compute average for aggregations supporting it
            //mean or median?
            for (var key in player.aggData) {
                /*
                //mean
                if (player.aggData[key].sum && player.aggData[key].n) {
                    player.aggData[key].avg = player.aggData[key].sum / player.aggData[key].n;
                }
                */
                //median
                var arr = [];
                for (var value in player.aggData[key].counts) {
                    for (var i = 0; i < player.aggData[key].counts[value]; i++) {
                        arr.push(Number(value));
                    }
                }
                arr.sort(function(a, b) {
                    return a - b;
                });
                player.aggData[key].avg = arr[Math.floor(arr.length / 2)];
            }
            cb(err, {
                account_id: account_id,
                personaname: player.personaname,
                matches: player.matches,
                aggData: player.aggData
            });
        });
    }, function(err, results) {
        if (err) {
            return next(err);
        }
        //compute percentile for each stat
        //for each stat average in each player's aggdata, iterate through all's stat counts and determine whether this average is gt/lt key, then add count to appropriate bucket. percentile is gt/(gt+lt)
        results.forEach(function(r, i) {
            for (var key in results[i].aggData) {
                var avg = results[i].aggData[key].avg;
                var allCounts = results[0].aggData[key].counts;
                var gt = 0;
                var lt = 0;
                if (avg) {
                    for (var value in allCounts) {
                        var valueCount = allCounts[value];
                        if (avg >= Number(value)) {
                            gt += valueCount;
                        }
                        else {
                            lt += valueCount;
                        }
                    }
                    results[i].aggData[key].percentile = gt / (gt + lt);
                }
            }
        });
        var player = req.user;
        var teammates_arr = [];
        if (player && player.cache && player.cache.aggData && player.cache.aggData.teammates) {
            var teammates = player.cache.aggData.teammates;
            for (var id in teammates) {
                var tm = teammates[id];
                id = Number(id);
                //don't include if anonymous or if less than 3 games
                if (id !== app.locals.constants.anonymous_account_id && tm.games >= 3) {
                    teammates_arr.push(tm);
                }
            }
        }
        queries.fillPlayerNames(teammates_arr, function(err) {
            if (err) {
                return next(err);
            }
            res.render("compare", {
                teammate_list: teammates_arr,
                data: results,
                q: req.query,
                compare: true
            });
        });
    });
});
app.use('/matches', require('./routes/matches'));
app.use('/players', require('./routes/players'));
app.use('/api', require('./routes/api'));
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/donate'));
app.use(function(req, res, next) {
    var err = new Error("Not Found");
    err.status = 404;
    return next(err);
});
app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    console.log(err);
    if (config.NODE_ENV !== "development") {
        return res.render('error/' + (err.status === 404 ? '404' : '500'), {
            error: err
        });
    }
    //default express handler
    next(err);
});
module.exports = app;
