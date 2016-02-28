var fs = require('fs');
var manifest = require('./package.json');
manifest.apps.forEach(function(app)
{
    var name = app.script.split('.')[0];
    fs.appendFile("./Procfile.dev", name + ": " + "nodemon " + app.script + "\n");
});