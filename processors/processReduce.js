/**
 * A processor to reduce the event stream to only logs we want to persist
 **/
function processReduce(entries, match, meta)
{
    var basicLogTypes = {
        "obs": 1,
        "sen": 1,
        "obs_left": 1,
        "sen_left": 1,
    };
    var result = entries.filter(function(e)
    {
        if (match.doLogParse)
        {
            if (e.type === "actions")
            {
                return false;
            }
            if (e.type === "DOTA_COMBATLOG_MODIFIER_REMOVE")
            {
                return false;
            }
            if (e.type === "DOTA_COMBATLOG_DAMAGE" || e.type === "DOTA_COMBATLOG_MODIFIER_ADD" || e.type === "DOTA_COMBATLOG_HEAL")
            {
                if (!e.targethero || e.targetillusion)
                {
                    return false;
                }
            }
            if (e.type === "interval" && e.time % 60 !== 0)
            {
                return false;
            }
            if (!e.time)
            {
                return false;
            }
            return true;
        }
        else
        {
            return (e.type in basicLogTypes);
        }
    }).map(function(e)
    {
        var e2 = Object.assign(
        {}, e,
        {
            match_id: match.match_id,
            attackername_slot: meta.hero_to_slot[e.attackername],
            targetname_slot: meta.hero_to_slot[e.targetname],
            sourcename_slot: meta.hero_to_slot[e.sourcename],
            targetsourcename_slot: meta.hero_to_slot[e.targetname],
            player1_slot: meta.slot_to_playerslot[e.player1],
            player_slot: e.player_slot || meta.slot_to_playerslot[e.slot],
            inflictor: translate(e.inflictor),
        });
        delete e2.attackername;
        delete e2.targetname;
        delete e2.sourcename;
        delete e2.targetsourcename;
        return e2;
    });
    /*
    var count = {};
    result.forEach(function(r)
    {
        count[r.type] = (count[r.type] || 0) + 1;
    });
    console.log(count);
    */
    return result;
}

function translate(s)
{
    return s === "dota_unknown" ? null : s;
}
module.exports = processReduce;