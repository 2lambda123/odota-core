var passport = require('passport');
var api_key = process.env.STEAM_API_KEY.split(",")[0];
var db = require('./db');
var SteamStrategy = require('passport-steam').Strategy;
var host = process.env.ROOT_URL || "http://localhost:5000";
var utility = require('./utility');
var convert64to32 = utility.convert64to32;

passport.serializeUser(function(user, done) {
    done(null, user.account_id);
});
passport.deserializeUser(function(id, done) {
    db.players.findAndModify({
        account_id: id
    }, {
        $set: {
            track: 1,
            last_visited: new Date()
        }
    }, function(err, user) {
        done(err, user);
    });
});
passport.use(new SteamStrategy({
    returnURL: host + '/return',
    realm: host,
    apiKey: api_key
}, function initializeUser(identifier, profile, done) {
    var steam32 = Number(convert64to32(identifier.substr(identifier.lastIndexOf("/") + 1)));
    var insert = profile._json;
    insert.account_id = steam32;
    db.players.update({
        account_id: steam32
    }, {
        $set: insert,
        $setOnInsert: {
            join_date: new Date()
        }
    }, {
        upsert: true
    }, function(err) {
        done(err, insert);
    });
}));

module.exports = passport;