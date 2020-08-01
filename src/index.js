'use strict';

const yargs = require('yargs');
const fs = require('fs');
const path = require('path');
const mongoBackup = require('mongodb-backup');
const child_process = require('child_process');
const readdir = require('recursive-readdir');
const Q = require('q');

let dir = yargs.argv.dir || process.env.dir;
const uri = yargs.argv.uri || process.env.uri;
const git = yargs.argv.git || process.env.git;

if (!dir || !fs.lstatSync(dir).isDirectory()) {
  throw new Error('Directory not found');
}
gitInit(dir, git);

function gitInit(d, g) {
  log('Git clone...');
  // const USER = 'something';
  // const PASS = 'somewhere';
  // const REPO = 'github.com/username/private-repo';
  // const remote = `https://${USER}:${PASS}@${REPO}`;
   
  const git = require('simple-git');
  git(dir)
    .clone(git)
    .then(() => console.log('finished'))
    .catch((err) => console.error('failed: ', err));
}

dir = path.resolve(__dirname, dir);
log('Backing up MongoDB to directory:', dir);

if (!uri) {
  throw new Error('No MongoDB URI provided');
}
console.log(`Parsed URI: ${uri}`);

let runDf;

// Allow running the processs immediately without scheduling.
let now = process.env.now || yargs.argv.now;
let cron = process.env.cron || yargs.argv.cron;
let timezone = yargs.argv.timezone || process.env.timezone || 'Australia/Melbourne';
if (now != null) {
  run();
} else {
  const CronJob = require('cron').CronJob;
  // Run every hour by default.
  const cronRange = cron || '00 00 * * * *';
  const job = new CronJob(cronRange, run,
    true, /* Start the job right now */
    timezone
  );
}

function run() {
  // Prevent running if previous run is incomplete.
  if (runDf && runDf.promise && Q.isPending(runDf.promise)) return;

  runDf = Q.defer();
  runDf.resolve(deleteFiles(dir).then(backup).then(push));
  runDf.promise.catch(function(err) {
    console.error(err, err.stack);
  }).done();
}

function backup() {
  log('Backing up data...');
  const df = Q.defer();
  mongoBackup({
    uri: uri,
    root: dir,
    callback: (err, result) => {
      if (err) {
        log('Error during backup', err);
        df.reject(err);
      } else {
        log('Backup successful', result);
        df.resolve(result);
      }
    }
  });
  return df.promise;
}

function push() {
  log('Adding to Git...');
  const df = Q.defer();

  function callback(err, result) {
    if (err) df.reject(err);
  }

  require('simple-git')(dir)
    .add('./*', callback)
    .then(function() {
      log('Committing...');
    })
    .commit('Update', callback)
    .then(function() {
      log('Pushing...');
    })
    .push('origin', 'master', callback)
    .then(function() {
      log('Pushed to Git');
      df.resolve();
    });
  return df.promise;
}

// Deletes the existing files in the subdirectores of the given directory.
function deleteFiles(dir) {
  log('Deleting existing files...');
  const df = Q.defer();

  // Exclude hidden directories (e.g. git).
  const dbDir = path.join(dir, uriInfo.db);
  log('Deleting directory:', dbDir);

  return Q.ninvoke(child_process, 'exec', `rm -rf ${dbDir}`, {});
}

// http://stackoverflow.com/questions/18112204
function getDirectories(srcpath) {
  return fs.readdirSync(srcpath).filter(function(file) {
    return fs.statSync(path.join(srcpath, file)).isDirectory();
  });
}

function stripColonPrefix(str) {
  return str.replace(/^:/, '');
}

function log() {
  const args = Array.prototype.slice.call(arguments);
  args.unshift(new Date());
  console.log.call(console, args.join(' '));
}
