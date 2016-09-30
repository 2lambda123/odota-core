const utility = require('../util/utility');
const generateJob = utility.generateJob;
const getData = utility.getData;
const db = require('../store/db');
const redis = require('../store/redis');
const cassandra = require('../store/cassandra');
const queries = require('../store/queries');
const insertMatch = queries.insertMatch;
const args = process.argv.slice(2);
const match_id = Number(args[0]);
const delay = 1000;
const job = generateJob('api_details',
  {
    match_id,
  });
const url = job.url;
getData(
  {
    url,
    delay,
  }, (err, body) => {
  if (err)
    {
    throw err;
  }
  if (body.result)
    {
    const match = body.result;
    insertMatch(db, redis, match,
      {
        skipCounts: true,
        skipAbilityUpgrades: true,
        forceParse: true,
        cassandra,
        attempts: 1,
      }, (err) => {
        if (err)
            {
          throw err;
        }
        process.exit(0);
      });
  }
  else
    {
    throw body;
  }
});
