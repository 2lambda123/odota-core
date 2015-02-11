var $ = jQuery = require('jquery');
var moment = require('moment');
var constants = require('../../sources.json');
var heroes = constants.heroes;
var modes = constants.modes;
var regions = constants.regions;
module.exports = function playerTables() {
    $(document).on('ready', function() {
        $('#teammates').dataTable({
            "order": [
                [1, "desc"]
            ]
        });
        $('#heroes').dataTable({
            "order": [
                [2, "desc"]
            ],
            "columnDefs": [{
                "targets": [0],
                "orderData": [1]
            }, {
                "targets": [1],
                visible: false
            }],
            "paging": false
        });
        $('#together').dataTable({
            "order": [
                [2, "desc"]
            ],
            "columnDefs": [{
                "targets": [0],
                "orderData": [1]
            }, {
                "targets": [1],
                visible: false
            }],
            "paging": false
        });
        $('#against').dataTable({
            "order": [
                [2, "desc"]
            ],
            "columnDefs": [{
                "targets": [0],
                "orderData": [1]
            }, {
                "targets": [1],
                visible: false
            }],
            "paging": false
        });
        $('#matches').dataTable({
            ajax: {
                'url': '/api/matches',
                'data': {
                    "select": {
                        "players.account_id": account_id
                    }
                },
                "dataSrc": function(json) {
                    console.log(json);
                    return json.data;
                }
            },
            "rowCallback": function(row, data) {
                var cl = data.players[0].player_slot < 64 === data.radiant_win ? "success" : "danger";
                $(row).addClass(cl);
            },
            "drawCallback": function() {
                require('./tooltips')();
            },
            ordering: false,
            serverSide: true,
            stateSave: true,
            searching: false,
            columns: [{
                data: 'match_id',
                title: 'Match ID',
                render: function(data, type) {
                    return '<a href="/matches/' + data + '">' + data + '</a>';
                }
            }, {
                data: 'players[0].hero_id',
                title: 'Hero',
                render: function(data, type) {
                    return heroes[data] ? "<img src='" + heroes[data].img + "' title=\"" + heroes[data].localized_name + "\"/>" : data;
                }
            }, {
                data: 'radiant_win',
                title: 'Result',
                render: function(data, type, row) {
                    row.player_win = data === row.players[0].player_slot < 64;
                    return row.player_win ? "Won" : "Lost";
                }
            }, {
                data: 'game_mode',
                title: 'Game Mode',
                render: function(data, type) {
                    return modes[data] ? modes[data].name : data;
                }
            }, {
                data: 'cluster',
                title: 'Region',
                render: function(data, type) {
                    return regions[data] ? regions[data] : data;
                }
            }, {
                data: 'duration',
                title: 'Duration',
                render: function(data, type) {
                    return moment().startOf('day').seconds(data).format("H:mm:ss");
                }
            }, {
                data: 'start_time',
                title: 'Played',
                render: function(data, type, row) {
                    return moment.unix(data + row.duration).fromNow();
                }
            }, {
                data: 'players[0].kills',
                title: 'K',
                render: function(data, type) {
                    return data;
                }
            }, {
                data: 'players[0].deaths',
                title: 'D',
                render: function(data, type) {
                    return data;
                }
            }, {
                data: 'players[0].assists',
                title: 'A',
                render: function(data, type) {
                    return data;
                }
            }, {
                data: 'players[0].last_hits',
                title: 'LH',
                render: function(data, type) {
                    return data;
                }
            }, {
                data: 'players[0].denies',
                title: 'DN',
                render: function(data, type) {
                    return data;
                }
            }, {
                data: 'players[0].gold_per_min',
                title: 'GPM',
                render: function(data, type) {
                    return data;
                }
            }, {
                data: 'players[0].xp_per_min',
                title: 'XPM',
                render: function(data, type) {
                    return data;
                }
            }, {
                data: 'players[0].hero_damage',
                title: 'HD',
                render: function(data, type) {
                    return data;
                }
            }, {
                data: 'players[0].tower_damage',
                title: 'TD',
                render: function(data, type) {
                    return data;
                }
            }, {
                data: 'players[0].hero_healing',
                title: 'HH',
                render: function(data, type) {
                    return data;
                }
            }]
        });
    });
};
