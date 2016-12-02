'use strict';

const async   = require('async'),
	  request = require('request'),
	  config  = require('config');

const io = require('../io');
const db = require('../db');
const cache = require('../cache');
const notifications = require('../notifications');
const utils = require('../utils');
const stations = require('../stations');
const songs = require('../songs');
const hooks = require('./hooks');

cache.sub('station.locked', stationId => {
	io.io.to(`station.${stationId}`).emit("event:stations.locked");
});

cache.sub('station.unlocked', stationId => {
	io.io.to(`station.${stationId}`).emit("event:stations.unlocked");
});

cache.sub('station.pause', stationId => {
	io.io.to(`station.${stationId}`).emit("event:stations.pause");
});

cache.sub('station.resume', stationId => {
	stations.getStation(stationId, (err, station) => {
		io.io.to(`station.${stationId}`).emit("event:stations.resume", {timePaused: station.timePaused});
	});
});

cache.sub('station.queueUpdate', stationId => {
	stations.getStation(stationId, (err, station) => {
		if (!err) {
			io.io.to(`station.${stationId}`).emit("event:queue.update", station.queue);
		}
	});
});

cache.sub('station.create', stationId => {
	console.log(111);
	stations.initializeStation(stationId, (err, station) => {
		console.log(err, station);
		//TODO Emit to homepage and admin station page
		if (!err) {
			io.io.to('home').emit("event:stations.created", station);
		}
	});
});

module.exports = {

	/**
	 * Get a list of all the stations
	 *
	 * @param session
	 * @param cb
	 * @return {{ status: String, stations: Array }}
	 */
	index: (session, cb) => {
		// TODO: the logic should be a bit more personalized to the users preferred genres
		// and it should probably just a different cache table then 'stations'
		cache.hgetall('stations', (err, stations) => {

			if (err && err !== true) {
				return cb({
					status: 'error',
					message: 'An error occurred while obtaining the stations'
				});
			}

			let arr = [];
			for (let prop in stations) {
				arr.push(stations[prop]);
			}

			cb({ status: 'success', stations: arr });
		});
	},

	getPlaylist: (session, stationId, cb) => {
		let playlist = [];

		stations.getStation(stationId, (err, station) => {
			for (let s = 1; s < station.playlist.length; s++) {
				songs.getSong(station.playlist[s], (err, song) => {
					playlist.push(song);
				});
			}
		});

		cb({ status: 'success', data: playlist })
	},

	/**
	 * Joins the station by its id
	 *
	 * @param session
	 * @param stationId - the station id
	 * @param cb
	 * @return {{ status: String, userCount: Integer }}
	 */
	join: (session, stationId, cb) => {

		stations.getStation(stationId, (err, station) => {

			if (err && err !== true) {
				return cb({ status: 'error', message: 'An error occurred while joining the station' });
			}

			if (station) {

				//TODO Loop through all sockets, see if socket with same session exists, and if so leave all other station rooms and join this stationRoom

				/*cache.client.hincrby('station.userCounts', stationId, 1, (err, userCount) => {
					if (err) return cb({ status: 'error', message: 'An error occurred while joining the station' });*/
				utils.socketJoinRoom(session.socketId, `station.${stationId}`);
				utils.socketJoinSongRoom(session.socketId, `song.${station.currentSong._id}`);
				//TODO Emit to cache, listen on cache
				songs.getSong(station.currentSong._id, (err, song) => {
					if (!err && song) {
						station.currentSong.likes = song.likes;
						station.currentSong.dislikes = song.dislikes;
					} else {
						station.currentSong.likes = -1;
						station.currentSong.dislikes = -1;
					}
					cb({ status: 'success', currentSong: station.currentSong, startedAt: station.startedAt, paused: station.paused, timePaused: station.timePaused });
				});
				//});
			}
			else {
				cb({ status: 'failure', message: `That station doesn't exist` });
			}
		});
	},

	/**
	 * Skips the users current station
	 *
	 * @param session
	 * @param stationId - the station id
	 * @param cb
	 * @return {{ status: String, skipCount: Integer }}
	 */
	/*skip: (session, stationId, cb) => {

		if (!session) return cb({ status: 'failure', message: 'You must be logged in to skip a song!' });

		stations.getStation(stationId, (err, station) => {
			
			if (err && err !== true) {
				return cb({ status: 'error', message: 'An error occurred while skipping the station' });
			}

			if (station) {
				cache.client.hincrby('station.skipCounts', session.stationId, 1, (err, skipCount) => {

					session.skippedSong = true;

					if (err) return cb({ status: 'error', message: 'An error occurred while skipping the station' });

					cache.hget('station.userCounts', session.stationId, (err, userCount) => {
						cb({ status: 'success', skipCount });
					});
				});
			}
			else {
				cb({ status: 'failure', message: `That station doesn't exist` });
			}
		});
	},*/

	forceSkip: hooks.adminRequired((session, stationId, cb) => {
		stations.getStation(stationId, (err, station) => {

			if (err && err !== true) {
				return cb({ status: 'error', message: 'An error occurred while skipping the station' });
			}

			if (station) {
				notifications.unschedule(`stations.nextSong?id=${stationId}`);
				notifications.schedule(`stations.nextSong?id=${stationId}`, 100);
			}
			else {
				cb({ status: 'failure', message: `That station doesn't exist` });
			}
		});
	}),

	/**
	 * Leaves the users current station
	 *
	 * @param session
	 * @param stationId
	 * @param cb
	 * @return {{ status: String, userCount: Integer }}
	 */
	leave: (session, stationId, cb) => {
		stations.getStation(stationId, (err, station) => {

			if (err && err !== true) {
				return cb({ status: 'error', message: 'An error occurred while leaving the station' });
			}

			if (session) session.stationId = null;
			else if (station) {
				cache.client.hincrby('station.userCounts', stationId, -1, (err, userCount) => {
					if (err) return cb({ status: 'error', message: 'An error occurred while leaving the station' });
					utils.socketLeaveRooms(session);
					cb({ status: 'success', userCount });
				});
			} else {
				cb({ status: 'failure', message: `That station doesn't exist, it may have been deleted` });
			}
		});
	},

	lock: hooks.adminRequired((session, stationId, cb) => {
		stations.getStation(stationId, (err, station) => {
			if (err && err !== true) {
				return cb({ status: 'error', message: 'An error occurred while locking the station' });
			} else if (station) {
				// Add code to update Mongo and Redis
				cb({ status: 'success' });
			} else {
				cb({ status: 'failure', message: `That station doesn't exist, it may have been deleted` });
			}
		});
	}),

	unlock: hooks.adminRequired((session, stationId, cb) => {
		stations.getStation(stationId, (err, station) => {
			if (err && err !== true) {
				return cb({ status: 'error', message: 'An error occurred while unlocking the station' });
			} else if (station) {
				// Add code to update Mongo and Redis
				cb({ status: 'success' });
			} else {
				cb({ status: 'failure', message: `That station doesn't exist, it may have been deleted` });
			}
		});
	}),

	pause: hooks.adminRequired((session, stationId, cb) => {
		stations.getStation(stationId, (err, station) => {
			if (err && err !== true) {
				return cb({ status: 'error', message: 'An error occurred while pausing the station' });
			} else if (station) {
				if (!station.paused) {
					station.paused = true;
					station.pausedAt = Date.now();
					db.models.station.update({_id: stationId}, {$set: {paused: true, pausedAt: Date.now()}}, () => {
						if (err) return cb({ status: 'failure', message: 'An error occurred while pausing the station.' });
						stations.updateStation(stationId, () => {
							cache.pub('station.pause', stationId);
							notifications.unschedule(`stations.nextSong?id=${stationId}`);
							cb({ status: 'success' });
						});
					});
				} else {
					cb({ status: 'failure', message: 'That station was already paused.' });
				}
				cb({ status: 'success' });
			} else {
				cb({ status: 'failure', message: `That station doesn't exist, it may have been deleted` });
			}
		});
	}),

	resume: hooks.adminRequired((session, stationId, cb) => {
		stations.getStation(stationId, (err, station) => {
			if (err && err !== true) {
				return cb({ status: 'error', message: 'An error occurred while resuming the station' });
			} else if (station) {
				if (station.paused) {
					station.paused = false;
					station.timePaused += (Date.now() - station.pausedAt);
					db.models.station.update({_id: stationId}, {$set: {paused: false}, $inc: {timePaused: Date.now() - station.pausedAt}}, () => {
						stations.updateStation(stationId, (err, station) => {
							cache.pub('station.resume', stationId);
							cb({ status: 'success' });
						});
					});
				} else {
					cb({ status: 'failure', message: 'That station is not paused.' });
				}
			} else {
				cb({ status: 'failure', message: `That station doesn't exist, it may have been deleted` });
			}
		});
	}),

	remove: hooks.adminRequired((session, stationId, cb) => {
		db.models.station.remove({ _id: stationId });
		cache.hdel('stations', stationId, () => {
			return cb({ status: 'success', message: 'Station successfully removed' });
		});
	}),

	create: hooks.adminRequired((session, data, cb) => {
		async.waterfall([

			(next) => {
				return (data) ? next() : cb({ 'status': 'failure', 'message': 'Invalid data' });
			},

			// check the cache for the station
			(next) => cache.hget('stations', data._id, next),

			// if the cached version exist
			(station, next) => {
				if (station) return next({ 'status': 'failure', 'message': 'A station with that id already exists' });
				db.models.station.findOne({ _id: data._id }, next);
			},

			(station, next) => {
				if (station) return next({ 'status': 'failure', 'message': 'A station with that id already exists' });
				const { _id, displayName, description, genres, playlist } = data;
				db.models.station.create({
					_id,
					displayName,
					description,
					type: "official",
					playlist,
					genres,
					currentSong: stations.defaultSong
				}, next);
			}

		], (err, station) => {
			console.log(1234567);
			if (err) throw err;
			console.log(123456789);
			cache.pub('station.create', data._id);
			console.log(123456723213);
			return cb(null, { 'status': 'success', 'message': 'Successfully created station.' });
		});
	}),

	createCommunity: hooks.loginRequired((session, data, cb) => {
		async.waterfall([

			(next) => {
				return (data) ? next() : cb({ 'status': 'failure', 'message': 'Invalid data' });
			},

			// check the cache for the station
			(next) => cache.hget('stations', data._id, next),

			// if the cached version exist
			(station, next) => {
				if (station) return next({ 'status': 'failure', 'message': 'A station with that id already exists' });
				db.models.station.findOne({ _id: data._id }, next);
			},

			(station, next) => {
				if (station) return next({ 'status': 'failure', 'message': 'A station with that id already exists' });
				const { _id, displayName, description } = data;
				db.models.station.create({
					_id,
					displayName,
					description,
					type: "community",
					queue: [],
					currentSong: stations.defaultSong
				}, next);
			}

		], (err, station) => {
			if (err) throw err;
			cache.pub('station.create', data._id);
			return cb(null, { 'status': 'success', 'message': 'Successfully created station.' });
		});
	}),

	addToQueue: hooks.loginRequired((session, stationId, songId, cb, userId) => {
		stations.getStation(stationId, (err, station) => {
			if (err) return cb(err);
			if (station.type === 'community') {
				let has = false;
				station.queue.forEach((queueSong) => {
					if (queueSong.songId === songId) {
						has = true;
					}
				});
				if (has) return cb({'status': 'failure', 'message': 'That song has already been added to the queue.'});
				db.models.update({_id: stationId}, {$push: {queue: {_id: songId, title: "Title", duration: 100, requestedBy: userId}}}, (err) => {
					if (err) return cb({'status': 'failure', 'message': 'Something went wrong.'});
					stations.updateStation(stationId, (err, station) => {
						if (err) return cb(err);
						cache.pub('station.queueUpdate', stationId);
					});
				});
			} else cb({'status': 'failure', 'message': 'That station is not a community station.'});
		});
	}),

	removeFromQueue: hooks.adminRequired((session, stationId, songId, cb, userId) => {
		stations.getStation(stationId, (err, station) => {
			if (err) return cb(err);
			if (station.type === 'community') {
				let has = false;
				station.queue.forEach((queueSong) => {
					if (queueSong._id === songId) {
						has = true;
					}
				});
				if (!has) return cb({'status': 'failure', 'message': 'That song is not in the queue.'});
				db.models.update({_id: stationId}, {$pull: {queue: {_id: songId}}}, (err) => {
					if (err) return cb({'status': 'failure', 'message': 'Something went wrong.'});
					stations.updateStation(stationId, (err, station) => {
						if (err) return cb(err);
						cache.pub('station.queueUpdate', stationId);
					});
				});
			} else cb({'status': 'failure', 'message': 'That station is not a community station.'});
		});
	}),

};
