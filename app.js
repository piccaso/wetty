var express = require('express');
var http = require('http');
var https = require('https');
var path = require('path');
var server = require('socket.io');
var pty = require('pty.js');
var fs = require('fs');
var Docker = require('dockerode');
var docker = new Docker({socketPath: '/var/run/docker.sock'});

var opts = require('optimist')
    .options({
        sslkey: {
            demand: false,
            description: 'path to SSL key'
        },
        sslcert: {
            demand: false,
            description: 'path to SSL certificate'
        },
        sshhost: {
            demand: false,
            description: 'ssh server host'
        },
        sshport: {
            demand: false,
            description: 'ssh server port'
        },
        sshuser: {
            demand: false,
            description: 'ssh user'
        },
        sshauth: {
            demand: false,
            description: 'defaults to "password", you can use "publickey,password" instead'
        },
        port: {
            demand: true,
            alias: 'p',
            description: 'wetty listen port'
        },
    }).boolean('allow_discovery').argv;

var runhttps = false;
var sshport = 22;
var sshhost = 'localhost';
var sshauth = 'password,keyboard-interactive';
var globalsshuser = '';

if (opts.sshport) {
    sshport = opts.sshport;
}

if (opts.sshhost) {
    sshhost = opts.sshhost;
}

if (opts.sshauth) {
	sshauth = opts.sshauth;
}

if (opts.sshuser) {
    globalsshuser = opts.sshuser;
}

if (opts.sslkey && opts.sslcert) {
    runhttps = true;
    opts['ssl'] = {};
    opts.ssl['key'] = fs.readFileSync(path.resolve(opts.sslkey));
    opts.ssl['cert'] = fs.readFileSync(path.resolve(opts.sslcert));
}

process.on('uncaughtException', function(e) {
    console.error('Error: ' + e);
});

var httpserv;

var app = express();
app.get('/:host', function(req, res) {
    res.sendfile(__dirname + '/public/wetty/index.html');
});
app.use('/', express.static(path.join(__dirname, 'public')));

if (runhttps) {
    httpserv = https.createServer(opts.ssl, app).listen(opts.port, function() {
        console.log('https on port ' + opts.port);
    });
} else {
    httpserv = http.createServer(app).listen(opts.port, function() {
        console.log('http on port ' + opts.port);
    });
}

var io = server(httpserv,{path: '/wetty/socket.io'});
io.on('connection', function(socket){
    var sshuser = '';
    var request = socket.request;
    console.log((new Date()) + ' Connection accepted.');
// this is now the host
    console.log('Request from: ' + request.headers.referer);
    if (match = request.headers.referer.match('://.+/(.+$)')) {
        sshhost = match[1];
    } else {
	sshhost = "localhost";
    }

    console.log('Host is: ' + sshhost); 

    var term;
    if (sshhost != "localhost") {
	var container = docker.getContainer(sshhost);
	container.inspect(term = function (err, data) {
	
	if( data ) {
	
		console.log("Found container:" + sshhost);
		
                spawnTerm(sshhost,"container",socket); 
		
	} else {

		console.log("No container found, trying ssh:" + sshhost);

                spawnTerm(sshhost,"ssh",socket); 
	}
    });
   } else {
  
     spawnTerm(sshhost,"local",socket);
   }
});

function spawnTerm(sshhost, mode, socket) {

  var term;
  
  switch( mode ){
     case "container":
	term = pty.spawn('/usr/bin/env', ['docker', 'exec', '-it','-e', 'TERM=xterm-256color', sshhost, '/bin/bash'], {
       // term = pty.spawn('/usr/bin/env', ['login'], {
            name: 'xterm-256color',
            cols: 80,
            rows: 30
        });
	break;
     case "ssh":
	term = pty.spawn('./ssh-remote.sh', [sshhost], {
       // term = pty.spawn('/usr/bin/env', ['login'], {
            name: 'xterm-256color',
            cols: 80,
            rows: 30
        });
	break;
     default:
        term = pty.spawn('/usr/bin/env', ['login'], {
            name: 'xterm-256color',
            cols: 80,
            rows: 30
        });
	break;
   }
//		term = pty.spawn('docker exec -it', [sshhost, '/bin/bash'], {
//		term = pty.spawn('/home/dev/wetty/ssh-remote.sh', [sshhost], {
    console.log((new Date()) + " PID=" + term.pid );
    term.on('error', function(data) {
	console.log("Error:" + data);
    });
    term.on('data', function(data) {
        socket.emit('output', data);
    });
    term.on('exit', function(code) {
        console.log((new Date()) + " PID=" + term.pid + " ENDED");
    });
    socket.on('resize', function(data) {
        term.resize(data.col, data.row);
    });
    socket.on('input', function(data) {
        term.write(data);
    });
    socket.on('disconnect', function() {
        term.end();
    });
}
