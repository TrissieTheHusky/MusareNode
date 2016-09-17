'use strict';

// nodejs modules
const path = require('path'),
      fs   = require('fs'),
      os   = require('os');

process.env.NODE_CONFIG_DIR = `${process.cwd()}/backend/config`;

// npm modules
const express          = require('express'),
      session          = require('express-session'),
      mongoose         = require('mongoose'),
	  MongoStore       = require('connect-mongo')(session),
      bodyParser       = require('body-parser'),
      config           = require('config'),
      request          = require('request'),
      passport         = require('passport'),
      LocalStrategy    = require('passport-local').Strategy,
      passportSocketIo = require("passport.socketio");

// global module
const global         = require('./logic/global');

// database
const MongoDB = mongoose.connect('mongodb://localhost:27017/musare').connection;

MongoDB.on('error', (err) => {
	console.log('Database error: ' + err.message);
});

MongoDB.once('open', () => {
	console.log('Connected to database');
	setupExpress();
});

// setup express and socket.io
function setupExpress() {
	const app = express(MongoDB);
	const server = app.listen(80);
	global.io = require('socket.io')(server);

// other custom modules
	const coreHandler = require('./logic/coreHandler'),
		socketHandler = require('./logic/socketHandler'),
		expressHandler = require('./logic/expressHandler');

	global.db = {
		user: require('./schemas/user')(mongoose),
		station: require('./schemas/station')(mongoose)
	};

	console.log("Test");
	const mongoStore = new MongoStore({'mongooseConnection': MongoDB});

	app.use(session({
		secret: config.get('secret'),
		key: 'connect.sid',
		store: mongoStore,
		resave: true,
		saveUninitialized: true
	}));

	global.io.use(passportSocketIo.authorize({
		cookieParser: require('cookie-parser'),
		key: 'connect.sid',
		secret: config.get('secret'),
		store: mongoStore,
		success: function (data, accept) {
			console.log('successful connection to socket.io');

			accept();
		},
		fail: function (data, message, error, accept) {
			console.log(message);
			if (error && message !== "Passport was not initialized")
				throw new Error(message);

			accept();
		}
	}));

	app.use(passport.initialize());
	app.use(passport.session());

	passport.serializeUser((user, done) => {
		done(null, user);
	});

	passport.deserializeUser((user, done) => {
		done(null, user);
	});

	passport.use(new LocalStrategy({usernameField: 'email'}, (email, password, done) => {
		console.log(email, password);
		process.nextTick(() => {
			console.log(email, password);
			global.db.user.findOne({"email.address": email}, (err, user) => {
				if (err) return done(err);
				if (!user) return done(null, false);
				//if (!user.services.token.password == password) return done(null, false);
				return done(null, user);
			});
		});
	}));

	app.use(bodyParser.json());
	app.use(bodyParser.urlencoded({
		extended: true
	}));

	app.use(express.static(__dirname + '/../frontend/build/'));

	socketHandler(coreHandler, global.io);
	expressHandler(coreHandler, app);
}
